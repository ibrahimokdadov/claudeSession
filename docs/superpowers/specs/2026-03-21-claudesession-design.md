# claudeSession — Design Spec

**Date:** 2026-03-21
**Status:** Approved

---

## Problem

Every Claude Code terminal window and tab shows the same title: "Claude Code". With 10–20+ sessions open across projects you cannot tell:

- Which terminal belongs to which project
- What state each session is in (working / waiting / done / idle)
- Which sessions are related (root vs. spawned subagents)

claudeMonitor solves the monitoring problem with a terminal dashboard. claudeSession solves the **identity problem** — labeling, color-coding, and controlling individual sessions from an interactive browser dashboard.

---

## Goals

- Browser-based interactive dashboard showing all active Claude Code sessions
- Kanban layout organized by session status (Waiting / Working / Done / Idle)
- Per-session color coding reflected in both the dashboard and Windows Terminal tab colors
- Persistent labels and colors per project (survive restarts)
- Actions: rename, recolor, kill, focus window
- Distinct from claudeMonitor (terminal TUI, read-only) and taskaude (task output streaming)

---

## Out of Scope (v1)

- Sending messages/commands into sessions (no Claude Code stdin API)
- Per-tab focus (Windows Terminal doesn't expose per-tab window handles; focus is at window level)
- Mobile/remote access

---

## Architecture

```
Claude Code sessions (each terminal)
        │
        │ hooks fire on every event
        ▼
session-hook.js  ──→  ~/.claude/sessions/<project>.json   (status, tool, pid, sessionId, cwd)
                  ──→  ANSI escape codes → terminal tab    (title + color, from session-meta.json)

~/.claude/session-meta.json  ←──  server.js (atomic writes on rename/recolor)
        │
        │ chokidar watches for file changes
        ▼
server.js (Node.js, Express + ws, port 3333)
  ├── chokidar: watches ~/.claude/sessions/
  ├── WebSocket at /ws: typed messages to browser
  ├── REST API: GET/PATCH/DELETE /api/sessions/:project, POST /api/sessions/:project/focus
  └── serves React/Vite frontend (dev: proxy; prod: web/dist/)
        │
        ▼
Browser dashboard (React + Vite)
  ├── Kanban board: Waiting / Working / Done / Idle columns
  ├── Session cards: color-coded, live status
  └── Side drawer: label edit, color swatches, path, session ID, uptime, Kill, Focus
```

---

## Components

### 1. `session-hook.js` (existing, modified)

Already lives at `~/.claude/session-hook.js`. **One modification:** add `pid` to the session JSON output, and write ANSI escape sequences to stdout after writing the file.

**Session file written** (`pid` is new):
```json
{
  "project": "postwriter",
  "status": "working",
  "message": "Bash",
  "cwd": "C:/Users/ibrah/cascadeProjects/postwriter",
  "sessionId": "a1b2c3d4-...",
  "pid": 12345,
  "timestamp": 1774083092000
}
```

`pid` is written as `process.ppid` (the parent shell PID, which owns the terminal).

**ANSI escape sequences written to stdout after the file write:**

```js
// Read session-meta.json; if the project has a color/label, emit escapes
const { label = project, color = null } = meta[cwd] || {};
process.stdout.write(`\x1b]0;[${label}] ${status}\x07`);  // tab title (OSC 0)
if (color) {
  process.stdout.write(`\x1b]9;8;"${color}"\x07`);         // tab color (ConEmu/WT)
}
```

> **Tab color escape:** `\x1b]9;8;"#RRGGBB"\x07` is the ConEmu extension that Windows Terminal supports. If WT does not render the color, the title still works and the hook does not error — the escape is written to stdout and silently ignored by unsupported terminals. This is best-effort; the feature degrades gracefully to title-only.

`~/.claude/sessions/` is already created by `mkdirSync({ recursive: true })` in the existing hook.

---

### 2. `session-meta.json`

Persistent store for labels, colors, and first-seen timestamps. Lives at `~/.claude/session-meta.json`.

```json
{
  "_colorIndex": 3,
  "C:/Users/ibrah/cascadeProjects/postwriter": {
    "label": "postwriter",
    "color": "#58a6ff",
    "firstSeen": "2026-03-21T10:00:00.000Z"
  },
  "C:/Users/ibrah/cascadeProjects/claudeSession": {
    "label": "claudeSession",
    "color": "#f85149",
    "firstSeen": "2026-03-21T10:05:00.000Z"
  }
}
```

**Keys:** non-`_` keys are absolute cwd paths. `_colorIndex` is an integer counter for auto-assignment.

**`firstSeen`**: set once when the project is first seen; never updated. Used by the Drawer to display uptime (`now - firstSeen`).

**Color auto-assignment:** when a new project is first seen, assign `palette[_colorIndex % 10]` and increment `_colorIndex`. This is deterministic regardless of what other entries exist in the file.

**Palette** (10 colors, indexed 0–9):
```js
["#58a6ff", "#f85149", "#3fb950", "#e3b341", "#bc8cff",
 "#f78166", "#79c0ff", "#56d364", "#ffa657", "#ff7b72"]
```

Defined in `src/colorPalette.js` and used by `server.js` only. The hook reads color values directly from `session-meta.json` — it does **not** import `colorPalette.js`.

**Atomic write (always):**
```js
const tmp = metaFile + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
fs.renameSync(tmp, metaFile);
```

**On corrupt:** catch JSON parse errors, reset to `{ _colorIndex: 0 }`, log a warning, continue.

**Entries are never deleted** when sessions end — labels, colors, and `firstSeen` persist for the next time the project opens.

---

### 3. `server.js` — Node.js backend

**Port:** 3333 (`PORT` env var overrides)
**WebSocket path:** `/ws`

**Startup sequence:**
1. Load `session-meta.json` (create `{ _colorIndex: 0 }` if missing)
2. Read all `~/.claude/sessions/*.json` files into memory
3. Run PowerShell WMI scan to find running Claude processes:
   - For each discovered process, if **no session file exists** for that cwd, create one with `{ status: "running", pid: <pid>, ... }`
   - If a session file **already exists** for that cwd, leave it unchanged (hook-written data takes precedence)
4. Start HTTP + WebSocket server

**Chokidar:**
- `add` / `change` events → read file → merge with meta → broadcast `session_updated`
- `unlink` events → broadcast `session_removed`

**REST endpoints:**

`GET /api/sessions`
Returns array of merged session objects (all current in-memory sessions):
```json
[{
  "project": "postwriter",
  "status": "working",
  "message": "Bash",
  "cwd": "C:/Users/ibrah/cascadeProjects/postwriter",
  "sessionId": "a1b2c3d4-...",
  "pid": 12345,
  "timestamp": 1774083092000,
  "label": "postwriter",
  "color": "#58a6ff",
  "firstSeen": "2026-03-21T10:00:00.000Z"
}]
```

`PATCH /api/sessions/:project`
- `:project` = the `project` field value (cwd basename, e.g., `postwriter`), URL-encoded
- To look up session-meta.json: read `~/.claude/sessions/<project>.json` → get `cwd` field → use as key in meta
- Body: `{ "label": "...", "color": "#rrggbb" }` (either or both fields)
- Merges into `session-meta.json` entry for that cwd (atomic write)
- Immediately broadcasts `{ type: "session_updated", session: <merged> }` to all WS clients (does not wait for chokidar)
- Returns 200 `{ "ok": true }`
- If session file does not exist: create a meta entry using `:project` as a synthetic cwd, return 200

`DELETE /api/sessions/:project`
- Reads `pid` from `~/.claude/sessions/<project>.json`
- Runs: `powershell.exe -Command "Stop-Process -Id <pid> -Force -ErrorAction SilentlyContinue"`
  - `-Force` is always used
  - Kill failure (process not found, access denied) is silently swallowed — `SilentlyContinue`
- Deletes `~/.claude/sessions/<project>.json` **always**, regardless of whether the kill succeeded
- Does NOT modify `session-meta.json`
- Broadcasts `{ type: "session_removed", project: "<project>" }` to all WS clients
- Returns 200 `{ "ok": true }` always

`POST /api/sessions/:project/focus`
- Reads `pid` from session file
- Runs PowerShell to find the Windows Terminal window that owns this pid and bring it to front:
```powershell
$pid = <pid>;
$wt = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Where-Object {
  (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($_.Id)").ProcessId -contains $pid
} | Select-Object -First 1;
if ($wt) {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }';
  [W]::SetForegroundWindow($wt.MainWindowHandle);
}
```
- Returns 200 `{ "focused": true }` if a WT window was found and focused
- Returns 200 `{ "focused": false }` if window not found or focus failed (any exception)

---

### 4. WebSocket Protocol

**Path:** `/ws`
**Library:** `ws` npm package, shared with the HTTP server

**On connect:** server immediately sends:
```json
{ "type": "snapshot", "sessions": [ /* array of merged session objects */ ] }
```

**On session file change (chokidar `add`/`change`):**
```json
{ "type": "session_updated", "session": { /* merged session object */ } }
```

**On session file deleted (chokidar `unlink`):**
```json
{ "type": "session_removed", "project": "postwriter" }
```

**On PATCH (rename/recolor):**
```json
{ "type": "session_updated", "session": { /* merged session object with new label/color */ } }
```

Client reconnect: exponential backoff starting at 1s, doubling each attempt, capped at 30s.
On reconnect, client waits for the `snapshot` message to repopulate state.

---

### 5. React Frontend

**Stack:** React + Vite
**Dev port:** 5173 (proxies `/api` and `/ws` to `:3333`)

**File structure:**
```
web/
  src/
    App.jsx          — root; WS connection; session state (Map keyed by project name)
    Board.jsx        — 4 kanban columns
    SessionCard.jsx  — color strip, label, status icon, last action, relative timestamp
    Drawer.jsx       — side panel (slides from right)
  index.html
  vite.config.js
```

**Kanban columns** (left → right):
1. **Waiting** — `status === "waiting"` — yellow left border
2. **Working** — `status === "working"` or `"thinking"`
3. **Done** — `status === "done"`
4. **Idle** — `status === "running"` (detected via process scan, no hook data yet)

**Session card:** left color strip, label, status icon + text, last `message`, relative time since `timestamp`.

**Side drawer** (one open at a time, slides from right, close on Escape or outside click):
- Label: `<input>` auto-focused; saves on blur or Enter → `PATCH /api/sessions/:project`
- Color swatches: 10 circles; active swatch has white ring; click → immediate `PATCH`
- Full `cwd` path (monospace, user-selectable text)
- Session ID: first 8 chars + `…`; click copies full UUID to clipboard
- Uptime: `new Date() - new Date(firstSeen)`, formatted as `"running 4m"`, `"running 2h 15m"`
- Focus button: `POST /api/sessions/:project/focus`; shows "Focused!" briefly on `{ focused: true }`, silent on false
- Kill button: first click shows "Confirm kill?"; second click within 3s sends `DELETE`; resets to "Kill" if not confirmed

---

## Error Handling

| Scenario | Handling |
|---|---|
| Session file missing on chokidar read | Skip, log to server console |
| Session file corrupt JSON | Skip, log; do not crash handler |
| session-meta.json corrupt | Reset to `{ _colorIndex: 0 }`, log warning |
| Kill (Stop-Process fails) | Return 200, delete session file anyway |
| WebSocket disconnect | Client reconnects with backoff 1s→2s→4s…30s |
| PATCH on unknown project | Create meta entry, return 200 |
| Focus fails / window not found | Return 200 `{ focused: false }`, UI silent |
| Chokidar fires before sessions dir exists | `mkdirSync` on server start |

---

## File Layout

```
claudesession/
  src/
    server.js          — Express + ws + chokidar backend
    colorPalette.js    — 10-color palette constant
  web/
    src/
      App.jsx
      Board.jsx
      SessionCard.jsx
      Drawer.jsx
    index.html
    vite.config.js
  package.json
  README.md
```

**`package.json` scripts:**
- `npm run dev` — `concurrently` starts `node src/server.js` and `vite web/`; Vite proxies `/api` and `/ws` to `:3333`. **Important:** the `/ws` proxy entry must set `ws: true` (required for WebSocket upgrade); `/api` does not need it:
  ```js
  proxy: {
    '/api': 'http://localhost:3333',
    '/ws':  { target: 'http://localhost:3333', ws: true },
  }
  ```
- `npm run build` — `vite build web/` → outputs to `web/dist/`
- `npm start` — `node src/server.js` in production mode; serves `web/dist/` as static files at `/`

---

## Setup

1. `npm install` in `claudesession/`
2. `npm run dev`
3. Open `http://localhost:5173` (dev) or `http://localhost:3333` (prod)
4. Existing hooks in `~/.claude/settings.json` already call `session-hook.js` — no settings changes needed
5. **Update `~/.claude/session-hook.js`:** add `pid` to JSON output + ANSI escape stdout writes

---

## Testing

- **Live update:** open 3+ Claude Code sessions, verify kanban populates and status changes live
- **Rename:** change label in drawer, verify updates on board and in session-meta.json
- **Recolor:** change color, verify card updates immediately; verify terminal tab color updates on next hook fire
- **Persistence:** restart server, verify labels, colors, and firstSeen are restored
- **Kill:** verify process terminates, card disappears, session-meta.json still has the entry
- **Reconnect:** kill and restart server, verify browser reconnects and board repopulates from snapshot
- **Concurrent hooks:** simulate simultaneous hook fires, verify session-meta.json is not corrupted
- **Focus:** click Focus, verify Windows Terminal window comes to front
- **Process discovery:** start a Claude session, start the server fresh (no session files), verify session appears on the board
