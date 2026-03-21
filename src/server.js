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

app.post('/api/sessions/:fileKey/focus', (req, res) => {
  const { fileKey } = req.params
  let focused = false
  try {
    const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, fileKey + '.json'), 'utf8'))
    const { pid, terminalPid, terminalType } = session

    // Determine which terminal PID to focus
    let targetPid = terminalPid || null

    // If no pre-recorded terminal, walk the tree now using the preferred terminal setting
    if (!targetPid && pid) {
      const settings = (readMeta(metaFile)._settings) || {}
      const preferred = settings.preferredTerminal || null
      const KNOWN = preferred
        ? [preferred]
        : ['WindowsTerminal', 'ConEmu64', 'ConEmu', 'Code', 'mintty', 'Hyper']
      const knownList = KNOWN.map(n => `'${n}'`).join(',')
      const walkScript = [
        `$known = @(${knownList});`,
        `$p = ${pid};`,
        `for ($i = 0; $i -lt 10; $i++) {`,
        `  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -EA SilentlyContinue;`,
        `  if (-not $proc) { break }`,
        `  $name = $proc.Name -replace '\\.exe$','';`,
        `  if ($name -in $known) { Write-Output $proc.ProcessId; break }`,
        `  if ($proc.ParentProcessId -le 0) { break }`,
        `  $p = $proc.ParentProcessId`,
        `}`,
      ].join(' ')
      const raw = execSync(`powershell.exe -NonInteractive -Command "${walkScript}"`,
        { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (raw) targetPid = parseInt(raw, 10) || null
    }

    if (targetPid) {
      const focusScript = [
        `$proc = Get-Process -Id ${targetPid} -EA SilentlyContinue;`,
        `if ($proc -and $proc.MainWindowHandle -ne 0) {`,
        `  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport(""user32.dll"")] public static extern bool SetForegroundWindow(IntPtr h); }' -EA SilentlyContinue;`,
        `  [W]::SetForegroundWindow($proc.MainWindowHandle);`,
        `  Write-Output "focused"`,
        `}`,
      ].join(' ')
      const out = execSync(`powershell.exe -NonInteractive -Command "${focusScript}"`,
        { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      focused = out === 'focused'
    }
  } catch (_) {}
  res.json({ focused })
})

// ── Terminals + Settings ───────────────────────────────────────────────────────

const KNOWN_TERMINALS = [
  { name: 'WindowsTerminal', label: 'Windows Terminal' },
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
