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

**Written:** by `session-hook.js` on every `SessionStart` event, during the existing atomic meta write.
**Never cleared:** persists when a session ends so a future Focus can resume it.
**Absent** for projects that have never had a `SessionStart` fire (process-discovered sessions).

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
Session file exists AND process alive (kill -0 pid)?
  ├── YES → PowerShell: UI Automation tab switch + SetForegroundWindow
  │          → { focused: true }
  └── NO  → lastSessionId known in session-meta.json?
              ├── YES → wt.exe new-tab: claude --resume <lastSessionId> in <cwd>
              │          → { focused: false, opened: true }
              └── NO  → wt.exe new-tab: claude in <cwd>
                         → { focused: false, opened: true }
              (if wt.exe not found or spawn fails)
                         → { focused: false, opened: false }
```

**Process liveness check** (before attempting UI Automation):
```js
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
```

**Tab switch PowerShell script** (`src/focusTab.ps1`):

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

foreach ($tab in $tabs) {
  if ($tab.Current.Name -like "*[$Label]*") {
    $invoke = $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    [Win32]::ShowWindow($wt.MainWindowHandle, 9)   # SW_RESTORE
    [Win32]::SetForegroundWindow($wt.MainWindowHandle)
    exit 0
  }
}
exit 2  # tab not found (session may have different title)
```

Exit codes:
- `0` — tab found and switched
- `1` — WindowsTerminal process not found
- `2` — tab not found (fall through: still bring WT to front, return `{ focused: false }`)

**Open new tab PowerShell** (inline, from `server.js`):

```powershell
$cmd = 'claude --resume <lastSessionId>'   # or just 'claude' if no lastSessionId
Start-Process wt.exe "-w 0 new-tab --title `"[<label>]`" --startingDirectory `"<cwd>`" cmd /k `"$cmd`""
```

`-w 0` ensures the new tab opens in the existing WT window (not a new window). If WT is not running, `Start-Process wt.exe` starts it.

**Updated response contract:**

| Scenario | Response |
|---|---|
| Tab found and switched | `{ focused: true, opened: false }` |
| Session not running, new tab opened | `{ focused: false, opened: true }` |
| WT not found, spawn also failed | `{ focused: false, opened: false }` |

---

### 4. `Drawer.jsx` — Focus button feedback

```jsx
// existing: shows "Focused!" on { focused: true }
// new: also shows "Opened!" on { opened: true }
const label = result.focused ? 'Focused!' : result.opened ? 'Opened!' : 'Focus';
```

Timeout: revert to "Focus" after 2 seconds (same as existing behaviour).

---

## File Changes Summary

| File | Change |
|---|---|
| `session-hook.js` | Write `lastSessionId` to meta on `SessionStart` |
| `src/server.js` | Enhance focus endpoint: liveness check, UI Automation, open-if-not-running |
| `src/focusTab.ps1` | New — PowerShell UI Automation tab switcher |
| `web/src/Drawer.jsx` | Show "Opened!" on `{ opened: true }` |

---

## Error Handling

| Scenario | Handling |
|---|---|
| `focusTab.ps1` exits 1 (no WT) | Skip tab switch; attempt `wt.exe` spawn anyway |
| `focusTab.ps1` exits 2 (tab not found) | Return `{ focused: false, opened: false }` — tab title may not match yet |
| `wt.exe` spawn fails | Catch, return `{ focused: false, opened: false }` |
| `cwd` missing from meta | Use project name as fallback directory |
| Session pid is 0 or undefined | Treat as not running |

---

## Testing

- **Focus running session:** click Focus with session active → correct tab becomes active in WT
- **Open not-running (with lastSessionId):** click Focus on idle project → new WT tab opens, `claude --resume` runs
- **Open not-running (no lastSessionId):** same but fresh `claude` starts
- **Tab title mismatch:** session title changed mid-run → Focus falls back to window-level
- **WT minimised:** SW_RESTORE restores the window before SetForegroundWindow
- **Multiple WT windows:** first WT process is used (documented limitation)
- **Drawer feedback:** "Focused!" vs "Opened!" vs silent displayed correctly
