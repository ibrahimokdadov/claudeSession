# claudeSession — Focus & Resume Enhancement Spec

**Date:** 2026-03-24
**Status:** Approved
**Extends:** `2026-03-21-claudesession-design.md`

---

## Problem

The existing spec scoped out per-tab focus ("Windows Terminal doesn't expose per-tab window handles"). The Focus button only brings the WT *window* to front. Users with 10–20 sessions need to switch directly to the *tab* for a project — and if that session isn't running, they need to open it and resume the previous conversation.

---

## Goals

- Click Focus in the dashboard → the correct WT tab becomes active (not just the window)
- If the session isn't running → open a new WT tab, resume the last known Claude session ID
- If no prior session ID exists → open a new `claude` session in the project directory
- Drawer Focus button shows contextual feedback: "Focused!" or "Opened!"

---

## Out of Scope

- Multi-monitor WT window disambiguation (use first WT process found)
- Non-Windows Terminal terminals (degraded gracefully: tab switch fails, window focus still attempted)

---

## Changes to Existing Design

This spec adds three surgical changes to the approved v1 design. No existing behaviour is removed.

---

### 1. `session-meta.json` — `lastSessionId` field

Each project entry gains an optional `lastSessionId` field:

```json
{
  "_colorIndex": 3,
  "C:/Users/ibrah/cascadeProjects/postwriter": {
    "label": "postwriter",
    "color": "#58a6ff",
    "firstSeen": "2026-03-21T10:00:00.000Z",
    "lastSessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Written:** by `session-hook.js` on every `SessionStart` event, during the existing atomic meta write. This applies regardless of how the session was first discovered — whether via the hook or via the server's startup WMI scan. When a `SessionStart` hook fires for a process-discovered session (one that already has a synthetic session file), `lastSessionId` is written at that point.

**Never cleared:** persists when a session ends so a future Focus can resume it.

**Absent** for projects that have never had a `SessionStart` hook fire. These are handled by the NO-`lastSessionId` branch (open fresh `claude`).

---

### 2. `session-hook.js` — persist `lastSessionId` on SessionStart

On `SessionStart` events, the hook already has access to `sessionId` in the event payload. Add to the existing meta write:

```js
if (event === 'SessionStart' && sessionId) {
  meta[cwd].lastSessionId = sessionId;
}
```

This piggybacks on the existing atomic write (`tmp → rename`) — no separate write needed.

---

### 3. `POST /api/sessions/:project/focus` — enhanced logic

**Decision tree:**

```
Session file exists AND isAlive(pid)?
  ├── YES → Run focusTab.ps1 with label
  │          ├── exit 0 (tab found + switched)
  │          │    → { focused: true, opened: false }           HTTP 200
  │          ├── exit 1 (WT process not found)
  │          │    → { focused: false, opened: false }          HTTP 200
  │          │      (do NOT spawn — session is alive elsewhere)
  │          └── exit 2 (tab not found)
  │               → re-check isAlive(pid)
  │                  ├── still alive → SetForegroundWindow(wt)
  │                  │                 { focused: false, opened: false }   HTTP 200
  │                  └── now dead    → fall through to open-new-tab branch
  └── NO (session not running) →
        lastSessionId known?
          ├── YES → wt.exe new-tab: cmd /k "claude --resume <lastSessionId>"
          └── NO  → wt.exe new-tab: cmd /k "claude"
        spawn succeeded?
          ├── YES → { focused: false, opened: true }           HTTP 200
          └── NO  → { focused: false, opened: false }          HTTP 200
```

All responses return **HTTP 200**. Success/failure is communicated in the response body. This is consistent with the base spec's convention for the original focus endpoint.

**Process liveness check:**
```js
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
```

---

### 4. `src/focusTab.ps1` — UI Automation tab switcher

```powershell
param([string]$Label)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
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

# Escape label for regex: square brackets and other regex metacharacters
$escaped = [Regex]::Escape($Label)

foreach ($tab in $tabs) {
  # Tab title format: "[label] status" — match on the bracketed label prefix
  if ($tab.Current.Name -match "^\[$escaped\]") {
    $invoke = $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    [Win32]::ShowWindow($wt.MainWindowHandle, 9)        # SW_RESTORE
    [Win32]::SetForegroundWindow($wt.MainWindowHandle)
    exit 0
  }
}

# Tab not found — bring WT to front anyway so user can see it
[Win32]::ShowWindow($wt.MainWindowHandle, 9)
[Win32]::SetForegroundWindow($wt.MainWindowHandle)
exit 2
```

**Note on label matching:** `-like` operator treats `[`, `]`, `*`, `?` as special. This script uses `-match` with `[Regex]::Escape($Label)` instead, which correctly handles all label characters including `[`, `]`, `*`, `?`, `.`, `+`, etc. The pattern `^\[$escaped\]` matches the literal `[label]` prefix at the start of the tab title.

Exit codes:
- `0` — tab found, switched, WT brought to front
- `1` — WindowsTerminal process not found
- `2` — tab not found, WT still brought to front

---

### 5. Open new tab (server.js, inline)

When the session is not running, `server.js` spawns `wt.exe` directly via Node's `child_process.spawn`. The `cwd` path must be double-quoted in the constructed argument string to handle spaces in paths (e.g., `C:\Users\My Name\Projects\foo`).

```js
const resumeCmd = lastSessionId
  ? `claude --resume ${lastSessionId}`
  : `claude`;

const wtArgs = [
  '-w', '0',
  'new-tab',
  '--title', `[${label}]`,
  '--startingDirectory', cwd,   // spawn() passes this as a separate argv element — no quoting needed
  'cmd', '/k', resumeCmd,
];

spawn('wt.exe', wtArgs, { detached: true, stdio: 'ignore' }).unref();
```

**Important:** Using `child_process.spawn` with an args array (not a shell string) means `cwd` and `label` are passed as discrete argv elements. No manual quoting or escaping is needed — Node handles the Windows argument encoding. Do NOT use `exec` or shell: true for this call.

---

### 6. `web/src/Drawer.jsx` — Focus button feedback

```jsx
const [focusLabel, setFocusLabel] = React.useState('Focus');

async function handleFocus() {
  const res = await fetch(`/api/sessions/${project}/focus`, { method: 'POST' });
  const data = await res.json();
  const next = data.focused ? 'Focused!' : data.opened ? 'Opened!' : 'Focus';
  setFocusLabel(next);
  if (next !== 'Focus') {
    setTimeout(() => setFocusLabel('Focus'), 2000);
  }
}
```

A single `setTimeout` resets the label for both "Focused!" and "Opened!" states. The `if (next !== 'Focus')` guard avoids a no-op timer on silent failure.

---

## File Changes Summary

| File | Change |
|---|---|
| `~/.claude/session-hook.js` | Write `lastSessionId` to meta on `SessionStart` |
| `src/server.js` | Enhance focus endpoint: liveness check, PS1 invocation, race re-check, open-if-not-running |
| `src/focusTab.ps1` | New — PowerShell UI Automation tab switcher using regex matching |
| `web/src/Drawer.jsx` | Show "Opened!" on `{ opened: true }`; single timer for all non-default states |

---

## Error Handling

| Scenario | Handling |
|---|---|
| `focusTab.ps1` exits 0 | Return `{ focused: true, opened: false }` HTTP 200 |
| `focusTab.ps1` exits 1 (no WT) | Session is alive but WT not found — return `{ focused: false, opened: false }` HTTP 200; do NOT spawn |
| `focusTab.ps1` exits 2 (tab not found, session alive) | Re-check liveness; if still alive return `{ focused: false, opened: false }` HTTP 200; if now dead fall through to open-new-tab |
| `focusTab.ps1` exits 2 (tab not found, session now dead) | Open new tab as if session was not running |
| `wt.exe` spawn fails | Catch error, return `{ focused: false, opened: false }` HTTP 200 |
| `cwd` missing from meta | Pass project name as `--startingDirectory`; WT will not find it as a valid path and will fall back to `%USERPROFILE%`. The session opens but not in the project directory. This is a known degraded case — acceptable since `cwd` is absent only for synthetic/incomplete session entries. |
| Session pid is 0 or undefined | `isAlive` returns false; treat as not running |
| Label contains regex metacharacters (`[`, `]`, `*`, etc.) | `[Regex]::Escape` in PS1 handles all cases |

---

## Constraints

- Project labels must not be empty strings (enforced by the existing rename validation in the Drawer).
- `wt.exe` must be on PATH (standard for Windows Terminal installs). If not found, spawn fails and `{ focused: false, opened: false }` is returned.

---

## Testing

- **Focus running session:** click Focus with session active → correct tab becomes active in WT, WT brought to front
- **Open not-running (with lastSessionId):** click Focus on idle project → new WT tab opens, `claude --resume <uuid>` runs in correct directory
- **Open not-running (no lastSessionId):** same but fresh `claude` starts
- **Race: session dies between liveness check and PS1 run:** PS1 exits 2, re-check confirms dead, new tab opened with resume
- **Exit code 1 (no WT, session alive):** returns `{ focused: false, opened: false }`, no spawn attempted
- **Tab not found, session alive (exit 2):** WT is still brought to front; returns `{ focused: false, opened: false }`
- **Label with special characters (`[test]`, `my*project`):** regex escaping ensures correct match; no silent mismatch
- **Path with spaces (`C:\Users\My Name\Projects\foo`):** spawn args array handles correctly; tab opens in right directory
- **WT minimised:** SW_RESTORE restores before SetForegroundWindow
- **Drawer feedback:** "Focused!" → 2s → "Focus"; "Opened!" → 2s → "Focus"; silent failure stays "Focus"
- **HTTP status:** all outcomes return 200
- **process-discovered session gets SessionStart hook late:** `lastSessionId` written at that point; next Focus will resume correctly
