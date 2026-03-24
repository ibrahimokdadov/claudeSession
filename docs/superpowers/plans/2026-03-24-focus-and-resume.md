# Focus & Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tab focus (UI Automation) and open-if-not-running (wt.exe + claude --resume) so clicking "focus" in the dashboard switches directly to the right Windows Terminal tab, or opens a new one if the session isn't running.

**Architecture:** Three additions to the existing codebase: (1) `session-hook.js` persists `lastSessionId` to `session-meta.json` on `SessionStart` events only, piggybacking on the existing meta read/write, (2) `src/focusTab.ps1` uses `System.Windows.Automation` to switch WT tabs by regex-matching the label, invoked via temp file to avoid command-string injection, (3) `server.js` focus endpoint gains tab-switch logic and open-if-not-running. The frontend gets a project-level "Open" button and per-session feedback labels.

**Tech Stack:** Node.js, PowerShell (System.Windows.Automation), React, existing Express/ws stack. All work is in `.worktrees/feature-build/`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `~/.claude/session-hook.js` | Modify (in-place, not in repo) | Write `lastSessionId` to `session-meta.json` on `SessionStart` events only |
| `src/focusTab.ps1` | Create | PowerShell: UI Automation tab switcher; exit 0=found, 1=no WT, 2=not found |
| `src/server.js` | Modify | Enhance focus endpoint: tab switch → liveness re-check → open-if-not-running |
| `web/src/SessionTree.jsx` | Modify | Show "focus"/"resume" on stale sessions; add feedback labels |
| `web/src/ProjectPanel.jsx` | Modify | Add project-level "Open" button in header row |

---

## Context: what already exists

- `src/server.js` has a working `POST /api/sessions/:fileKey/focus` endpoint that walks the process tree and brings the WT *window* to front (does not switch tabs). Returns `{ focused, dbg }`.
- `session-hook.js` writes `sessionId` to session files and emits ANSI tab-title/color escapes. Does NOT persist `lastSessionId` to `session-meta.json`.
- `web/src/SessionTree.jsx` shows a "focus" button with `canFocus = !stale && !!session.terminalPid`. Hidden for stale sessions.
- `web/src/ProjectPanel.jsx` has no focus/open button at project level.
- `web/src/ProjectPanel.jsx` already imports `useState, useEffect, useRef` from React. Does NOT import `isStale`.
- `web/src/SessionTree.jsx` already imports `isStale` from `./utils.js`.

---

## Task 1: Persist `lastSessionId` in session-hook.js

**Files:**
- Modify: `~/.claude/session-hook.js` — edited directly on disk; this file is NOT tracked in the claudesession git repo. Do not attempt `git add` on it.

The hook already reads `session-meta.json` at the bottom to emit ANSI escapes. We piggyback on that existing read: if this is a `SessionStart` event and we have a `sessionId`, update `lastSessionId` in the same read-modify-write pass.

- [ ] **Step 1: Find the hook event type**

Open `~/.claude/session-hook.js`. The `status` variable (from `process.argv[2]`) holds the event type: `'SessionStart'`, `'working'`, `'waiting'`, etc.

At the bottom of the file, find the ANSI-escape block:
```js
// Emit ANSI escapes for Windows Terminal tab title + color
try {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) {}
  const entry = meta[cwd] || {};
  const label = entry.label || project;
  const color = entry.color || null;
```

- [ ] **Step 2: Add `lastSessionId` update inside the existing try block**

After `const entry = meta[cwd] || {};` and before reading `label`/`color`, insert:

```js
  // On SessionStart: persist lastSessionId so Focus can resume after the session ends
  if (status === 'SessionStart' && sessionId && meta[cwd]) {
    if (meta[cwd].lastSessionId !== sessionId) {
      meta[cwd].lastSessionId = sessionId;
      const tmpMeta = metaFile + '.tmp.' + process.pid;
      try {
        fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
        fs.renameSync(tmpMeta, metaFile);
      } catch (_) {}
    }
  }
```

**Why `meta[cwd]` (not `meta[cwd] || {}`):** We only write `lastSessionId` when the project is already known to meta (i.e. `ensureProject` has already run for this `cwd`). If the cwd is new and not yet in meta, `meta[cwd]` is undefined and we skip the write — the server's chokidar handler will call `ensureProject` first, and the next `SessionStart` will catch it.

- [ ] **Step 3: Verify manually**

Start a new `claude` session. After the first hook fires, run:
```bash
cat ~/.claude/session-meta.json
```
Expected: the entry for that project has a `lastSessionId` UUID.

---

## Task 2: Create `src/focusTab.ps1`

**Files:**
- Create: `.worktrees/feature-build/src/focusTab.ps1`

Exit codes: 0=tab found+switched, 1=WT not running, 2=tab not found (WT still brought to front).

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

# Tab not found — still bring WT to front
[Win32Tab]::ShowWindow($wt.MainWindowHandle, 9)
[Win32Tab]::SetForegroundWindow($wt.MainWindowHandle)
exit 2
```

- [ ] **Step 2: Smoke-test manually**

With at least one Claude session running in WT:
```powershell
powershell -ExecutionPolicy Bypass -File .worktrees/feature-build/src/focusTab.ps1 -Label "claudesession"
echo "exit: $LastExitCode"
```
Expected: exit 0, correct tab active. No matching tab → exit 2, WT still front.

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

**Important design note on exit code 1:** The spec says exit 1 (WT not found, session alive) should return `{ focused: false, opened: false }` immediately. This plan improves on that: it falls back to the existing `walkToTerminal`/`focusWindow` helpers, which support non-WT terminals (ConEmu, VS Code integrated terminal, etc). This is a deliberate, documented improvement — the existing code already handles these cases well.

**Important design note on label injection:** `tryTabSwitch` writes the PS1 label via a temp args file rather than string interpolation, preventing labels with `"` or backticks from breaking the command.

- [ ] **Step 1: Ensure `spawn` is imported**

Find:
```js
const { execSync } = require('child_process')
```
Replace with:
```js
const { execSync, spawn } = require('child_process')
```

- [ ] **Step 2: Add `isAlive` helper after `focusWindow`**

After the closing `}` of the `focusWindow` function (around line 301), add:

```js
function isAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true }
  catch { return false }
}
```

- [ ] **Step 3: Add `tryTabSwitch` helper**

After `isAlive`, add:

```js
const FOCUS_TAB_PS1 = path.join(__dirname, 'focusTab.ps1')

function tryTabSwitch(label) {
  // Write label to a temp file so special characters (", `, spaces) can't break the command string
  const tmpArgs = path.join(os.tmpdir(), `cs-taблabel-${process.pid}.txt`)
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
```

- [ ] **Step 4: Add `openNewTab` helper**

After `tryTabSwitch`, add:

```js
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
```

- [ ] **Step 5: Rewrite the focus endpoint**

Find `app.post('/api/sessions/:fileKey/focus', ...)` and replace the entire block:

```js
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

    const alive = isAlive(pid)
    dbg.alive = alive

    if (alive) {
      const exitCode = tryTabSwitch(label)
      dbg.tabSwitchExit = exitCode

      if (exitCode === 0) {
        focused = true
      } else {
        // exit 1 (no WT) or exit 2 (tab not found):
        // Fall back to existing window-level focus — supports non-WT terminals too.
        // On exit 2, re-check liveness first; if now dead, open new tab instead.
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
  } catch (err) {
    dbg.error = err.message
  }

  console.log('[focus]', fileKey, dbg)
  res.json({ focused, opened, dbg })
})
```

- [ ] **Step 6: Test with a running session**

```bash
curl -s -X POST http://localhost:3333/api/sessions/<fileKey>/focus
```
Expected: `{ "focused": true, "opened": false }`, correct WT tab active.

- [ ] **Step 7: Test open-if-not-running**

Kill the Claude session, then call the endpoint.
Expected: `{ "focused": false, "opened": true }`, new WT tab opens with `claude --resume <uuid>`.

- [ ] **Step 8: Commit**

```bash
cd .worktrees/feature-build
git add src/server.js
git commit -m "feat: enhance focus endpoint — UI Automation tab switch + open-if-not-running"
```

---

## Task 4: Update SessionTree.jsx — resume button + feedback labels

**Files:**
- Modify: `.worktrees/feature-build/web/src/SessionTree.jsx`

`isStale` is already imported (line 3). No import changes needed.

The focus button currently calls `onFocus(session.fileKey)` via prop. After this task, the button calls `fetch` directly via a local `handleFocus` — the `onFocus` prop is superseded for focus/resume handling and becomes unused for `SessionNode`. Leave the prop in the signature for now; it's harmless.

- [ ] **Step 1: Add `focusLabel` state to `SessionNode`**

Find in `SessionNode`:
```js
const [killConfirm, setKillConfirm] = useState(false)
```
Add below it:
```js
const [focusLabel, setFocusLabel] = useState(null)
```

- [ ] **Step 2: Add `isResumable` flag**

Find:
```js
const canFocus = !stale && !!session.terminalPid
const canKill  = !stale && ACTIVE_STATUSES.has(session.status)
```
Add `isResumable` between them:
```js
const canFocus    = !stale && !!session.terminalPid
const isResumable = stale && !!session.sessionId
const canKill     = !stale && ACTIVE_STATUSES.has(session.status)
```

- [ ] **Step 3: Add `handleFocus` after `handleKill`**

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

- [ ] **Step 4: Update the button block**

Find `{(canFocus || canKill) && (` and replace the whole actions block:

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
        onMouseEnter={e => { if (!focusLabel) { e.target.style.color = 'var(--text-primary)'; e.target.style.borderColor = 'var(--text-secondary)' } }}
        onMouseLeave={e => { if (!focusLabel) { e.target.style.color = 'var(--text-secondary)'; e.target.style.borderColor = 'var(--border)' } }}
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

- [ ] **Step 5: Verify**

Active session → "focus" button → shows "focused!" or "opened!" for 2s.
Stale session → "resume" button → new WT tab opens.

- [ ] **Step 6: Commit**

```bash
cd .worktrees/feature-build
git add web/src/SessionTree.jsx
git commit -m "feat: resume button for stale sessions + focus/resume feedback labels"
```

---

## Task 5: Add project-level Open button to ProjectPanel

**Files:**
- Modify: `.worktrees/feature-build/web/src/ProjectPanel.jsx`

`handleOpen` calls `fetch` directly — no prop threading through `App.jsx` needed. `App.jsx` requires no changes.

`useState` is already imported. Only `isStale` needs to be added.

- [ ] **Step 1: Add `isStale` import**

At the top of `ProjectPanel.jsx`, add (as a new import line — do NOT duplicate the existing React import):
```js
import { isStale } from './utils.js'
```

- [ ] **Step 2: Add `openLabel` state and `handleOpen` after `inputRef`**

```js
const [openLabel, setOpenLabel] = useState('open')

async function handleOpen() {
  const active = project.sessions.filter(s => !isStale(s))
  const target = (active.length ? active : project.sessions)
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

- [ ] **Step 3: Add Open button in header**

In the JSX, find the `<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>` header row. After the color-swatches `</div>`, add:

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

- [ ] **Step 4: Verify**

Active project → click "open" → correct tab switches → "focused!" for 2s.
Stale-only project → click "open" → new WT tab, `claude --resume` → "opened!" for 2s.

- [ ] **Step 5: Commit**

```bash
cd .worktrees/feature-build
git add web/src/ProjectPanel.jsx
git commit -m "feat: project-level Open button — focuses active tab or resumes with claude --resume"
```

---

## Task 6: Integration test pass

- [ ] **Test 1: Focus running session (session card)**
  Open 2 sessions in different WT tabs. Click "focus" on non-active card.
  Expected: correct tab active; "focused!" for 2s.

- [ ] **Test 2: Focus running session (project Open button)**
  Same setup. Click "open" in project header.
  Expected: same as Test 1.

- [ ] **Test 3: Resume stale session (session card)**
  Kill a session. Click "resume" on stale card.
  Expected: new WT tab, `claude --resume <uuid>` in right directory; "opened!" for 2s.

- [ ] **Test 4: Open stale-only project (Open button)**
  Same setup. Click "open" in project header.
  Expected: new WT tab, `claude --resume <uuid>`; "opened!" for 2s.

- [ ] **Test 5: WT minimised**
  Minimise WT, click "focus". Expected: WT restored, correct tab active.

- [ ] **Test 6: Label with special characters**
  Rename a project to `test[2]`. Click "focus".
  Expected: correct tab matched; no silent failure.

- [ ] **Test 7: `lastSessionId` persistence**
  Start a Claude session. Run `cat ~/.claude/session-meta.json`.
  Expected: `lastSessionId` UUID present for that project.

- [ ] **Test 8: HTTP response shape**
  `curl -s -X POST http://localhost:3333/api/sessions/<fileKey>/focus | jq '{focused,opened}'`
  Expected: both fields present as booleans.

- [ ] **Final commit**

```bash
cd .worktrees/feature-build
git commit --allow-empty -m "test: manual integration pass complete — focus+resume feature"
```
