# Focus & Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tab focus (UI Automation) and open-if-not-running (wt.exe + claude --resume) so clicking "focus" in the dashboard switches directly to the right Windows Terminal tab, or opens a new one if the session isn't running.

**Architecture:** Three additions to the existing codebase: (1) `session-hook.js` persists `lastSessionId` to `session-meta.json` on every event, (2) `src/focusTab.ps1` uses `System.Windows.Automation` to switch WT tabs by regex-matching the label, (3) `server.js` focus endpoint gains tab-switch logic (via the PS1) and open-if-not-running (via `wt.exe` spawn). The frontend gets a project-level "Open" button and per-session feedback labels.

**Tech Stack:** Node.js, PowerShell (System.Windows.Automation), React, existing Express/ws stack. All work is in `.worktrees/feature-build/`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `~/.claude/session-hook.js` | Modify | Write `lastSessionId` to `session-meta.json` on every hook event that has a `sessionId` |
| `src/focusTab.ps1` | Create | PowerShell: UI Automation tab switcher; exit 0=found, 1=no WT, 2=not found |
| `src/server.js` | Modify | Enhance focus endpoint: tab switch → liveness re-check → open-if-not-running |
| `web/src/SessionTree.jsx` | Modify | Show "focus"/"resume" on stale sessions; add feedback labels ("Focused!"/"Opened!") |
| `web/src/ProjectPanel.jsx` | Modify | Add project-level "Open" button in header row |
| `web/src/App.jsx` | Modify | Wire project-level open handler (calls most-recent-session focus endpoint) |

---

## Context: what already exists

- `src/server.js` already has a working `POST /api/sessions/:fileKey/focus` endpoint that walks the process tree and brings the WT *window* to front (but does not switch tabs). The endpoint returns `{ focused, dbg }`.
- `session-hook.js` already writes `sessionId` to each session's JSON file and emits ANSI tab-title/color escapes. It does **not** persist `lastSessionId` to `session-meta.json`.
- `web/src/SessionTree.jsx` shows a "focus" button with `canFocus = !stale && !!session.terminalPid`. This hides the button for stale sessions entirely.
- `web/src/ProjectPanel.jsx` has no focus/open button at the project level.

---

## Task 1: Persist `lastSessionId` in session-hook.js

**Files:**
- Modify: `~/.claude/session-hook.js`

The hook already writes to `session-meta.json` at the end of each event. Add one field: `lastSessionId`.

- [ ] **Step 1: Locate the ANSI-escape block in session-hook.js**

At the bottom of `session-hook.js`, find:
```js
// Emit ANSI escapes for Windows Terminal tab title + color
try {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) {}
  const entry = meta[cwd] || {};
```

- [ ] **Step 2: Add `lastSessionId` write before emitting ANSI escapes**

After `const entry = meta[cwd] || {};` and before reading `label`/`color`, insert:

```js
// Persist last known sessionId so Focus can resume even after the session ends
if (sessionId && entry) {
  if (!entry.lastSessionId || entry.lastSessionId !== sessionId) {
    entry.lastSessionId = sessionId;
    meta[cwd] = entry;
    const tmpMeta = metaFile + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
      fs.renameSync(tmpMeta, metaFile);
    } catch (_) {}
  }
}
```

- [ ] **Step 3: Verify manually**

Start a new `claude` session in any project directory. After the first hook fires, run:
```bash
cat ~/.claude/session-meta.json
```
Expected: the entry for that project has a `lastSessionId` field containing a UUID.

- [ ] **Step 4: Commit**

```bash
git add ~/.claude/session-hook.js
git commit -m "feat: persist lastSessionId to session-meta.json on each hook event"
```

> Note: `session-hook.js` lives in `~/.claude/`, not in the repo. This commit modifies it in-place on the user's machine. The git add path is literal.

---

## Task 2: Create `src/focusTab.ps1`

**Files:**
- Create: `src/focusTab.ps1` (in `.worktrees/feature-build/src/`)

This PowerShell script uses UI Automation to find a Windows Terminal tab whose title matches `[label]` and click it. Exit codes: 0=switched, 1=WT not found, 2=tab not found.

- [ ] **Step 1: Create `src/focusTab.ps1`**

```powershell
# focusTab.ps1 — Switch to a named Windows Terminal tab via UI Automation
# Usage: powershell -File focusTab.ps1 -Label "myproject"
# Exit: 0=tab found+switched, 1=WT not running, 2=tab not found (WT still brought to front)

param([string]$Label)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32Tab {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
'@

$wt = Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $wt) { exit 1 }

$root = [System.Windows.Automation.AutomationElement]::FromHandle($wt.MainWindowHandle)
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::TabItem
)
$tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)

# Use [Regex]::Escape so labels with [, ], *, ?, . etc. match literally
$escaped = [Regex]::Escape($Label)

foreach ($tab in $tabs) {
  if ($tab.Current.Name -match "^\[$escaped\]") {
    $invoke = $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    [Win32Tab]::ShowWindow($wt.MainWindowHandle, 9)          # SW_RESTORE
    [Win32Tab]::SetForegroundWindow($wt.MainWindowHandle)
    exit 0
  }
}

# Tab not found — still bring WT to front so user can see it
[Win32Tab]::ShowWindow($wt.MainWindowHandle, 9)
[Win32Tab]::SetForegroundWindow($wt.MainWindowHandle)
exit 2
```

- [ ] **Step 2: Smoke-test the script manually**

With at least one Claude Code session running in Windows Terminal:
```powershell
powershell -ExecutionPolicy Bypass -File src/focusTab.ps1 -Label "claudesession"
echo "exit: $LastExitCode"
```
Expected: exit 0, the WT tab titled `[claudesession] ...` becomes active. If you have no matching tab, expect exit 2 but WT still comes to front.

- [ ] **Step 3: Commit**

```bash
cd .worktrees/feature-build
git add src/focusTab.ps1
git commit -m "feat: add focusTab.ps1 — UI Automation tab switcher for Windows Terminal"
```

---

## Task 3: Enhance focus endpoint in server.js

**Files:**
- Modify: `.worktrees/feature-build/src/server.js`

Add tab-switch attempt before the existing window-focus logic. Add open-if-not-running when session is dead. Update response shape to include `opened` field.

- [ ] **Step 1: Add imports at top of server.js**

Find the existing requires block and ensure `spawn` is imported:
```js
const { execSync, spawn } = require('child_process')
```
(Replace the existing `const { execSync } = require('child_process')` line.)

- [ ] **Step 2: Add `isAlive` helper after existing helpers**

After the `focusWindow` function (around line 301), add:

```js
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
```

- [ ] **Step 3: Add `tryTabSwitch` helper**

After `isAlive`, add:

```js
const FOCUS_TAB_PS1 = path.join(__dirname, 'focusTab.ps1')

function tryTabSwitch(label) {
  try {
    const result = execSync(
      `powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "${FOCUS_TAB_PS1}" -Label "${label}"`,
      { timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return 0  // exit 0 — success
  } catch (err) {
    // execSync throws when exit code != 0; status is in err.status
    return (err && err.status != null) ? err.status : -1
  }
}
```

- [ ] **Step 4: Add `openNewTab` helper**

After `tryTabSwitch`, add:

```js
function openNewTab(cwd, label, sessionId) {
  const resumeCmd = sessionId ? `claude --resume ${sessionId}` : `claude`
  const args = [
    '-w', '0',
    'new-tab',
    '--title', `[${label}]`,
    '--startingDirectory', cwd || process.env.USERPROFILE || 'C:\\',
    'cmd', '/k', resumeCmd,
  ]
  try {
    spawn('wt.exe', args, { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Rewrite the focus endpoint**

Find the existing `app.post('/api/sessions/:fileKey/focus', ...)` block (starts around line 303) and replace it entirely:

```js
app.post('/api/sessions/:fileKey/focus', (req, res) => {
  const { fileKey } = req.params
  let focused = false
  let opened  = false
  const dbg   = {}

  try {
    // Read session file
    const sessionFile = path.join(sessionsDir, fileKey + '.json')
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
    const { pid, terminalPid, sessionId, cwd } = session

    // Read meta for label + lastSessionId
    const m     = readMeta(metaFile)
    const entry = m[cwd] || {}
    const label = entry.label || session.project || fileKey

    dbg.pid = pid; dbg.sessionId = sessionId; dbg.label = label

    // Check if the session process is alive
    const alive = isAlive(pid)
    dbg.alive = alive

    if (alive) {
      // 1. Try UI Automation tab switch
      const exitCode = tryTabSwitch(label)
      dbg.tabSwitchExit = exitCode

      if (exitCode === 0) {
        // Tab found and switched
        focused = true
      } else if (exitCode === 1) {
        // WT not found — session alive but in a different terminal; fall back to window focus
        const claudePid = findClaudePid(sessionId, pid)
        if (claudePid) {
          const settings = (m._settings) || {}
          const termPid = walkToTerminal(claudePid, settings.preferredTerminal)
            || walkToTerminal(pid, settings.preferredTerminal)
          if (termPid) focused = focusWindow(termPid).focused
        }
      } else {
        // exitCode 2: tab not found — re-check liveness
        if (isAlive(pid)) {
          // Still alive, just title mismatch — fall back to window-level focus
          const claudePid = findClaudePid(sessionId, pid)
          if (claudePid) {
            const settings = (m._settings) || {}
            const termPid = walkToTerminal(claudePid, settings.preferredTerminal)
            if (termPid) focused = focusWindow(termPid).focused
          }
        } else {
          // Died between liveness check and tab switch — treat as not running
          dbg.diedDuringSwitch = true
          const resumeId = sessionId || entry.lastSessionId || null
          opened = openNewTab(cwd || entry.cwd, label, resumeId)
        }
      }
    } else {
      // Session not running — open new tab with resume if we have a sessionId
      const resumeId = sessionId || entry.lastSessionId || null
      dbg.resumeId = resumeId
      opened = openNewTab(cwd || entry.cwd, label, resumeId)
    }
  } catch (err) {
    dbg.error = err.message
  }

  console.log('[focus]', fileKey, dbg)
  res.json({ focused, opened, dbg })
})
```

- [ ] **Step 6: Test with a running session**

With `npm run dev` running and a Claude session active:
```bash
curl -s -X POST http://localhost:3333/api/sessions/<fileKey>/focus | node -e "process.stdin||(x=>console.log(JSON.stringify(x,null,2)))(require('fs').readFileSync('/dev/stdin','utf8'))"
```
Expected: `{ "focused": true, "opened": false }` and the correct WT tab becomes active.

- [ ] **Step 7: Test open-if-not-running**

Kill the Claude session so the session file becomes stale, then call the endpoint again.
Expected: `{ "focused": false, "opened": true }` and a new WT tab opens running `claude --resume <uuid>`.

- [ ] **Step 8: Commit**

```bash
cd .worktrees/feature-build
git add src/server.js
git commit -m "feat: enhance focus endpoint — tab switch via UI Automation + open-if-not-running"
```

---

## Task 4: Update SessionTree.jsx — show focus/resume on stale sessions + feedback labels

**Files:**
- Modify: `.worktrees/feature-build/web/src/SessionTree.jsx`

Currently `canFocus = !stale && !!session.terminalPid`. Change this so stale sessions also show a "resume" button. Add feedback states ("Focused!" / "Opened!").

- [ ] **Step 1: Add per-session focus state to `SessionNode`**

Find the `SessionNode` function. Replace:
```js
const [killConfirm, setKillConfirm] = useState(false)
```
with:
```js
const [killConfirm, setKillConfirm] = useState(false)
const [focusLabel, setFocusLabel]   = useState(null)  // null = default label
```

- [ ] **Step 2: Update `canFocus` and add `isResumable`**

Find:
```js
const canFocus = !stale && !!session.terminalPid
const canKill  = !stale && ACTIVE_STATUSES.has(session.status)
```
Replace with:
```js
const canFocus    = !stale && !!session.terminalPid
const isResumable = stale && !!session.sessionId
const canKill     = !stale && ACTIVE_STATUSES.has(session.status)
```

- [ ] **Step 3: Add `handleFocus` function inside `SessionNode`**

After the `handleKill` function, add:
```js
async function handleFocus() {
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(session.fileKey)}/focus`, { method: 'POST' })
    const d = await r.json()
    const next = d.focused ? 'focused!' : d.opened ? 'opened!' : null
    if (next) {
      setFocusLabel(next)
      setTimeout(() => setFocusLabel(null), 2000)
    }
  } catch (_) {}
}
```

- [ ] **Step 4: Update the button render block**

Find the condition `{(canFocus || canKill) && (` and change the block that renders the focus button to also handle the resumable case:

```jsx
{(canFocus || isResumable || canKill) && (
  <div style={{ display: 'flex', gap: 5, marginTop: 5, paddingLeft: 12 }}>
    {(canFocus || isResumable) && (
      <button
        onClick={handleFocus}
        style={{
          fontSize: 9, fontFamily: 'var(--font-mono)',
          border: '1px solid var(--border)', borderRadius: 3,
          padding: '2px 9px', background: 'var(--bg-tertiary)',
          color: focusLabel ? 'var(--accent-done)' : 'var(--text-secondary)',
          cursor: 'pointer', transition: 'all 0.1s',
        }}
        onMouseEnter={e => { if (!focusLabel) { e.target.style.color = 'var(--text-primary)'; e.target.style.borderColor = 'var(--text-secondary)' }}}
        onMouseLeave={e => { if (!focusLabel) { e.target.style.color = 'var(--text-secondary)'; e.target.style.borderColor = 'var(--border)' }}}
      >
        {focusLabel || (isResumable ? 'resume' : 'focus')}
      </button>
    )}
    {canKill && (
      <button
        onClick={handleKill}
        style={{
          fontSize: 9, fontFamily: 'var(--font-mono)',
          border: `1px solid ${killConfirm ? '#f85149' : 'var(--border)'}`,
          borderRadius: 3, padding: '2px 9px',
          background: killConfirm ? '#f8514918' : 'var(--bg-tertiary)',
          color: killConfirm ? '#f85149' : 'var(--text-secondary)',
          cursor: 'pointer', transition: 'all 0.1s',
        }}
      >
        {killConfirm ? 'confirm?' : 'kill'}
      </button>
    )}
  </div>
)}
```

- [ ] **Step 5: Verify in browser**

With `npm run dev`:
- Active session card → shows "focus" button; clicking it shows "focused!" or "opened!" briefly
- Stale session card → shows "resume" button; clicking opens new WT tab with `claude --resume`

- [ ] **Step 6: Commit**

```bash
cd .worktrees/feature-build
git add web/src/SessionTree.jsx
git commit -m "feat: add resume button for stale sessions; focus/resume feedback labels"
```

---

## Task 5: Add project-level Open button to ProjectPanel

**Files:**
- Modify: `.worktrees/feature-build/web/src/ProjectPanel.jsx`
- Modify: `.worktrees/feature-build/web/src/App.jsx`

Add an "Open" button in the ProjectPanel header. Clicking it focuses the most recent active session's tab, or opens a new tab if none are active.

- [ ] **Step 1: Add `onOpen` prop to `ProjectPanel`**

Find the function signature:
```js
export default function ProjectPanel({ project, showAll, onToggleShowAll, onUpdate, onFocus, onKill }) {
```
Add `onOpen`:
```js
export default function ProjectPanel({ project, showAll, onToggleShowAll, onUpdate, onFocus, onKill, onOpen }) {
```

- [ ] **Step 2: Add Open button state and handler**

After `const inputRef = useRef(null)`, add:
```js
const [openLabel, setOpenLabel] = useState('open')

async function handleOpen() {
  // Pick the most recent non-stale session, or fall back to most recent session
  const active = project.sessions.filter(s => !isStale(s))
  const target  = (active.length ? active : project.sessions)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]
  if (!target) return
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(target.fileKey)}/focus`, { method: 'POST' })
    const d = await r.json()
    const next = d.focused ? 'focused!' : d.opened ? 'opened!' : 'open'
    setOpenLabel(next)
    setTimeout(() => setOpenLabel('open'), 2000)
  } catch (_) {}
}
```

- [ ] **Step 3: Add `isStale` import**

At the top of `ProjectPanel.jsx`, add:
```js
import { isStale } from './utils.js'
import { useState } from 'react'
```
(Check if `useState` is already imported — add it only if missing.)

- [ ] **Step 4: Render Open button in header row**

Find the `<div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>` that contains the color swatches. After the closing `</div>` of that row, add the Open button as a sibling in the header flex row:

```jsx
<button
  onClick={handleOpen}
  title="Focus or open this project's terminal tab"
  style={{
    fontSize: 9, fontFamily: 'var(--font-mono)',
    border: '1px solid var(--border)', borderRadius: 3,
    padding: '2px 10px', background: 'var(--bg-tertiary)',
    color: openLabel !== 'open' ? 'var(--accent-done)' : 'var(--text-dim)',
    cursor: project.sessions.length ? 'pointer' : 'default',
    opacity: project.sessions.length ? 1 : 0.3,
    transition: 'all 0.15s', flexShrink: 0,
  }}
  disabled={!project.sessions.length}
  onMouseEnter={e => { if (project.sessions.length && openLabel === 'open') e.target.style.color = 'var(--text-secondary)' }}
  onMouseLeave={e => { if (openLabel === 'open') e.target.style.color = 'var(--text-dim)' }}
>
  {openLabel}
</button>
```

- [ ] **Step 5: Verify in browser**

With a project selected in the sidebar:
- Click "open" with an active session → tab switches, button shows "focused!" briefly
- Click "open" with only stale sessions → new WT tab opens, button shows "opened!" briefly

- [ ] **Step 6: Commit**

```bash
cd .worktrees/feature-build
git add web/src/ProjectPanel.jsx
git commit -m "feat: add project-level Open button — focuses active tab or opens with resume"
```

---

## Task 6: Integration test pass

**Manual test checklist — run through each scenario end-to-end:**

- [ ] **Test 1: Focus running session via session card**
  - Open 2 Claude sessions in different WT tabs
  - In browser, click "focus" on the non-active session card
  - Expected: that WT tab becomes active; button shows "focused!" for 2s

- [ ] **Test 2: Focus running session via project Open button**
  - Same setup as Test 1
  - Click "open" in the project header
  - Expected: same result as Test 1

- [ ] **Test 3: Resume stale session (lastSessionId known)**
  - Let a Claude session end (or kill it)
  - In browser, find the stale session card (shows "resume")
  - Click "resume"
  - Expected: new WT tab opens running `claude --resume <uuid>` in the right directory; button shows "opened!"

- [ ] **Test 4: Open project with no active session via Open button**
  - Same setup as Test 3
  - Click "open" in the project header
  - Expected: new WT tab opens with `claude --resume <uuid>` (picks most recent stale session)

- [ ] **Test 5: WT minimised**
  - Minimise Windows Terminal
  - Click "focus" on any running session
  - Expected: WT is restored and the correct tab is active

- [ ] **Test 6: Label with special characters**
  - Rename a project to something with brackets, e.g. `test[2]`
  - Click "focus" on that session
  - Expected: correct tab matched; no silent failure

- [ ] **Test 7: `lastSessionId` persistence**
  - Start a new Claude session in a project
  - Run `cat ~/.claude/session-meta.json | python -m json.tool`
  - Expected: `lastSessionId` field present for that project's cwd entry

- [ ] **Test 8: HTTP response shape**
  - `curl -s -X POST http://localhost:3333/api/sessions/<fileKey>/focus | jq .`
  - Expected response has `focused` (bool) and `opened` (bool) at top level

- [ ] **Step 9: Commit test evidence**

```bash
cd .worktrees/feature-build
git commit --allow-empty -m "test: manual integration pass complete for focus+resume feature"
```
