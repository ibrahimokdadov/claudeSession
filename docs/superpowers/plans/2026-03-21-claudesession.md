# claudeSession Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive browser dashboard (kanban + side drawer) that shows all active Claude Code sessions color-coded by project, with live status updates via WebSocket, and reflects session colors/labels in Windows Terminal tab titles.

**Architecture:** Existing `~/.claude/session-hook.js` is modified to write a `pid` field and emit ANSI escape codes for tab title/color. A Node.js/Express server (port 3333) watches `~/.claude/sessions/` via chokidar and pushes updates to a React/Vite frontend over WebSocket. The frontend renders a kanban board (Waiting/Working/Done/Idle) with a slide-in drawer for per-session actions (rename, recolor, kill, focus).

**Tech Stack:** Node.js, Express, ws, chokidar, React, Vite, concurrently, vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `~/.claude/session-hook.js` | Modify | Add `pid` field + ANSI escape stdout for tab title/color |
| `src/colorPalette.js` | Create | 10-color palette constant |
| `src/meta.js` | Create | Read/write session-meta.json with atomic writes |
| `src/sessions.js` | Create | In-memory session store + merge logic |
| `src/server.js` | Create | Express + ws + chokidar, REST API, startup |
| `web/index.html` | Create | Vite entry point |
| `web/vite.config.js` | Create | Proxy /api and /ws to :3333 |
| `web/src/App.jsx` | Create | WebSocket connection, session state (Map), reconnect |
| `web/src/Board.jsx` | Create | 4 kanban columns |
| `web/src/SessionCard.jsx` | Create | Card with color strip, label, status, timestamp |
| `web/src/Drawer.jsx` | Create | Side panel: label input, color swatches, actions |
| `web/src/useRelativeTime.js` | Create | Hook: formats ms → "4m", "2h 15m" |
| `package.json` | Create | Dependencies + scripts |
| `tests/meta.test.js` | Create | Unit tests for meta read/write/corrupt handling |
| `README.md` | Create | Setup instructions |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `web/index.html`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claudesession",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "dev": "concurrently \"node src/server.js\" \"vite web/\"",
    "build": "vite build web/",
    "start": "node src/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "express": "^4.18.2",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "concurrently": "^8.2.2",
    "vite": "^5.1.4",
    "vitest": "^1.3.1"
  }
}
```

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p src web/src tests
```

- [ ] **Step 3: Create `web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>claudeSession</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `web/src/main.jsx`**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 5: Create `vitest.config.js`** — needed because the project is CJS but vitest needs to know how to handle it

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  }
})
```

> **Note:** `vitest.config.js` uses ES module syntax (`import`) even though `package.json` is `"type": "commonjs"` — Vite/Vitest handle this automatically. Tests themselves must use `require()` (not `import`) to stay consistent with the CJS project.

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
web/dist/
.superpowers/
*.tmp.*
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json vitest.config.js web/index.html web/src/main.jsx .gitignore
git commit -m "feat: project scaffold"
```

---

## Task 2: Color Palette + Meta Module

**Files:**
- Create: `src/colorPalette.js`
- Create: `src/meta.js`
- Create: `tests/meta.test.js`

- [ ] **Step 1: Write failing tests for meta module**

Create `tests/meta.test.js`:

```js
const { describe, it, expect, beforeEach, afterEach } = require('vitest')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { readMeta, writeMeta, ensureProject } = require('../src/meta.js')

let tmpDir, metaFile

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'))
  metaFile = path.join(tmpDir, 'session-meta.json')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('readMeta', () => {
  it('returns default when file missing', () => {
    const m = readMeta(metaFile)
    expect(m).toEqual({ _colorIndex: 0 })
  })

  it('returns parsed content when file exists', () => {
    fs.writeFileSync(metaFile, JSON.stringify({ _colorIndex: 2, '/some/path': { label: 'test', color: '#aaa', firstSeen: '2026-01-01T00:00:00.000Z' } }))
    const m = readMeta(metaFile)
    expect(m._colorIndex).toBe(2)
    expect(m['/some/path'].label).toBe('test')
  })

  it('resets to default on corrupt file', () => {
    fs.writeFileSync(metaFile, 'NOT JSON {{{')
    const m = readMeta(metaFile)
    expect(m).toEqual({ _colorIndex: 0 })
  })
})

describe('writeMeta', () => {
  it('writes atomically (tmp file is gone after write)', () => {
    const meta = { _colorIndex: 1 }
    writeMeta(metaFile, meta)
    const files = fs.readdirSync(tmpDir)
    expect(files.some(f => f.includes('.tmp.'))).toBe(false)
    expect(files).toContain('session-meta.json')
  })

  it('written content is readable', () => {
    const meta = { _colorIndex: 5, '/foo': { label: 'foo', color: '#111', firstSeen: '2026-01-01T00:00:00.000Z' } }
    writeMeta(metaFile, meta)
    const read = readMeta(metaFile)
    expect(read).toEqual(meta)
  })
})

describe('ensureProject', () => {
  it('assigns first palette color to new project', () => {
    const meta = readMeta(metaFile)
    const updated = ensureProject(meta, '/new/project', 'project')
    expect(updated['/new/project'].color).toBe('#58a6ff')
    expect(updated['/new/project'].label).toBe('project')
    expect(updated['/new/project'].firstSeen).toBeTruthy()
    expect(updated._colorIndex).toBe(1)
  })

  it('does not overwrite existing project entry', () => {
    const meta = { _colorIndex: 1, '/existing': { label: 'custom', color: '#ff0000', firstSeen: '2026-01-01T00:00:00.000Z' } }
    const updated = ensureProject(meta, '/existing', 'existing')
    expect(updated['/existing'].color).toBe('#ff0000')
    expect(updated['/existing'].label).toBe('custom')
    expect(updated._colorIndex).toBe(1)
  })

  it('wraps color index after 10', () => {
    let meta = { _colorIndex: 9 }
    meta = ensureProject(meta, '/p9', 'p9')
    expect(meta['/p9'].color).toBe('#ff7b72') // palette[9]
    meta = ensureProject(meta, '/p10', 'p10')
    expect(meta['/p10'].color).toBe('#58a6ff') // palette[0] (wrap)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (modules not defined)**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../src/meta.js'`

- [ ] **Step 3: Create `src/colorPalette.js`**

```js
const PALETTE = [
  '#58a6ff', '#f85149', '#3fb950', '#e3b341', '#bc8cff',
  '#f78166', '#79c0ff', '#56d364', '#ffa657', '#ff7b72'
]

module.exports = { PALETTE }
```

- [ ] **Step 4: Create `src/meta.js`**

```js
const fs = require('fs')
const path = require('path')
const { PALETTE } = require('./colorPalette.js')

function readMeta(metaFile) {
  try {
    return JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn('[meta] corrupt session-meta.json, resetting:', e.message)
    }
    return { _colorIndex: 0 }
  }
}

function writeMeta(metaFile, meta) {
  const tmp = metaFile + '.tmp.' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2))
  fs.renameSync(tmp, metaFile)
}

function ensureProject(meta, cwd, projectName) {
  if (meta[cwd]) return meta
  const color = PALETTE[meta._colorIndex % PALETTE.length]
  return {
    ...meta,
    _colorIndex: (meta._colorIndex || 0) + 1,
    [cwd]: {
      label: projectName,
      color,
      firstSeen: new Date().toISOString()
    }
  }
}

module.exports = { readMeta, writeMeta, ensureProject }
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/colorPalette.js src/meta.js tests/meta.test.js
git commit -m "feat: color palette and session-meta module with tests"
```

---

## Task 3: Modify session-hook.js

**Files:**
- Modify: `~/.claude/session-hook.js`

> **Note:** This file lives outside the repo at `~/.claude/session-hook.js`. Back it up before editing. The file is short (~45 lines) — read it fully before editing.

- [ ] **Step 1: Back up the existing hook**

```bash
cp ~/.claude/session-hook.js ~/.claude/session-hook.js.bak
```

- [ ] **Step 2: Read the current file**

```bash
cat ~/.claude/session-hook.js
```

- [ ] **Step 3: Add `pid` + ANSI escapes**

After the existing `fs.writeFileSync(...)` call that writes the session file, add:

```js
// After the existing writeFileSync block:

// Emit ANSI escapes for Windows Terminal tab title + color
try {
  const metaPath = path.join(os.homedir(), '.claude', 'session-meta.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
  const entry = meta[cwd] || {};
  const label = entry.label || project;
  const color = entry.color || null;
  process.stdout.write(`\x1b]0;[${label}] ${status}\x07`);
  if (color) process.stdout.write(`\x1b]9;8;"${color}"\x07`);
} catch (_) {}
```

Also add `pid: process.ppid` to the JSON written in the existing `writeFileSync` call:

```js
// Change the existing writeFileSync to include pid:
fs.writeFileSync(
  path.join(sessionsDir, project + '.json'),
  JSON.stringify({ project, status, message, cwd, sessionId, pid: process.ppid, timestamp: Date.now() })
);
```

- [ ] **Step 4: Verify hook runs without error**

```bash
echo '{"session_id":"test-123"}' | node ~/.claude/session-hook.js working
```

Expected: no error output, a file `~/.claude/sessions/<current-project>.json` exists with `pid` field.

```bash
cat ~/.claude/sessions/*.json | grep pid
```

Expected: `"pid": <some number>`

- [ ] **Step 5: Commit the modified hook into the repo as a reference copy**

```bash
cp ~/.claude/session-hook.js session-hook.js
git add session-hook.js
git commit -m "feat: session-hook.js — add pid and ANSI tab title/color"
```

---

## Task 4: Backend Core — Startup, Chokidar, WebSocket

**Files:**
- Create: `src/sessions.js`
- Create: `src/server.js` (partial — startup + WS only, REST in next task)

- [ ] **Step 1: Create `src/sessions.js`** — in-memory session store

```js
const fs = require('fs')
const path = require('path')
const os = require('os')

const sessionsDir = path.join(os.homedir(), '.claude', 'sessions')
const metaFile = path.join(os.homedir(), '.claude', 'session-meta.json')

// In-memory store: Map<projectName, sessionObject>
const store = new Map()

function mergeMeta(session, meta) {
  const entry = meta[session.cwd] || {}
  return {
    ...session,
    label: entry.label || session.project,
    color: entry.color || '#8b949e',
    firstSeen: entry.firstSeen || null
  }
}

function loadAll(meta) {
  store.clear()
  if (!fs.existsSync(sessionsDir)) return
  for (const file of fs.readdirSync(sessionsDir)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'))
      store.set(raw.project, mergeMeta(raw, meta))
    } catch (_) {}
  }
}

function updateFromFile(filePath, meta) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const merged = mergeMeta(raw, meta)
    store.set(raw.project, merged)
    return merged
  } catch (_) {
    return null
  }
}

function removeByFile(filePath) {
  const project = path.basename(filePath, '.json')
  store.delete(project)
  return project
}

function getAll() {
  return Array.from(store.values())
}

function getByProject(project) {
  return store.get(project) || null
}

module.exports = { store, loadAll, updateFromFile, removeByFile, getAll, getByProject, sessionsDir, metaFile }
```

- [ ] **Step 2: Create `src/server.js`** — startup + WS (no REST yet)

```js
const express = require('express')
const http = require('http')
const { WebSocketServer } = require('ws')
const chokidar = require('chokidar')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')
const { readMeta, writeMeta, ensureProject } = require('./meta.js')
const { loadAll, updateFromFile, removeByFile, getAll, getByProject, sessionsDir, metaFile } = require('./sessions.js')

const PORT = process.env.PORT || 3333
const app = express()
app.use(express.json())

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data)
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

fs.mkdirSync(sessionsDir, { recursive: true })

let meta = readMeta(metaFile)
loadAll(meta)

// Process discovery: find running Claude sessions not yet in sessions dir
try {
  const raw = execSync(
    'powershell.exe -NonInteractive -Command "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like \'*claude-code/cli.js*\' } | Select-Object ProcessId,CommandLine,ParentProcessId | ConvertTo-Json -Compress"',
    { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
  ).toString().trim()
  if (raw) {
    const procs = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)]
    const projectsDir = path.join(os.homedir(), '.claude', 'projects')
    for (const proc of procs) {
      const resumeMatch = proc.CommandLine && proc.CommandLine.match(/--resume\s+([a-f0-9-]{36})/)
      const sessionId = resumeMatch ? resumeMatch[1] : null
      if (!sessionId || !fs.existsSync(projectsDir)) continue
      // Find project dir by sessionId
      for (const dir of fs.readdirSync(projectsDir)) {
        try {
          if (!fs.readdirSync(path.join(projectsDir, dir)).some(f => f.startsWith(sessionId))) continue
          // Decode dir name to path (e.g. C--Users-ibrah-foo → C:\Users\ibrah\foo)
          const cwd = dir.replace('--', ':\\').replace(/-/g, '\\')
          const project = path.basename(cwd)
          const sessionFile = path.join(sessionsDir, project + '.json')
          if (!fs.existsSync(sessionFile)) {
            meta = ensureProject(meta, cwd, project)
            writeMeta(metaFile, meta)
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
} catch (_) {}

// ── WebSocket ─────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'snapshot', sessions: getAll() }))
})

// ── Chokidar ──────────────────────────────────────────────────────────────────

chokidar.watch(sessionsDir, { ignoreInitial: true }).on('all', (event, filePath) => {
  if (!filePath.endsWith('.json')) return
  if (event === 'add' || event === 'change') {
    meta = readMeta(metaFile)
    const session = updateFromFile(filePath, meta)
    if (session) broadcast({ type: 'session_updated', session })
  } else if (event === 'unlink') {
    const project = removeByFile(filePath)
    broadcast({ type: 'session_removed', project })
  }
})

// ── REST placeholder (added in next task) ────────────────────────────────────

server.listen(PORT, () => {
  console.log(`claudeSession running on http://localhost:${PORT}`)
})

module.exports = { app, broadcast, meta: () => meta, setMeta: (m) => { meta = m } }
```

- [ ] **Step 3: Run the server and verify startup**

```bash
node src/server.js
```

Expected output: `claudeSession running on http://localhost:3333`
No errors. If Claude sessions are running, you should see them discovered in the sessions dir.

- [ ] **Step 4: Verify WebSocket delivers snapshot**

In a separate terminal:
```bash
node -e "
const ws = new (require('ws'))('ws://localhost:3333/ws');
ws.on('message', d => { console.log(JSON.parse(d)); process.exit(0); });
"
```

Expected: prints `{ type: 'snapshot', sessions: [...] }`.

- [ ] **Step 5: Commit**

```bash
git add src/sessions.js src/server.js
git commit -m "feat: backend core — startup, chokidar, WebSocket"
```

---

## Task 5: Backend REST API

**Files:**
- Modify: `src/server.js` (add REST routes before `server.listen`)

- [ ] **Step 1: Add `GET /api/sessions`**

Add before `server.listen(...)`:

```js
app.get('/api/sessions', (req, res) => {
  res.json(getAll())
})
```

- [ ] **Step 2: Add `PATCH /api/sessions/:project`**

```js
app.patch('/api/sessions/:project', (req, res) => {
  const { project } = req.params
  const { label, color } = req.body
  meta = readMeta(metaFile)

  // Get cwd from session file; fall back to project name as synthetic cwd
  let cwd = project
  const sessionFile = path.join(sessionsDir, project + '.json')
  try {
    cwd = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).cwd || project
  } catch (_) {}

  meta = ensureProject(meta, cwd, project)
  if (label !== undefined) meta[cwd].label = label
  if (color !== undefined) meta[cwd].color = color
  writeMeta(metaFile, meta)

  // Merge and broadcast immediately
  const current = getByProject(project)
  if (current) {
    const updated = { ...current, label: meta[cwd].label, color: meta[cwd].color }
    require('./sessions.js').store.set(project, updated)
    broadcast({ type: 'session_updated', session: updated })
  }

  res.json({ ok: true })
})
```

- [ ] **Step 3: Add `DELETE /api/sessions/:project`**

```js
app.delete('/api/sessions/:project', (req, res) => {
  const { project } = req.params
  const sessionFile = path.join(sessionsDir, project + '.json')

  // Kill process
  try {
    const { pid } = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    if (pid) {
      execSync(
        `powershell.exe -NonInteractive -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`,
        { timeout: 5000, stdio: 'ignore' }
      )
    }
  } catch (_) {}

  // Always delete session file
  try { fs.unlinkSync(sessionFile) } catch (_) {}

  // Remove from store and broadcast
  removeByFile(sessionFile)
  broadcast({ type: 'session_removed', project })

  res.json({ ok: true })
})
```

- [ ] **Step 4: Add `POST /api/sessions/:project/focus`**

```js
app.post('/api/sessions/:project/focus', (req, res) => {
  const { project } = req.params
  let focused = false
  try {
    const { pid } = JSON.parse(fs.readFileSync(path.join(sessionsDir, project + '.json'), 'utf8'))
    if (pid) {
      const script = `
        $pid = ${pid};
        $wt = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Where-Object {
          (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($_.Id)").ProcessId -contains $pid
        } | Select-Object -First 1;
        if ($wt) {
          Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }';
          [W]::SetForegroundWindow($wt.MainWindowHandle);
          Write-Output "focused"
        }
      `
      const out = execSync(`powershell.exe -NonInteractive -Command "${script.replace(/\n/g, ' ')}"`,
        { timeout: 6000 }).toString().trim()
      focused = out === 'focused'
    }
  } catch (_) {}
  res.json({ focused })
})
```

- [ ] **Step 5: Serve static frontend in production mode**

Add before routes:

```js
const DIST = path.join(__dirname, '..', 'web', 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) res.sendFile(path.join(DIST, 'index.html'))
  })
}
```

- [ ] **Step 6: Test REST endpoints manually**

With server running (`node src/server.js`):

```bash
# GET all sessions
curl http://localhost:3333/api/sessions

# PATCH — rename a session (replace 'postwriter' with an actual project name)
curl -X PATCH http://localhost:3333/api/sessions/postwriter \
  -H "Content-Type: application/json" \
  -d '{"label":"my writer","color":"#3fb950"}'

# Verify the change persisted
node -e "console.log(require('fs').readFileSync(require('os').homedir()+'/.claude/session-meta.json','utf8'))"
```

- [ ] **Step 7: Commit**

```bash
git add src/server.js
git commit -m "feat: REST API — GET, PATCH, DELETE, focus"
```

---

## Task 6: Frontend Scaffold — Vite Config + App Shell

**Files:**
- Create: `web/vite.config.js`
- Create: `web/src/App.jsx`
- Create: `web/src/App.css`

- [ ] **Step 1: Create `web/vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: { outDir: 'dist' },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3333',
      '/ws': { target: 'http://localhost:3333', ws: true }
    }
  }
})
```

- [ ] **Step 2: Create `web/src/App.css`** — global dark theme

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0d1117;
  color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
}

:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #1c2128;
  --border: #30363d;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --accent-waiting: #e3b341;
  --accent-working: #58a6ff;
  --accent-done: #3fb950;
  --accent-idle: #8b949e;
}

button {
  cursor: pointer;
  border: none;
  background: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

input {
  font-family: inherit;
  font-size: inherit;
}
```

- [ ] **Step 3: Create `web/src/App.jsx`** — WS connection + session state

```jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import Board from './Board.jsx'
import Drawer from './Drawer.jsx'
import './App.css'

const WS_URL = `ws://${location.host}/ws`

export default function App() {
  const [sessions, setSessions] = useState(new Map())  // Map<project, session>
  const [drawerProject, setDrawerProject] = useState(null)
  const wsRef = useRef(null)
  const retryDelay = useRef(1000)

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'snapshot') {
        setSessions(new Map(msg.sessions.map(s => [s.project, s])))
      } else if (msg.type === 'session_updated') {
        setSessions(prev => new Map(prev).set(msg.session.project, msg.session))
      } else if (msg.type === 'session_removed') {
        setSessions(prev => {
          const next = new Map(prev)
          next.delete(msg.project)
          return next
        })
        setDrawerProject(p => p === msg.project ? null : p)
      }
    }

    ws.onopen = () => { retryDelay.current = 1000 }

    ws.onclose = () => {
      setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 30000)
        connect()
      }, retryDelay.current)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  const sessionList = Array.from(sessions.values())
  const drawerSession = drawerProject ? sessions.get(drawerProject) : null

  function handleUpdate(project, patch) {
    fetch(`/api/sessions/${encodeURIComponent(project)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
  }

  function handleKill(project) {
    fetch(`/api/sessions/${encodeURIComponent(project)}`, { method: 'DELETE' })
  }

  function handleFocus(project) {
    return fetch(`/api/sessions/${encodeURIComponent(project)}/focus`, { method: 'POST' })
      .then(r => r.json())
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Board
        sessions={sessionList}
        activeProject={drawerProject}
        onSelect={p => setDrawerProject(p === drawerProject ? null : p)}
      />
      {drawerSession && (
        <Drawer
          session={drawerSession}
          onClose={() => setDrawerProject(null)}
          onUpdate={(patch) => handleUpdate(drawerSession.project, patch)}
          onKill={() => handleKill(drawerSession.project)}
          onFocus={() => handleFocus(drawerSession.project)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify dev server starts**

With the backend running (`node src/server.js` in one terminal):

```bash
npm run dev
```

Expected: Vite starts on `http://localhost:5173`, no compile errors (page will be blank — Board not built yet).

- [ ] **Step 5: Commit**

```bash
git add web/vite.config.js web/src/App.jsx web/src/App.css web/src/main.jsx
git commit -m "feat: frontend scaffold — Vite config, App shell, WS connection"
```

---

## Task 7: Board + SessionCard Components

**Files:**
- Create: `web/src/Board.jsx`
- Create: `web/src/SessionCard.jsx`
- Create: `web/src/useRelativeTime.js`

- [ ] **Step 1: Create `web/src/useRelativeTime.js`**

```js
import { useState, useEffect } from 'react'

export function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}

export function useRelativeTime(timestamp) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const update = () => {
      if (!timestamp) { setLabel(''); return }
      setLabel(formatDuration(Date.now() - new Date(timestamp).getTime()) + ' ago')
    }
    update()
    const id = setInterval(update, 10000)
    return () => clearInterval(id)
  }, [timestamp])
  return label
}
```

- [ ] **Step 2: Create `web/src/SessionCard.jsx`**

```jsx
import { useRelativeTime } from './useRelativeTime.js'

const STATUS_ICON = {
  waiting:  { icon: '⚡', color: 'var(--accent-waiting)' },
  working:  { icon: '▶', color: 'var(--accent-working)' },
  thinking: { icon: '◌', color: 'var(--accent-working)' },
  done:     { icon: '✓', color: 'var(--accent-done)' },
  running:  { icon: '–', color: 'var(--accent-idle)' },
}

export default function SessionCard({ session, isActive, onSelect }) {
  const timeAgo = useRelativeTime(session.timestamp)
  const { icon, color } = STATUS_ICON[session.status] || STATUS_ICON.running

  return (
    <div
      onClick={onSelect}
      style={{
        background: isActive ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        borderRadius: 6,
        borderLeft: `4px solid ${session.color || '#8b949e'}`,
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'background 0.1s',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: session.color || '#8b949e', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>
          {session.label || session.project}
        </span>
        <span style={{ color, fontSize: 11, marginLeft: 'auto' }}>
          {icon} {session.status}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
        <span style={{ fontFamily: 'monospace' }}>{session.message || ''}</span>
        <span>{timeAgo}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `web/src/Board.jsx`**

```jsx
import SessionCard from './SessionCard.jsx'

const COLUMNS = [
  { id: 'waiting',  label: 'Waiting',  statuses: ['waiting'],              borderColor: 'var(--accent-waiting)' },
  { id: 'working',  label: 'Working',  statuses: ['working', 'thinking'],  borderColor: 'var(--accent-working)' },
  { id: 'done',     label: 'Done',     statuses: ['done'],                 borderColor: 'var(--accent-done)' },
  { id: 'idle',     label: 'Idle',     statuses: ['running'],              borderColor: 'var(--accent-idle)' },
]

export default function Board({ sessions, activeProject, onSelect }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>claudeSession</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Columns */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        background: 'var(--border)',
        overflow: 'hidden',
      }}>
        {COLUMNS.map(col => {
          const cards = sessions.filter(s => col.statuses.includes(s.status))
          return (
            <div key={col.id} style={{
              background: 'var(--bg-primary)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              {/* Column header */}
              <div style={{
                padding: '10px 14px 8px',
                borderBottom: `2px solid ${col.borderColor}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {col.label}
                </span>
                <span style={{ fontSize: 11, color: col.borderColor, fontWeight: 700, marginLeft: 'auto' }}>
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cards.map(s => (
                  <SessionCard
                    key={s.project}
                    session={s}
                    isActive={activeProject === s.project}
                    onSelect={() => onSelect(s.project)}
                  />
                ))}
                {cards.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: '8px 2px', fontStyle: 'italic' }}>
                    none
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Start dev server and verify board renders**

With backend running:
```bash
npm run dev
```

Open `http://localhost:5173`. Expected: kanban board renders with 4 columns; any running Claude sessions appear as cards.

- [ ] **Step 5: Commit**

```bash
git add web/src/Board.jsx web/src/SessionCard.jsx web/src/useRelativeTime.js
git commit -m "feat: Board and SessionCard components"
```

---

## Task 8: Drawer Component

**Files:**
- Create: `web/src/Drawer.jsx`

- [ ] **Step 1: Create `web/src/Drawer.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react'
import { formatDuration } from './useRelativeTime.js'

// Palette duplicated here to avoid CJS/ESM cross-boundary issues with Vite
const COLORS = ['#58a6ff','#f85149','#3fb950','#e3b341','#bc8cff','#f78166','#79c0ff','#56d364','#ffa657','#ff7b72']

export default function Drawer({ session, onClose, onUpdate, onKill, onFocus }) {
  const [label, setLabel] = useState(session.label || session.project)
  const [killConfirm, setKillConfirm] = useState(false)
  const [focusMsg, setFocusMsg] = useState('')
  const killTimer = useRef(null)
  const inputRef = useRef(null)

  // Sync label when session changes
  useEffect(() => {
    setLabel(session.label || session.project)
  }, [session.project, session.label])

  // Auto-focus label input
  useEffect(() => {
    inputRef.current?.focus()
  }, [session.project])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function saveLabel() {
    const trimmed = label.trim()
    if (trimmed && trimmed !== (session.label || session.project)) {
      onUpdate({ label: trimmed })
    }
  }

  function handleKill() {
    if (!killConfirm) {
      setKillConfirm(true)
      killTimer.current = setTimeout(() => setKillConfirm(false), 3000)
    } else {
      clearTimeout(killTimer.current)
      onKill()
    }
  }

  async function handleFocus() {
    const result = await onFocus()
    if (result?.focused) {
      setFocusMsg('Focused!')
      setTimeout(() => setFocusMsg(''), 2000)
    }
  }

  const uptime = session.firstSeen
    ? 'running ' + formatDuration(Date.now() - new Date(session.firstSeen).getTime())
    : null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 10 }}
      />

      {/* Panel */}
      <div style={{
        position: 'relative',
        zIndex: 11,
        width: 300,
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: session.color || '#8b949e', flexShrink: 0 }} />
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.project}
          </span>
          <button onClick={onClose} style={{ color: 'var(--text-secondary)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Label */}
          <div>
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Label
            </label>
            <input
              ref={inputRef}
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={e => { if (e.key === 'Enter') { saveLabel(); e.target.blur() } }}
              style={{
                width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '6px 8px', color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
          </div>

          {/* Color */}
          <div>
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              Color
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onUpdate({ color: c })}
                  style={{
                    width: 22, height: 22, borderRadius: '50%', background: c, padding: 0,
                    outline: c === session.color ? '2px solid white' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Path */}
          <div>
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              Path
            </label>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all', userSelect: 'text' }}>
              {session.cwd}
            </div>
          </div>

          {/* Session ID */}
          {session.sessionId && (
            <div>
              <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Session ID
              </label>
              <button
                onClick={() => navigator.clipboard.writeText(session.sessionId)}
                style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', padding: 0, textAlign: 'left' }}
                title="Click to copy"
              >
                {session.sessionId.slice(0, 8)}…
              </button>
            </div>
          )}

          {/* Uptime */}
          {uptime && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{uptime}</div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button
            onClick={handleFocus}
            style={{
              flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: 4, padding: '7px 0', fontSize: 12, color: 'var(--text-primary)',
            }}
          >
            {focusMsg || 'Focus'}
          </button>
          <button
            onClick={handleKill}
            style={{
              flex: 1, background: killConfirm ? '#f8514930' : 'var(--bg-tertiary)',
              border: `1px solid ${killConfirm ? '#f85149' : 'var(--border)'}`,
              borderRadius: 4, padding: '7px 0', fontSize: 12,
              color: killConfirm ? '#f85149' : 'var(--text-primary)',
              transition: 'all 0.15s',
            }}
          >
            {killConfirm ? 'Confirm kill?' : 'Kill'}
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify drawer opens on card click**

With `npm run dev` running:
1. Open `http://localhost:5173`
2. Click a session card
3. Verify drawer slides in from the right with label, color swatches, path, session ID, Focus + Kill buttons
4. Press Escape — drawer closes
5. Click outside drawer — drawer closes

- [ ] **Step 3: Verify label save**

1. Click a card, clear label, type a new name, press Enter
2. Check `~/.claude/session-meta.json` — entry should have new label
3. Card on the board should update via WebSocket

- [ ] **Step 4: Verify color change**

1. Click a color swatch in drawer
2. Card border color should update immediately
3. Confirm `session-meta.json` has new color

- [ ] **Step 5: Commit**

```bash
git add web/src/Drawer.jsx
git commit -m "feat: Drawer component — label, color, kill, focus"
```

---

## Task 9: Integration Tests + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Full integration test — live sessions**

Open 3 Claude Code sessions in different project directories. Then:

```bash
npm run dev
```

Open `http://localhost:5173`. Verify:
- [ ] All sessions appear in the correct kanban column
- [ ] Status updates live (run a tool in one session — card moves to Working)
- [ ] Session waits for input (Notification fires) — card moves to Waiting column

- [ ] **Step 2: Integration test — persistence**

```bash
# Stop the server (Ctrl+C), restart it
npm run dev
```

Open browser. Verify:
- [ ] Labels and colors restored from session-meta.json
- [ ] Board repopulates from snapshot on reconnect

- [ ] **Step 3: Integration test — kill**

1. Click a session card
2. Click Kill, then Confirm kill
3. Verify the card disappears from the board
4. In Task Manager: verify the Claude process is gone

- [ ] **Step 4: Integration test — tab title**

Open a new Claude Code session in a project directory. Verify:
- Windows Terminal tab title changes to `[projectname] running`

After a hook event (e.g., a tool fires):
- Tab title changes to `[projectname] working`

- [ ] **Step 5: Integration test — browser reconnect**

1. Kill the server (`Ctrl+C`)
2. Verify the browser shows no visual error (blank board or stale data is fine)
3. Restart: `npm run dev`
4. Verify browser reconnects and board repopulates within 30s

- [ ] **Step 6: Integration test — process discovery**

1. Start a Claude session in project "postwriter"
2. Delete its session file: `rm ~/.claude/sessions/postwriter.json`
3. Start the claudeSession server fresh: `npm run dev`
4. Open browser — verify "postwriter" appears in Idle column (discovered via WMI)

- [ ] **Step 7: Create `README.md`**

```markdown
# claudeSession

Interactive browser dashboard for Claude Code sessions — color-coded, labeled, and live.

## What it does

- **Kanban board** — sessions organized by status: Waiting / Working / Done / Idle
- **Color-coded tabs** — Windows Terminal tab titles and colors reflect each project
- **Side drawer** — rename sessions, change colors, kill processes, focus windows
- **Persistent** — labels and colors survive server restarts

## Quick start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:5173

## Setup

1. Hooks are already configured in `~/.claude/settings.json` (calls `session-hook.js`)
2. Copy the updated `session-hook.js` from this repo to `~/.claude/session-hook.js`:
   \`\`\`bash
   cp session-hook.js ~/.claude/session-hook.js
   \`\`\`

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev mode — backend + Vite (port 5173) |
| `npm start` | Production — backend serves built frontend (port 3333) |
| `npm run build` | Build React app to `web/dist/` |
| `npm test` | Run unit tests |

## How it works

Each Claude Code session fires hooks that write status files to `~/.claude/sessions/`.
This server watches those files via chokidar and pushes updates to the browser over WebSocket.
Labels and colors are stored in `~/.claude/session-meta.json`.
```

- [ ] **Step 8: Final commit**

```bash
git add README.md
git commit -m "feat: README and integration testing complete"
```

---

## Completion Checklist

- [ ] `session-hook.js` writes `pid` + ANSI tab title/color
- [ ] `session-meta.json` atomic writes with corruption recovery
- [ ] Server starts, discovers sessions, serves WebSocket snapshot
- [ ] Kanban board live-updates on hook events
- [ ] Drawer: label rename → saved + broadcast
- [ ] Drawer: color change → saved + broadcast + WT tab updates on next hook
- [ ] Kill: process terminated, card removed, meta retained
- [ ] Focus: Windows Terminal window brought to front
- [ ] Browser reconnects after server restart
- [ ] Labels + colors persist across server restarts
