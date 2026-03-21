const express    = require('express')
const http       = require('http')
const { WebSocketServer } = require('ws')
const chokidar   = require('chokidar')
const fs         = require('fs')
const os         = require('os')
const path       = require('path')
const { execSync } = require('child_process')
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

// Process discovery: find running Claude sessions not yet in sessions dir
try {
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

// Known terminal process names (no .exe suffix)
const TERMINAL_NAMES = ['WindowsTerminal', 'ConEmu64', 'ConEmu', 'Code', 'mintty', 'Hyper', 'Warp']

function findClaudePid(sessionId, fallbackPid) {
  // 1. Check numeric PID files in sessions dir (written by claudeMonitor or similar)
  try {
    for (const f of fs.readdirSync(sessionsDir)) {
      if (!/^\d+\.json$/.test(f)) continue
      try {
        const d = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'))
        if (d.sessionId === sessionId) return d.pid
      } catch (_) {}
    }
  } catch (_) {}

  // 2. WMI scan for Claude process with --resume <sessionId>
  if (sessionId) {
    try {
      const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*claude-code*cli.js*--resume*${sessionId}*' } | Select-Object -First 1 -ExpandProperty ProcessId`
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
      `  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -EA SilentlyContinue;`,
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
if (-not $proc -or $proc.MainWindowHandle -eq 0) { exit }
$hwnd = $proc.MainWindowHandle
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@ -ErrorAction SilentlyContinue
[WinFocus]::ShowWindow($hwnd, 9)
$fg = [WinFocus]::GetForegroundWindow()
$fgTid = 0; [WinFocus]::GetWindowThreadProcessId($fg, [ref]$fgTid) | Out-Null
$myTid = [WinFocus]::GetCurrentThreadId()
[WinFocus]::AttachThreadInput($myTid, $fgTid, $true) | Out-Null
[WinFocus]::SetForegroundWindow($hwnd) | Out-Null
[WinFocus]::AttachThreadInput($myTid, $fgTid, $false) | Out-Null
Write-Output "focused"
`
  try {
    fs.writeFileSync(tmpScript, ps)
    const out = execSync(
      `powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${tmpScript}"`,
      { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim()
    return out === 'focused'
  } catch (_) {
    return false
  } finally {
    try { fs.unlinkSync(tmpScript) } catch (_) {}
  }
}

app.post('/api/sessions/:fileKey/focus', (req, res) => {
  const { fileKey } = req.params
  let focused = false
  try {
    const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, fileKey + '.json'), 'utf8'))
    const { pid, terminalPid, sessionId } = session
    const settings = (readMeta(metaFile)._settings) || {}

    // Use pre-recorded terminal PID if available
    let targetPid = terminalPid || null

    if (!targetPid) {
      const claudePid = findClaudePid(sessionId, pid)
      if (claudePid) targetPid = walkToTerminal(claudePid, settings.preferredTerminal)
    }

    if (targetPid) focused = focusWindow(targetPid)
  } catch (_) {}
  res.json({ focused })
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

app.get('/api/terminals', (req, res) => {
  let running = []
  try {
    const nameList = KNOWN_TERMINALS.map(t => `'${t.name}'`).join(',')
    const script = `Get-Process | Where-Object { ($_.Name -replace '\\.exe$','') -in @(${nameList}) } | Select-Object -ExpandProperty Name -Unique | ForEach-Object { $_ -replace '\\.exe$','' } | ConvertTo-Json -Compress`
    const raw = execSync(`powershell.exe -NonInteractive -Command "${script}"`,
      { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (raw) {
      const names = JSON.parse(raw)
      running = Array.isArray(names) ? names : [names]
    }
  } catch (_) {}

  const settings = (readMeta(metaFile)._settings) || {}
  res.json({
    terminals: KNOWN_TERMINALS.map(t => ({
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
