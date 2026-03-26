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
