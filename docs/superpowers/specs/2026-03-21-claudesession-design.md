# claudeSession — Design Spec

**Date:** 2026-03-21
**Status:** Approved

---

## Problem

Every Claude Code terminal window and tab shows the same title: "Claude Code". With 10–20+ sessions open across projects you cannot tell:

- Which terminal belongs to which project
- What state each session is in (working / waiting / done / idle)
- Which sessions are related (root vs. spawned subagents)

claudeMonitor (sibling project) solves the monitoring problem with a terminal dashboard. claudeSession solves the **identity problem** — labeling, color-coding, and controlling individual sessions from an interactive browser dashboard.

---

## Goals

- Browser-based interactive dashboard showing all active Claude Code sessions
- Kanban layout organized by session status
- Per-session color coding reflected in both the dashboard and Windows Terminal tab colors
- Persistent labels and colors per project (survive restarts)
- Actions: rename, recolor, kill, focus window
- Distinct from claudeMonitor (terminal TUI, read-only) and taskaude (task output streaming)

---

## Out of Scope (v1)

- Sending messages/commands into a running session (no Claude Code stdin API; deferred to v2)
- Per-tab focus (Windows Terminal doesn't expose per-tab handles; focus works at window level)
- Mobile/remote access

---

## Architecture

```
Claude Code sessions (each terminal)
        │
        │ hooks fire on every event (SessionStart, PreToolUse, PostToolUse, Stop, Notification)
        ▼
session-hook.js  ──→  ~/.claude/sessions/<project>.json   (status, tool, timestamp, sessionId, cwd)
                  ──→  ANSI escape codes → terminal tab    (title + color, read from session-meta.json)

~/.claude/session-meta.json  ←──  server.js (writes on rename/recolor)
        │
        │ chokidar watches for file changes
        ▼
server.js (Node.js backend)
  ├── chokidar: watches ~/.claude/sessions/
  ├── WebSocket: pushes session updates to browser
  ├── REST API: PATCH /sessions/:project, DELETE /sessions/:project
  └── serves React/Vite frontend
        │
        ▼
Browser dashboard (React + Vite)
  ├── Kanban board: Working / Waiting / Done / Idle columns
  ├── Session cards: color-coded, live status
  └── Side drawer: label, color picker, path, session ID, uptime, Kill button
```

---

## Components

### 1. `session-hook.js` (existing, reused)

Already lives at `~/.claude/session-hook.js`. Writes per-project JSON on every hook event. **No changes needed.**

Output format (existing):
```json
{
  "project": "postwriter",
  "status": "working",
  "message": "Bash",
  "cwd": "C:/Users/ibrah/cascadeProjects/postwriter",
  "sessionId": "a1b2c3d4-...",
  "timestamp": 1774083092000
}
```

**New responsibility added:** After writing the session file, session-hook.js also reads `session-meta.json` for the project's color/label and writes ANSI escape sequences to stdout (which Windows Terminal interprets as tab title + tab color). This keeps the terminal tab in sync without any backend round-trip.

Tab title escape: `\x1b]0;[label] status\x07`
Tab color escape: `\x1b]9;8;"#rrggbb"\x07` (ConEmu/Windows Terminal extension)

### 2. `session-meta.json`

Persistent store for user-assigned labels and colors. Lives at `~/.claude/session-meta.json`.

```json
{
  "C:/Users/ibrah/cascadeProjects/postwriter": {
    "label": "postwriter",
    "color": "#58a6ff"
  },
  "C:/Users/ibrah/cascadeProjects/claudeSession": {
    "label": "claudeSession",
    "color": "#f85149"
  }
}
```

Keyed by absolute `cwd` path so it survives session restarts. Created on first session seen; colors auto-assigned from palette.

### 3. `server.js` — Node.js backend

**File:** `src/server.js`
**Port:** 3333 (configurable via `PORT` env var)

Responsibilities:
- Serve the React app (in dev via Vite proxy, in prod via `dist/` static files)
- Watch `~/.claude/sessions/` with chokidar; broadcast changes via WebSocket
- Expose REST API:
  - `GET /api/sessions` — current state of all sessions + metadata
  - `PATCH /api/sessions/:project` — update label and/or color
  - `DELETE /api/sessions/:project` — kill the session process (PowerShell `Stop-Process`)
- On `PATCH`: update `session-meta.json`, broadcast updated state via WebSocket
- Process discovery: scan running processes for `claude-code/cli.js` (reuse pattern from claudeMonitor) to detect sessions not yet seen via hooks

### 4. React Frontend

**Stack:** React + Vite
**File structure:**
```
web/
  src/
    App.jsx          — root, WebSocket connection, state
    Board.jsx        — kanban columns
    SessionCard.jsx  — individual card
    Drawer.jsx       — side detail panel
    colorPalette.js  — 10-color auto-assign palette
```

**Kanban columns** (ordered by urgency):
1. **Waiting** — needs user input (highlighted, shown first)
2. **Working** — executing a tool
3. **Done / Thinking** — finished or processing
4. **Idle** — running but inactive

**Session card** shows: color strip, label, status icon, last tool/action, time since last update.

**Side drawer** (opens on card click, slides from right):
- Editable label (inline, saves on blur/Enter)
- Color swatches (10 colors from palette, click to change)
- Full `cwd` path
- Session ID (truncated, click to copy)
- Uptime since first seen
- Kill button (red, confirm on click)
- Focus button (brings Windows Terminal window to front via PowerShell)

**Color auto-assignment:** On first session seen, pick next unused color from palette. Store in `session-meta.json`. Palette: `["#58a6ff", "#f85149", "#3fb950", "#e3b341", "#bc8cff", "#f78166", "#79c0ff", "#56d364", "#ffa657", "#ff7b72"]`.

---

## Data Flow

### Session update (hook fires):
```
hook → session-hook.js writes <project>.json
     → chokidar detects change
     → server reads file + merges with session-meta.json
     → WebSocket broadcast to all clients
     → board updates in browser
```

### User renames/recolors (from drawer):
```
browser PATCH /api/sessions/:project {label, color}
→ server writes session-meta.json
→ server broadcasts updated session via WebSocket
→ next hook fire picks up new color → ANSI escape → terminal tab updates
```

### User kills session (from drawer):
```
browser DELETE /api/sessions/:project
→ server reads sessionId from <project>.json
→ PowerShell: Stop-Process -Id <pid> (resolved from session file or process scan)
→ session file deleted / marked dead
→ WebSocket broadcast → card removed from board
```

---

## Error Handling

- **Session file missing or corrupt:** skip gracefully, log to server console
- **Kill fails (process already gone):** return 200, clean up session file
- **WebSocket disconnect:** client reconnects with exponential backoff (max 30s)
- **session-meta.json corrupt:** reset to `{}`, log warning
- **Color escape not supported:** terminal shows wrong color but nothing breaks

---

## File Layout

```
claudesession/
  src/
    server.js          — Node.js backend
  web/
    src/
      App.jsx
      Board.jsx
      SessionCard.jsx
      Drawer.jsx
      colorPalette.js
    index.html
    vite.config.js
  package.json
  README.md
```

Scripts (in `package.json`):
- `npm run dev` — start Vite dev server + backend concurrently
- `npm start` — production mode (serve built `dist/`)
- `npm run build` — build React app

---

## Setup

1. `npm install` in `claudesession/`
2. `npm run dev` to start
3. Open `http://localhost:3333`
4. Existing hooks in `~/.claude/settings.json` already call `session-hook.js` — no changes needed
5. **One change to `session-hook.js`:** add ANSI escape output for tab title + color (reads `session-meta.json`)

---

## Testing

- Manual: open 3+ Claude Code sessions across different projects, verify kanban populates and status updates live
- Kill: verify process terminates and card disappears
- Rename/recolor: verify drawer saves, terminal tab title/color updates on next hook fire
- Persistence: restart server, verify labels and colors are restored
- Reconnect: kill and restart server, verify browser reconnects and board repopulates
