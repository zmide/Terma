"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function loadWindowsX11WindowGuardNative(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "nativeModule")) {
    return options.nativeModule;
  }
  try {
    return require("../native/win-sftp-drag");
  } catch {
    return null;
  }
}

function planWindowsX11WindowCorrection(rectValue, clientOriginValue, workAreaValue) {
  const rect = rectValue || {};
  const clientOrigin = clientOriginValue || {};
  const work = workAreaValue || {};
  const left = Number(rect.left);
  const top = Number(rect.top);
  const right = Number(rect.right);
  const bottom = Number(rect.bottom);
  const clientX = Number(clientOrigin.x);
  const clientY = Number(clientOrigin.y);
  const workLeft = Number(work.left);
  const workTop = Number(work.top);
  const workRight = Number(work.right);
  const workBottom = Number(work.bottom);
  if (![left, top, right, bottom, clientX, clientY, workLeft, workTop, workRight, workBottom].every(Number.isFinite)) {
    return null;
  }
  const width = right - left;
  if (width <= 0 || bottom <= top || workRight <= workLeft || workBottom <= workTop) return null;

  const nonClientTop = Math.max(0, clientY - top);
  const minimumTitleVisible = Math.min(16, Math.max(8, nonClientTop));
  const visibleTitleHeight = Math.max(0, Math.min(clientY, workBottom) - Math.max(top, workTop));
  const visibleWidth = Math.max(0, Math.min(right, workRight) - Math.max(left, workLeft));
  const titleIsUnreachable = nonClientTop > 0 && visibleTitleHeight < minimumTitleVisible;
  const windowIsHorizontallyUnreachable = visibleWidth < 96;
  if (!titleIsUnreachable && !windowIsHorizontallyUnreachable) return null;

  let nextLeft = left;
  let nextTop = top;
  if (titleIsUnreachable) {
    nextTop = workTop;
    if (width <= workRight - workLeft) {
      nextLeft = Math.max(workLeft, Math.min(left, workRight - width));
    } else if (left < workLeft) {
      nextLeft = workLeft;
    }
  }
  if (windowIsHorizontallyUnreachable) {
    nextLeft = right <= workLeft + 96 ? workLeft : Math.max(workLeft, workRight - width);
    if (nextTop < workTop || nextTop >= workBottom - 16) nextTop = workTop;
  }
  return nextLeft === left && nextTop === top ? null : {left:nextLeft, top:nextTop};
}

function windowsX11WindowGuardScript(serverProcessId, options = {}) {
  const pid = Number(serverProcessId);
  if (!Number.isInteger(pid) || pid < 1) throw new Error("X Server process ID is invalid");
  const enableWpsCompatibility = options.enableWpsCompatibility === true;
  return String.raw`
$serverProcessId = ${pid}
$enableWpsCompatibility = ${enableWpsCompatibility ? "$true" : "$false"}
$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class TermaX11WindowGuardNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder title, int maxCount);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong32(IntPtr hWnd, int index);

    public static long GetWindowStyle(IntPtr hWnd) {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, -16).ToInt64() : GetWindowLong32(hWnd, -16);
    }
}
"@

try {
    Add-Type -TypeDefinition $source -ErrorAction Stop
} catch {
    exit 0
}

$WS_CAPTION = 0x00C00000L
$MONITOR_DEFAULTTONEAREST = 2
$SWP_NOSIZE = 0x0001
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_ASYNCWINDOWPOS = 0x4000
$setWindowFlags = $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_ASYNCWINDOWPOS
$WM_CLOSE = 0x0010
$WM_NCLBUTTONDOWN = 0x00A1
$HTCAPTION = 2
$SW_MINIMIZE = 6
$SW_MAXIMIZE = 3
$SW_RESTORE = 9
$VK_LBUTTON = 0x01
$SM_CXSIZE = 30
$SM_CYSIZE = 31
$wpsMouseStates = @{}

while ($true) {
    try {
        $process = Get-Process -Id $serverProcessId -ErrorAction Stop
        if ($process.HasExited) { break }
    } catch {
        break
    }

    [TermaX11WindowGuardNative]::EnumWindows({
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        [uint32]$windowProcessId = 0
        [TermaX11WindowGuardNative]::GetWindowThreadProcessId($hWnd, [ref]$windowProcessId) | Out-Null
        if ($windowProcessId -ne $serverProcessId) { return $true }
        if (-not [TermaX11WindowGuardNative]::IsWindowVisible($hWnd)) { return $true }

        $className = New-Object System.Text.StringBuilder 128
        [TermaX11WindowGuardNative]::GetClassName($hWnd, $className, $className.Capacity) | Out-Null
        if (-not $className.ToString().StartsWith("vcxsrv/x X", [StringComparison]::OrdinalIgnoreCase)) { return $true }

        if ($enableWpsCompatibility) {
            $windowTitle = New-Object System.Text.StringBuilder 256
            [TermaX11WindowGuardNative]::GetWindowText($hWnd, $windowTitle, $windowTitle.Capacity) | Out-Null
            $isWpsWindow = $windowTitle.ToString() -match '(?i)\bWPS(?: Office)?\b|\bwpsoffice\b'
            if ($isWpsWindow -and -not [TermaX11WindowGuardNative]::IsIconic($hWnd) -and [TermaX11WindowGuardNative]::GetForegroundWindow() -eq $hWnd) {
                $clientRect = New-Object TermaX11WindowGuardNative+RECT
                $windowRect = New-Object TermaX11WindowGuardNative+RECT
                $cursor = New-Object TermaX11WindowGuardNative+POINT
                $leftDown = (([TermaX11WindowGuardNative]::GetAsyncKeyState($VK_LBUTTON) -band 0x8000) -ne 0)
                if ([TermaX11WindowGuardNative]::GetClientRect($hWnd, [ref]$clientRect) -and [TermaX11WindowGuardNative]::GetWindowRect($hWnd, [ref]$windowRect) -and [TermaX11WindowGuardNative]::GetCursorPos([ref]$cursor)) {
                    $key = $hWnd.ToInt64().ToString()
                    $state = if ($wpsMouseStates.ContainsKey($key)) { $wpsMouseStates[$key] } else { $null }
                    if ($leftDown -and -not $state) {
                        # WPS draws its tab/title controls at the very top of the
                        # X11 window. They may be in the native non-client area,
                        # so ScreenToClient() can produce a negative Y here.
                        # Use screen coordinates relative to the full window for
                        # both native and client-drawn caption variants.
                        $width = $windowRect.Right - $windowRect.Left
                        $relativeX = $cursor.X - $windowRect.Left
                        $relativeY = $cursor.Y - $windowRect.Top
                        $captionButtonWidth = [TermaX11WindowGuardNative]::GetSystemMetrics($SM_CXSIZE)
                        if ($captionButtonWidth -lt 24 -or $captionButtonWidth -gt 160) { $captionButtonWidth = 48 }
                        $captionButtonHeight = [TermaX11WindowGuardNative]::GetSystemMetrics($SM_CYSIZE)
                        if ($captionButtonHeight -lt 20 -or $captionButtonHeight -gt 120) { $captionButtonHeight = 48 }
                        $inTopBar = $relativeY -ge 0 -and $relativeY -le ([Math]::Max(56, $captionButtonHeight + 8))
                        $action = ""
                        $minCenter = $width - ($captionButtonWidth * 2.5)
                        $maxCenter = $width - ($captionButtonWidth * 1.5)
                        $closeCenter = $width - ($captionButtonWidth * 0.5)
                        $captionLeft = $width - ($captionButtonWidth * 3.4)
                        if ($inTopBar -and $relativeX -ge $captionLeft) {
                            $minDistance = [Math]::Abs($relativeX - $minCenter)
                            $maxDistance = [Math]::Abs($relativeX - $maxCenter)
                            $closeDistance = [Math]::Abs($relativeX - $closeCenter)
                            if ($closeDistance -le $maxDistance -and $closeDistance -le $minDistance) { $action = "close" }
                            elseif ($maxDistance -le $minDistance) { $action = "maximize" }
                            else { $action = "minimize" }
                        }
                        elseif ($relativeX -ge 240 -and $relativeX -lt ($width - 160) -and $relativeY -ge 0 -and $relativeY -le 28) {
                            [TermaX11WindowGuardNative]::ReleaseCapture() | Out-Null
                            [TermaX11WindowGuardNative]::SendMessage($hWnd, $WM_NCLBUTTONDOWN, [IntPtr]$HTCAPTION, [IntPtr]::Zero) | Out-Null
                            $action = "drag"
                        }
                        if ($action) { $wpsMouseStates[$key] = $action }
                    } elseif (-not $leftDown -and $state) {
                        $wpsMouseStates.Remove($key) | Out-Null
                        if ($state -eq "close") {
                            [TermaX11WindowGuardNative]::SendMessage($hWnd, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                        } elseif ($state -eq "maximize") {
                            $command = if ([TermaX11WindowGuardNative]::IsZoomed($hWnd)) { $SW_RESTORE } else { $SW_MAXIMIZE }
                            [TermaX11WindowGuardNative]::ShowWindow($hWnd, $command) | Out-Null
                        } elseif ($state -eq "minimize") {
                            [TermaX11WindowGuardNative]::ShowWindow($hWnd, $SW_MINIMIZE) | Out-Null
                        }
                    }
                }
            }
        }

        if ([TermaX11WindowGuardNative]::IsIconic($hWnd) -or [TermaX11WindowGuardNative]::IsZoomed($hWnd)) { return $true }
        if (([TermaX11WindowGuardNative]::GetWindowStyle($hWnd) -band $WS_CAPTION) -eq 0) { return $true }

        $rect = New-Object TermaX11WindowGuardNative+RECT
        if (-not [TermaX11WindowGuardNative]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
        $clientOrigin = New-Object TermaX11WindowGuardNative+POINT
        if (-not [TermaX11WindowGuardNative]::ClientToScreen($hWnd, [ref]$clientOrigin)) { return $true }

        $monitor = [TermaX11WindowGuardNative]::MonitorFromWindow($hWnd, $MONITOR_DEFAULTTONEAREST)
        if ($monitor -eq [IntPtr]::Zero) { return $true }
        $monitorInfo = New-Object TermaX11WindowGuardNative+MONITORINFO
        $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
        if (-not [TermaX11WindowGuardNative]::GetMonitorInfo($monitor, [ref]$monitorInfo)) { return $true }

        $work = $monitorInfo.rcWork
        $nonClientTop = [Math]::Max(0, $clientOrigin.Y - $rect.Top)
        $minimumTitleVisible = [Math]::Min(16, [Math]::Max(8, $nonClientTop))
        $visibleTitleHeight = [Math]::Max(0, [Math]::Min($clientOrigin.Y, $work.Bottom) - [Math]::Max($rect.Top, $work.Top))
        $visibleWidth = [Math]::Max(0, [Math]::Min($rect.Right, $work.Right) - [Math]::Max($rect.Left, $work.Left))
        $titleIsUnreachable = $nonClientTop -gt 0 -and $visibleTitleHeight -lt $minimumTitleVisible
        $windowIsHorizontallyUnreachable = $visibleWidth -lt 96
        if (-not $titleIsUnreachable -and -not $windowIsHorizontallyUnreachable) { return $true }

        $width = $rect.Right - $rect.Left
        $height = $rect.Bottom - $rect.Top
        $nextLeft = $rect.Left
        $nextTop = $rect.Top
        if ($titleIsUnreachable) {
            $nextTop = $work.Top
            if ($width -le ($work.Right - $work.Left)) {
                $nextLeft = [Math]::Max($work.Left, [Math]::Min($rect.Left, $work.Right - $width))
            } elseif ($rect.Left -lt $work.Left) {
                $nextLeft = $work.Left
            }
        }
        if ($windowIsHorizontallyUnreachable) {
            $nextLeft = if ($rect.Right -le ($work.Left + 96)) { $work.Left } else { [Math]::Max($work.Left, $work.Right - $width) }
            if ($nextTop -lt $work.Top -or $nextTop -ge ($work.Bottom - 16)) { $nextTop = $work.Top }
        }

        if ($nextLeft -ne $rect.Left -or $nextTop -ne $rect.Top) {
            [TermaX11WindowGuardNative]::SetWindowPos($hWnd, [IntPtr]::Zero, $nextLeft, $nextTop, 0, 0, $setWindowFlags) | Out-Null
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null

    # The previous 250 ms poll could miss a normal quick click. Keep this
    # lightweight guard responsive enough to observe mouse-down and mouse-up
    # without changing non-WPS window behavior.
    Start-Sleep -Milliseconds 35
}
`;
}

function startWindowsX11WindowGuard(serverProcess, options = {}) {
  const pid = Number(serverProcess?.pid);
  if (!Number.isInteger(pid) || pid < 1) return null;
  const environment = options.environment || process.env;
  const nativeModule = loadWindowsX11WindowGuardNative(options);
  try {
    if (nativeModule?.startX11WindowGuard?.(pid)) {
      const guard = {kind:"native", nativeModule, debugTimer:null};
      if (String(environment.TERMA_X11_WINDOW_GUARD_DEBUG || "") === "1"
          && typeof nativeModule.getX11WindowGuardDiagnostics === "function") {
        let lastSignature = "";
        const report = () => {
          try {
            const diagnostics = nativeModule.getX11WindowGuardDiagnostics();
            const rect = diagnostics?.currentRect || {};
            const signature = [
              diagnostics?.running,
              diagnostics?.hookInstalled,
              diagnostics?.hookError,
              diagnostics?.lastEventId,
              diagnostics?.currentWindowValid,
              diagnostics?.currentIconic,
              diagnostics?.currentZoomed,
              rect.left,
              rect.top,
              rect.right,
              rect.bottom
            ].join(":");
            if (signature === lastSignature) return;
            lastSignature = signature;
            console.warn("[x11-window-guard]", diagnostics);
          } catch {}
        };
        report();
        guard.debugTimer = setInterval(report, 100);
        guard.debugTimer.unref?.();
      }
      return guard;
    }
  } catch {}
  const runtimeSpawn = options.spawn || spawn;
  const systemRoot = String(environment.SystemRoot || environment.WINDIR || "C:\\Windows");
  const executable = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  let scriptPath = "";
  try {
    const temporaryRoot = String(environment.TEMP || environment.TMP || os.tmpdir());
    scriptPath = path.join(temporaryRoot, `terma-x11-window-guard-${pid}-${Date.now()}.ps1`);
    // The compatibility script is intentionally kept in a temporary file.
    // Passing the whole script through -EncodedCommand can exceed Windows'
    // command-line length limit once WPS support is enabled.
    fs.writeFileSync(scriptPath, windowsX11WindowGuardScript(pid, options), {encoding:"utf8", mode:0o600});
    const child = runtimeSpawn(executable, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath
    ], {
      detached:false,
      windowsHide:true,
      stdio:"ignore",
      env:environment
    });
    const cleanup = () => {
      if (!scriptPath) return;
      try { fs.rmSync(scriptPath, {force:true}); } catch {}
      scriptPath = "";
    };
    child.once?.("error", cleanup);
    child.once?.("exit", cleanup);
    child.unref?.();
    return child;
  } catch {
    if (scriptPath) {
      try { fs.rmSync(scriptPath, {force:true}); } catch {}
    }
    return null;
  }
}

function stopWindowsX11WindowGuard(child) {
  if (child?.kind === "native") {
    if (child.debugTimer) {
      clearInterval(child.debugTimer);
      child.debugTimer = null;
    }
    try {
      return Boolean(child.nativeModule?.stopX11WindowGuard?.());
    } catch {
      return false;
    }
  }
  if (!child || child.exitCode !== null) return false;
  try {
    child.kill();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  loadWindowsX11WindowGuardNative,
  planWindowsX11WindowCorrection,
  startWindowsX11WindowGuard,
  stopWindowsX11WindowGuard,
  windowsX11WindowGuardScript
};
