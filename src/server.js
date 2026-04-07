const express    = require('express')
const http       = require('http')
const { WebSocketServer } = require('ws')
const chokidar   = require('chokidar')
const fs         = require('fs')
const os         = require('os')
const path       = require('path')
const { execSync, spawn } = require('child_process')
const { readMeta, writeMeta, ensureProject } = require('./meta.js')
const { loadAll, updateFromFile, removeByFile, getAll, getByFileKey, store, sessionsDir, metaFile } = require('./sessions.js')

const PORT = process.env.PORT || 3333
const app  = express()
app.use(express.json())

const server = http.createServer(app)
const wss    = new WebSocketServer({ server, path: '/ws' })

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data)
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

fs.mkdirSync(sessionsDir, { recursive: true })

let meta = readMeta(metaFile)

// Auto-assign colors for all projects already in sessions dir
for (const file of fs.readdirSync(sessionsDir)) {
  if (!file.endsWith('.json') || file.endsWith('.tmp')) continue
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'))
    if (raw.cwd && !meta[raw.cwd]) {
      meta = ensureProject(meta, raw.cwd, raw.project)
    }
  } catch (_) {}
}
writeMeta(metaFile, meta)
loadAll(meta)

// Process discovery: find running Claude sessions not yet in sessions dir (Windows only)
if (!IS_MAC) try {
  const raw = execSync(
    'powershell.exe -NonInteractive -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like \'*claude-code/cli.js*\' } | Select-Object ProcessId,CommandLine,ParentProcessId | ConvertTo-Json -Compress"',
    { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
  ).toString().trim()
  if (raw) {
    const list  = JSON.parse(raw)
    const procs = Array.isArray(list) ? list : [list]
    const projectsDir = path.join(os.homedir(), '.claude', 'projects')
    if (fs.existsSync(projectsDir)) {
      for (const proc of procs) {
        const resumeMatch = proc.CommandLine && proc.CommandLine.match(/--resume\s+([a-f0-9-]{36})/)
        const sessionId   = resumeMatch ? resumeMatch[1] : null
        if (!sessionId) continue
        for (const dir of fs.readdirSync(projectsDir)) {
          try {
            if (!fs.readdirSync(path.join(projectsDir, dir)).some(f => f.startsWith(sessionId))) continue
            const cwd     = dir.replace('--', ':\\').replace(/-/g, '\\')
            const project = path.basename(cwd)
            const fileKey = `${project}-${sessionId.substring(0, 8)}`
            if (!store.has(fileKey)) {
              meta = ensureProject(meta, cwd, project)
              writeMeta(metaFile, meta)
              const sessionFile = path.join(sessionsDir, fileKey + '.json')
              fs.writeFileSync(sessionFile, JSON.stringify({
                project, status: 'running', message: '', cwd, sessionId,
                pid: proc.ParentProcessId, timestamp: Date.now()
              }))
              loadAll(meta)
            }
          } catch (_) {}
        }
      }
    }
  }
} catch (_) {}

// ── WebSocket ─────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', sessions: getAll() }))
})

// ── Chokidar ──────────────────────────────────────────────────────────────────

chokidar.watch(sessionsDir, { ignoreInitial: true }).on('all', (event, filePath) => {
  if (!filePath.endsWith('.json') || filePath.endsWith('.tmp')) return
  if (event === 'add' || event === 'change') {
    meta = readMeta(metaFile)
    // Auto-assign color for new projects
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (raw.cwd && !meta[raw.cwd]) {
        meta = ensureProject(meta, raw.cwd, raw.project)
        writeMeta(metaFile, meta)
      }
    } catch (_) {}
    const session = updateFromFile(filePath, meta)
    if (session) broadcast({ type: 'session_updated', session })
  } else if (event === 'unlink') {
    const fileKey = removeByFile(filePath)
    broadcast({ type: 'session_removed', fileKey })
  }
})

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  res.json(getAll())
})

app.patch('/api/sessions/:fileKey', (req, res) => {
  const { fileKey } = req.params
  const { label, color } = req.body
  meta = readMeta(metaFile)

  // Get cwd from session file; fall back to fileKey
  let cwd = fileKey
  const sessionFile = path.join(sessionsDir, fileKey + '.json')
  try { cwd = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).cwd || fileKey } catch (_) {}

  meta = ensureProject(meta, cwd, fileKey)
  if (label !== undefined) meta[cwd].label = label
  if (color !== undefined) meta[cwd].color = color
  writeMeta(metaFile, meta)

  const current = getByFileKey(fileKey)
  if (current) {
    const updated = { ...current, label: meta[cwd].label, color: meta[cwd].color }
    store.set(fileKey, updated)
    broadcast({ type: 'session_updated', session: updated })
  }

  res.json({ ok: true })
})

app.delete('/api/sessions/:fileKey', (req, res) => {
  const { fileKey } = req.params
  const sessionFile = path.join(sessionsDir, fileKey + '.json')

  try {
    const { pid } = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    if (pid) {
      execSync(
        `powershell.exe -NonInteractive -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`,
        { timeout: 5000, stdio: 'ignore' }
      )
    }
  } catch (_) {}

  try { fs.unlinkSync(sessionFile) } catch (_) {}
  removeByFile(sessionFile)
  broadcast({ type: 'session_removed', fileKey })
  res.json({ ok: true })
})

const IS_MAC = process.platform === 'darwin'

// Known terminal process names (no .exe suffix)
const TERMINAL_NAMES = ['WindowsTerminal', 'ConEmu64', 'ConEmu', 'Code', 'mintty', 'Hyper', 'Warp']

// macOS terminal bundle IDs for process-tree matching
const MAC_TERMINALS = {
  'Terminal':        'com.apple.Terminal',
  'iTerm2':          'com.googlecode.iterm2',
  'Warp':            'dev.warp.Warp-Stable',
  'kitty':           'net.kovidgoyal.kitty',
  'Alacritty':       'org.alacritty',
  'WezTerm':         'org.wezfurlong.wezterm',
  'Hyper':           'co.zeit.hyper',
  'Code':            'com.microsoft.VSCode',
  'Cursor':          'com.todesktop.230313mzl4w4u92',
}

// ── macOS focus helpers ──────────────────────────────────────────────────────

function macFindTerminalApp(pid) {
  // Walk up the process tree via ps to find a known terminal
  let current = pid
  for (let i = 0; i < 15; i++) {
    try {
      const line = execSync(`ps -p ${current} -o ppid=,comm=`, {
        timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']
      }).toString().trim()
      if (!line) return null
      const parts = line.match(/^\s*(\d+)\s+(.+)$/)
      if (!parts) return null
      const ppid = parseInt(parts[1], 10)
      const comm = path.basename(parts[2])
      for (const [name, bundleId] of Object.entries(MAC_TERMINALS)) {
        if (comm.toLowerCase().includes(name.toLowerCase())) {
          return { name, bundleId, pid: current }
        }
      }
      if (ppid <= 1) return null
      current = ppid
    } catch (_) { return null }
  }
  return null
}

function macFocusApp(bundleId) {
  try {
    execSync(`osascript -e 'tell application id "${bundleId}" to activate'`, {
      timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
    })
    return true
  } catch (_) { return false }
}

function macOpenNewTab(cwd, sessionId) {
  const cmd = sessionId ? `claude --resume ${sessionId}` : 'claude'
  // Try the default terminal via `open -a Terminal`
  try {
    execSync(`osascript -e '
      tell application "Terminal"
        activate
        do script "cd ${cwd.replace(/'/g, "'\\''")} && ${cmd}"
      end tell
    '`, { timeout: 4000, stdio: 'ignore' })
    return true
  } catch (_) { return false }
}

function macHandleFocus(session, meta, dbg) {
  const { pid, sessionId, cwd } = session
  const entry = meta[cwd] || {}
  let focused = false, opened = false

  const alive = isAlive(pid)
  dbg.alive = alive

  if (alive) {
    const terminal = macFindTerminalApp(pid)
    dbg.terminal = terminal ? terminal.name : null
    if (terminal) {
      focused = macFocusApp(terminal.bundleId)
    }
  }

  if (!focused && !alive) {
    const resumeId = sessionId || entry.lastSessionId || null
    dbg.resumeId = resumeId
    opened = macOpenNewTab(cwd, resumeId)
  }

  return { focused, opened }
}

function findClaudePid(sessionId, fallbackPid) {
  // 1. Check numeric PID files in sessions dir (written by claudeMonitor or similar)
  try {
    for (const f of fs.readdirSync(sessionsDir)) {
      if (!/^\d+\.json$/.test(f)) continue
      try {
        const d = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'))
        if (d.sessionId !== sessionId || !d.pid) continue
        // Verify it's still alive
        const alive = execSync(
          `powershell.exe -NonInteractive -Command "if (Get-Process -Id ${d.pid} -EA SilentlyContinue) { 'alive' }"`,
          { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }
        ).toString().trim()
        if (alive === 'alive') return d.pid
      } catch (_) {}
    }
  } catch (_) {}

  // 2. WMI scan for Claude process with --resume <sessionId>
  if (sessionId) {
    try {
      const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*claude-code*cli.js*--resume*${sessionId}*' } | Select-Object -First 1 -ExpandProperty ProcessId`
      const raw = execSync(`powershell.exe -NonInteractive -Command "${script}"`,
        { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10)
    } catch (_) {}
  }

  // 3. Verify stored pid is still alive
  if (fallbackPid) {
    try {
      const script = `if (Get-Process -Id ${fallbackPid} -EA SilentlyContinue) { Write-Output 'alive' }`
      const out = execSync(`powershell.exe -NonInteractive -Command "${script}"`,
        { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (out === 'alive') return fallbackPid
    } catch (_) {}
  }

  return null
}

function walkToTerminal(claudePid, preferredTerminal) {
  const preferred = preferredTerminal || null
  const names = preferred
    ? [preferred, ...TERMINAL_NAMES.filter(n => n !== preferred)]
    : TERMINAL_NAMES
  const knownList = names.map(n => `'${n}'`).join(',')
  try {
    const script = [
      `$known = @(${knownList});`,
      `$p = ${claudePid};`,
      `for ($i = 0; $i -lt 12; $i++) {`,
      `  $proc = Get-CimInstance Win32_Process | Where-Object ProcessId -eq $p | Select-Object -First 1;`,
      `  if (-not $proc) { break }`,
      `  $name = $proc.Name -replace '\\.exe$','';`,
      `  if ($name -in $known) { Write-Output $proc.ProcessId; break }`,
      `  if ($proc.ParentProcessId -le 0) { break }`,
      `  $p = $proc.ParentProcessId`,
      `}`,
    ].join(' ')
    const raw = execSync(`powershell.exe -NonInteractive -Command "${script}"`,
      { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return (raw && /^\d+$/.test(raw)) ? parseInt(raw, 10) : null
  } catch (_) { return null }
}

function focusWindow(termPid) {
  // Write PS script to temp file to avoid quoting hell with Add-Type
  const tmpScript = path.join(os.tmpdir(), `cs-focus-${process.pid}.ps1`)
  const ps = `
$proc = Get-Process -Id ${termPid} -ErrorAction SilentlyContinue
if (-not $proc -or $proc.MainWindowHandle -eq 0) { Write-Output "no-handle"; exit }
$hwnd = $proc.MainWindowHandle
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr hAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
}
'@ -ErrorAction SilentlyContinue
$isIconic = [WinFocus]::IsIconic($hwnd)
$isVisible = [WinFocus]::IsWindowVisible($hwnd)
Write-Output "state:iconic=$isIconic;visible=$isVisible"
# Step 1: Restore via all known methods
[WinFocus]::ShowWindow($hwnd, 1) | Out-Null
[WinFocus]::ShowWindow($hwnd, 9) | Out-Null
[WinFocus]::SendMessage($hwnd, 0x0112, [IntPtr]0xF120, [IntPtr]::Zero) | Out-Null
# Step 2: AppActivate by process ID - works for many apps SetForegroundWindow won't touch
$shell = New-Object -ComObject WScript.Shell
$shell.AppActivate(${termPid}) | Out-Null
Start-Sleep -Milliseconds 400
# Step 3: Win32 force-focus
$fg = [WinFocus]::GetForegroundWindow()
$fgTid = 0; [WinFocus]::GetWindowThreadProcessId($fg, [ref]$fgTid) | Out-Null
$myTid = [WinFocus]::GetCurrentThreadId()
[WinFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[WinFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[WinFocus]::AttachThreadInput($myTid, $fgTid, $true) | Out-Null
[WinFocus]::BringWindowToTop($hwnd) | Out-Null
[WinFocus]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x43) | Out-Null
[WinFocus]::SetForegroundWindow($hwnd) | Out-Null
[WinFocus]::SetActiveWindow($hwnd) | Out-Null
[WinFocus]::AttachThreadInput($myTid, $fgTid, $false) | Out-Null
[WinFocus]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, 0x43) | Out-Null
Write-Output "focused"
`
  try {
    fs.writeFileSync(tmpScript, ps)
    const lines = execSync(
      `powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${tmpScript}"`,
      { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim().split('\n').map(l => l.trim())
    const stateLine = lines.find(l => l.startsWith('state:'))
    const winState = stateLine
      ? Object.fromEntries(stateLine.slice(6).split(';').map(p => p.split('=')))
      : null
    return { focused: lines.includes('focused'), winState }
  } catch (_) {
    return { focused: false, winState: null }
  } finally {
    try { fs.unlinkSync(tmpScript) } catch (_) {}
  }
}

function isAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true }
  catch { return false }
}

const FOCUS_TAB_PS1 = path.join(__dirname, 'focusTab.ps1')

function tryTabSwitch(label) {
  // Write label to a temp file so special characters (", `, spaces) can't break the command string
  const tmpArgs = path.join(os.tmpdir(), `cs-tablabel-${process.pid}.txt`)
  try {
    fs.writeFileSync(tmpArgs, label, 'utf8')
    execSync(
      `powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${FOCUS_TAB_PS1}" -Label (Get-Content -LiteralPath "${tmpArgs}" -Raw).Trim()`,
      { timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return 0
  } catch (err) {
    return (err && err.status != null) ? err.status : -1
  } finally {
    try { fs.unlinkSync(tmpArgs) } catch (_) {}
  }
}

function openNewTab(cwd, label, sessionId) {
  const resumeCmd = sessionId ? `claude --resume ${sessionId}` : `claude`
  // Use spawn args array — Node handles Windows path encoding; no manual quoting needed
  const args = [
    '-w', '0',
    'new-tab',
    '--title', `[${label}]`,
    '--startingDirectory', cwd || process.env.USERPROFILE || 'C:\\',
    // Note: if cwd is absent, WT falls back to %USERPROFILE% — acceptable degraded case
    'cmd', '/k', resumeCmd,
  ]
  try {
    spawn('wt.exe', args, { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

app.post('/api/sessions/:fileKey/focus', (req, res) => {
  const { fileKey } = req.params
  let focused = false
  let opened  = false
  const dbg   = {}

  try {
    const sessionFile = path.join(sessionsDir, fileKey + '.json')
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    const { pid, sessionId, cwd } = session

    const m     = readMeta(metaFile)
    const entry = m[cwd] || {}
    const label = entry.label || session.project || fileKey

    dbg.pid = pid; dbg.sessionId = sessionId; dbg.label = label

    if (IS_MAC) {
      const result = macHandleFocus(session, m, dbg)
      focused = result.focused
      opened = result.opened
    } else {
      // Windows focus logic
      const alive = isAlive(pid)
      dbg.alive = alive

      if (alive) {
        const exitCode = tryTabSwitch(label)
        dbg.tabSwitchExit = exitCode

        if (exitCode === 0) {
          focused = true
        } else {
          const stillAlive = exitCode === 1 ? true : isAlive(pid)
          if (stillAlive) {
            const claudePid = findClaudePid(sessionId, pid)
            const settings  = m._settings || {}
            const termPid   = claudePid
              ? walkToTerminal(claudePid, settings.preferredTerminal) || walkToTerminal(pid, settings.preferredTerminal)
              : walkToTerminal(pid, settings.preferredTerminal)
            if (termPid) focused = focusWindow(termPid).focused
            dbg.fallbackTermPid = termPid
          } else {
            dbg.diedDuringSwitch = true
            const resumeId = sessionId || entry.lastSessionId || null
            opened = openNewTab(cwd, label, resumeId)
          }
        }
      } else {
        const resumeId = sessionId || entry.lastSessionId || null
        dbg.resumeId = resumeId
        opened = openNewTab(cwd, label, resumeId)
      }
    }
  } catch (err) {
    dbg.error = err.message
  }

  console.log('[focus]', fileKey, dbg)
  res.json({ focused, opened, dbg })
})

// ── Terminals + Settings ───────────────────────────────────────────────────────

const KNOWN_TERMINALS = [
  { name: 'WindowsTerminal', label: 'Windows Terminal' },
  { name: 'Warp',            label: 'Warp' },
  { name: 'ConEmu64',        label: 'ConEmu / Cmder (64-bit)' },
  { name: 'ConEmu',          label: 'ConEmu / Cmder (32-bit)' },
  { name: 'Code',            label: 'VS Code (integrated terminal)' },
  { name: 'mintty',          label: 'Git Bash / Mintty' },
  { name: 'Hyper',           label: 'Hyper' },
]

const MAC_KNOWN_TERMINALS = [
  { name: 'Terminal',   label: 'Terminal.app' },
  { name: 'iTerm2',     label: 'iTerm2' },
  { name: 'Warp',       label: 'Warp' },
  { name: 'kitty',      label: 'kitty' },
  { name: 'Alacritty',  label: 'Alacritty' },
  { name: 'WezTerm',    label: 'WezTerm' },
  { name: 'Code',       label: 'VS Code (integrated terminal)' },
  { name: 'Cursor',     label: 'Cursor' },
  { name: 'Hyper',      label: 'Hyper' },
]

app.get('/api/terminals', (req, res) => {
  let running = []
  const termList = IS_MAC ? MAC_KNOWN_TERMINALS : KNOWN_TERMINALS

  if (IS_MAC) {
    try {
      const raw = execSync('ps -eo comm=', {
        timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']
      }).toString()
      for (const t of termList) {
        if (raw.toLowerCase().includes(t.name.toLowerCase())) running.push(t.name)
      }
    } catch (_) {}
  } else {
    try {
      const nameList = termList.map(t => `'${t.name}'`).join(',')
      const script = `Get-Process | Where-Object { ($_.Name -replace '\\.exe$','') -in @(${nameList}) } | Select-Object -ExpandProperty Name -Unique | ForEach-Object { $_ -replace '\\.exe$','' } | ConvertTo-Json -Compress`
      const raw = execSync(`powershell.exe -NonInteractive -Command "${script}"`,
        { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (raw) {
        const names = JSON.parse(raw)
        running = Array.isArray(names) ? names : [names]
      }
    } catch (_) {}
  }

  const settings = (readMeta(metaFile)._settings) || {}
  res.json({
    terminals: termList.map(t => ({
      ...t,
      running: running.includes(t.name),
    })),
    preferred: settings.preferredTerminal || null,
  })
})

app.get('/api/settings', (req, res) => {
  const m = readMeta(metaFile)
  res.json(m._settings || {})
})

app.post('/api/settings', (req, res) => {
  meta = readMeta(metaFile)
  meta._settings = { ...(meta._settings || {}), ...req.body }
  writeMeta(metaFile, meta)
  res.json({ ok: true })
})

// ── Static (production) ───────────────────────────────────────────────────────

const DIST = path.join(__dirname, '..', 'web', 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) res.sendFile(path.join(DIST, 'index.html'))
  })
}

server.listen(PORT, () => {
  console.log(`claudeSession running on http://localhost:${PORT}`)
})

module.exports = { app, broadcast }
