# claudeSession — Session Tree Refactor

**Date:** 2026-03-22
**Status:** Approved for implementation

---

## Problem

The board currently shows one card per session file. With 40+ session files (most stale from old conversations), the board is unusable. The user has ~10 active Warp tabs but sees 43 cards. Additionally, there is no way to see which sessions spawned which subagents.

---

## Solution

Replace the 4-column kanban board with a **sidebar + session tree** layout:

- **Left sidebar**: one row per project, sorted by most recent activity. Each row shows a status dot, project name, last status label, time-since-last-activity, and session count badge. Stale projects dimmed.
- **Right panel**: session tree for the selected project. Shows all sessions as a tree with parent→child relationships. Inline Focus/Kill actions on active sessions.

---

## Architecture

### Data Flow

Server sends flat session objects via WebSocket (protocol unchanged). `App.jsx` groups them into projects client-side by `cwd`. No server-side changes needed for grouping.

```
WebSocket → App.jsx (groups by cwd) → Sidebar (project list) + ProjectPanel (session tree)
```

### State Ownership

- `selectedCwd: string | null` — lives in `App.jsx`, passed as prop to `Sidebar` and `ProjectPanel`. On first load, auto-select the project with the most recent `lastTimestamp`. If no sessions exist, `selectedCwd` is `null`.
- `showAll: Set<cwd>` — lives in `App.jsx`. A project whose `cwd` is in this set shows all sessions (including stale) in its tree. Persists across project switches.

### Stale Sessions

- **Threshold**: `STALE_MS = 2 * 60 * 60 * 1000` (2 hours)
- **Stale**: `timestamp < now - STALE_MS` AND `status` not in `['working', 'waiting', 'thinking', 'responding', 'subagent']`
- A session stuck in an active status (e.g. `working`) for more than 2h is intentionally never marked stale — the user can see it and kill it if needed.
- Stale sessions appear dimmed (opacity 0.38) in the tree, no action buttons shown.
- A "N older sessions hidden · show all" link at the bottom of each project tree reveals them, toggling `showAll` for that `cwd` in App.jsx.
- Sidebar rows for projects where ALL sessions are stale appear dimmed, sorted below active projects.

### Empty State

If `sessions` is empty (WebSocket connected, zero session files), the sidebar shows:

```
— no active sessions
```

centered in the sidebar body, in `var(--text-dim)` monospace. The right panel shows nothing (no project selected).

### Parent–Child Tracking

Sessions can spawn subagents via the Agent tool. Parent→child relationships are stored in each session file as `parentSessionId`.

**Mechanism in `~/.claude/session-hook.js`:**

1. When `status === 'subagent'` (SubagentStart event fires in parent): write `.spawn-intent-{parentSessionId.slice(0,8)}.json` to sessions dir containing `{ parentSessionId, cwd, timestamp }`. Then return — do not write a session entry for this event.
2. When a new session file is created (no existing `parentSessionId` in the file yet): scan sessions dir for `.spawn-intent-*.json` files written within the last 10 seconds with matching `cwd` → claim the most recent one, set `parentSessionId` in the new session file, delete the intent file.
3. If `parentSessionId` exists in the session file but that session ID is not found in the same project (different `cwd` or session file deleted): treat as a root session (no parent link rendered).

Without parent data (before hooks fire, or for root sessions): tree renders as a flat list sorted by `timestamp` descending.

---

## Status System

All known statuses, their rendering, and priority order:

| Status | Label | Color | Pulse | Priority |
|--------|-------|-------|-------|----------|
| `working` | working | `var(--accent-working)` `#58a6ff` | yes | 1 (highest) |
| `thinking` | thinking | `var(--accent-working)` `#58a6ff` | yes | 2 |
| `responding` | responding | `var(--accent-working)` `#58a6ff` | yes | 3 |
| `subagent` | subagent | `#bc8cff` | yes | 4 |
| `waiting` | waiting | `var(--accent-waiting)` `#e3b341` | no | 5 |
| `done` | done | `var(--accent-done)` `#3fb950` | no | 6 |
| `running` | idle | `var(--accent-idle)` `#484f58` | no | 7 (lowest) |
| _(unknown)_ | idle | `var(--accent-idle)` `#484f58` | no | 7 |

**Project status** = highest priority status among all non-stale sessions in the project. If all sessions are stale, use the most recent session's status.

---

## Components

### Modified

| File | Change |
|------|--------|
| `~/.claude/session-hook.js` | Add spawn intent write on SubagentStart; read intent on new session creation |
| `web/src/App.jsx` | Own `selectedCwd` + `showAll` state; group sessions into projects Map; pass to Sidebar + ProjectPanel |
| `web/src/Board.jsx` | Replace kanban layout with `<Sidebar> + <ProjectPanel>` shell. The app header (title, ConnDot, settings gear) moves into `Sidebar`'s header. |

### New

| File | Purpose |
|------|---------|
| `web/src/Sidebar.jsx` | Left panel: app header + project list. Props: `projects`, `selectedCwd`, `connected`, `onSelect`, `onSettings` |
| `web/src/ProjectPanel.jsx` | Right panel: project header + SessionTree. Props: `project`, `showAll`, `onToggleShowAll`, `onUpdate(patch)`, `onFocus(fileKey)`, `onKill(fileKey)` |
| `web/src/SessionTree.jsx` | Builds and renders the parent→child session tree. Props: `sessions`, `showAll` (boolean), `onToggleShowAll()`, `onFocus(fileKey)`, `onKill(fileKey)` |

### Removed

- `web/src/SessionCard.jsx` — replaced by tree nodes in `SessionTree`
- `web/src/Drawer.jsx` — replaced by `ProjectPanel` (always visible, not a slide-in)

### Unchanged

- `web/src/Settings.jsx`
- `web/src/useRelativeTime.js`
- `src/server.js`
- `src/sessions.js`

---

## Component Details

### `App.jsx`

Groups `sessions` Map into `projects` Map keyed by `cwd`:

```js
{
  cwd: string,
  project: string,
  label: string,          // from meta (session.label)
  color: string,          // from meta (session.color)
  status: string,         // highest-priority status per table above
  lastTimestamp: number,  // max(session.timestamp) across all sessions
  sessions: Session[],    // sorted by timestamp desc
}
```

`selectedCwd` defaults to the `cwd` with the highest `lastTimestamp` on first load. When a `session_removed` WS event empties the last session for the selected project, `selectedCwd` shifts to the next most recent project (or `null`).

### `Sidebar.jsx`

- App header at top: "claudeSession" title, session count, `ConnDot`, gear button — same visuals as current Board header.
- Projects sorted: active (any non-stale session) first by `lastTimestamp` desc, then stale projects by `lastTimestamp` desc, dimmed.
- Selected project: highlighted row with `2px solid {color}` right border.
- Each row: `[dot] [name]  [status] [time] [badge]`
  - Dot pulses for `working`, `thinking`, `responding`, `subagent`
  - Time = `useRelativeTime(project.lastTimestamp)`
  - Badge = total session count

### `ProjectPanel.jsx`

- Header: color dot (8px) + editable label `<input>` (saves on blur/Enter via `onUpdate({ label })`) + 10 color swatches (saves immediately via `onUpdate({ color })`). Project path shown below in dim text.
- Body: `<SessionTree sessions={project.sessions} showAll={showAll.has(project.cwd)} onToggleShowAll={() => onToggleShowAll(project.cwd)} onFocus={onFocus} onKill={onKill} />`
- `onUpdate(patch)`: calls `PATCH /api/sessions/:fileKey` using `project.sessions[0].fileKey`. The server reads the session's `cwd` and writes to `session-meta.json[cwd]`, so label/color apply to all sessions in the project. `src/sessions.js` is unchanged because `mergeMeta()` already reads from `session-meta.json` per `cwd`.

### `SessionTree.jsx`

**Tree building:**
- Build `Map<sessionId, Session>` for all sessions in project.
- Root sessions: `parentSessionId` is absent, empty, or not in the project's session IDs.
- For each root, recursively collect children sorted by `timestamp` desc.
- Maximum rendered nesting depth: **4 levels** (root → child → grandchild → great-grandchild). Deeper sessions are shown flat under their last-visible ancestor.

**Each node renders:**
- Status dot (pulse if active)
- Session ID: first 8 chars of `sessionId`, monospace
- Status label (colored per table above)
- Time (`useRelativeTime(session.timestamp)`) — right-aligned
- Last message (`session.message`, truncated to single line, ellipsis)
- If NOT stale AND has `terminalPid`: `[focus]` button → calls `onFocus(session.fileKey)`
- If NOT stale AND status in `['working','thinking','responding','waiting','subagent']`: `[kill]` button with two-step confirm (first click turns button red with "confirm?", 3s timeout reverts, second click calls `onKill(session.fileKey)`). Kill confirm state lives inside the node (local state).

**Tree connectors** use fixed 20px indentation per level with `└─` / `├─` characters (last child vs non-last child). Connector lines are CSS `border-left: 1px solid var(--border-dim)` on the indent wrapper.

**Stale filtering:**
- By default: stale sessions are rendered at 0.38 opacity, below all active sessions, without action buttons.
- If `showAll` is false and all sessions are stale: show them all anyway (no point hiding everything).
- "N older sessions hidden · show all" link appears only when at least 1 session is hidden (stale AND `showAll` boolean is `false`). Clicking calls `onToggleShowAll()` (no argument — `ProjectPanel` already bound the `cwd`).

---

## API

No new endpoints. Existing endpoints used:

- `POST /api/sessions/:fileKey/focus` — focus terminal window for a session
- `DELETE /api/sessions/:fileKey` — kill a session's process
- `PATCH /api/sessions/:fileKey` — update label/color in project meta (any session's fileKey from the project works; server resolves to `cwd`)

---

## Out of Scope

- Tab selection within Warp (not exposed by Warp's API)
- Drag-and-drop reordering
- Session search / filter by text
- Real-time tree animation when new child sessions appear
