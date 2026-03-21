# claudeSession

Interactive browser dashboard for Claude Code sessions — color-coded, labeled, and live.

## What it does

- **Kanban board** — sessions organized by status: Waiting / Working / Done / Idle
- **Color-coded tabs** — Windows Terminal tab titles and colors reflect each project
- **Side drawer** — rename sessions, change colors, kill processes, focus windows
- **Persistent** — labels and colors survive server restarts

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Setup

1. Hooks are already configured in `~/.claude/settings.json` (calls `session-hook.js`)
2. Copy the updated `session-hook.js` from this repo to `~/.claude/session-hook.js`:
   ```bash
   cp session-hook.js ~/.claude/session-hook.js
   ```

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
