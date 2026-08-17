#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

#include <windows.h>
#include <ole2.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <sherrors.h>
#include <winhttp.h>
#include <node_api.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <limits>
#include <map>
#include <new>
#include <stdexcept>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace {

constexpr uint32_t kApiVersion = 1;
constexpr size_t kMaxItems = 10000;
// Explorer often asks for small, non-contiguous IStream reads.  Coalescing
// those requests into a larger range avoids opening a fresh HTTP/SFTP range
// channel for every 1 MiB read while keeping the virtual stream bounded.
constexpr size_t kReadAheadBytes = 4 * 1024 * 1024;
constexpr DWORD kDefaultTimeoutMs = 30000;
constexpr DWORD kMinTimeoutMs = 1000;
constexpr DWORD kMaxTimeoutMs = 120000;
constexpr size_t kMaxManifestBytes = 16 * 1024 * 1024;
constexpr DWORD kAsyncCompletionGraceMs = 3000;
constexpr DWORD kAsyncCompletionTimeoutMs = 30000;

struct DragItem {
  std::string id;
  std::wstring relative_path;
  std::wstring content_url;
  uint64_t size = 0;
  FILETIME modified{};
  bool is_directory = false;
};

struct DragSpec {
  std::wstring base_url;
  std::wstring token;
  std::wstring manifest_url;
  std::wstring content_base_url;
  std::wstring extra_headers;
  DWORD timeout_ms = kDefaultTimeoutMs;
  DWORD arm_timeout_ms = 10000;
  bool wait_for_activation = false;
  HWND source_window = nullptr;
  std::vector<DragItem> items;
};

struct EventPayload {
  std::string type;
  std::string request_id;
  std::string message;
  std::string drop_effect;
  HRESULT result = S_OK;
  LONG screen_x = 0;
  LONG screen_y = 0;
  bool has_position = false;
};

enum class ManifestState {
  kPending,
  kReady,
  kFailed,
};

struct DragSession;

std::mutex g_sessions_mutex;
std::unordered_map<std::string, std::shared_ptr<DragSession>> g_sessions;
std::atomic<uint64_t> g_request_counter{1};
std::atomic<bool> g_shutting_down{false};

constexpr DWORD kX11WindowGuardIntervalMs = 250;
constexpr LONG kX11WindowGuardMinimumVisibleWidth = 96;
constexpr wchar_t kVcXsrvWindowClassPrefix[] = L"vcxsrv/x X";

enum class X11CaptionAction {
  kNone,
  kMinimize,
  kMaximize,
  kClose,
};

constexpr UINT kWmNcHitTest = 0x0084;
constexpr LRESULT kHtCaption = 2;
constexpr LRESULT kHtMinButton = 8;
constexpr LRESULT kHtMaxButton = 9;
constexpr LRESULT kHtClose = 20;

std::mutex g_x11_window_guard_lifecycle_mutex;
std::mutex g_x11_window_guard_wait_mutex;
std::condition_variable g_x11_window_guard_wait_cv;
std::thread g_x11_window_guard_worker;
std::atomic<bool> g_x11_window_guard_stop{false};
std::atomic<DWORD> g_x11_window_guard_process_id{0};
std::atomic<bool> g_x11_window_guard_hook_installed{false};
std::atomic<DWORD> g_x11_window_guard_hook_error{0};
std::atomic<uintptr_t> g_x11_window_guard_last_window{0};
std::atomic<int> g_x11_window_guard_last_action{0};
std::atomic<LONG> g_x11_window_guard_last_mouse_x{0};
std::atomic<LONG> g_x11_window_guard_last_mouse_y{0};
std::atomic<bool> g_x11_window_guard_last_before_iconic{false};
std::atomic<bool> g_x11_window_guard_last_before_zoomed{false};
std::atomic<bool> g_x11_window_guard_last_after_iconic{false};
std::atomic<bool> g_x11_window_guard_last_after_zoomed{false};
std::atomic<DWORD> g_x11_window_guard_last_hit_test{0};
std::atomic<uint64_t> g_x11_window_guard_last_event_id{0};
HWND g_x11_window_guard_pending_window = nullptr;
X11CaptionAction g_x11_window_guard_pending_action = X11CaptionAction::kNone;
std::unordered_map<uintptr_t, RECT> g_x11_window_guard_restore_rects;
struct X11MinimizeState {
  RECT restore_rect{};
  bool observed_iconic = false;
};
std::unordered_map<uintptr_t, X11MinimizeState>
    g_x11_window_guard_minimize_states;
HWND g_x11_window_guard_drag_window = nullptr;
POINT g_x11_window_guard_drag_start_point{};
RECT g_x11_window_guard_drag_start_rect{};

bool IsTargetVcXsrvWindow(HWND window, DWORD target_process_id,
                          bool require_visible = true) {
  if (window == nullptr || !IsWindow(window) ||
      (require_visible && !IsWindowVisible(window))) {
    return false;
  }
  DWORD window_process_id = 0;
  GetWindowThreadProcessId(window, &window_process_id);
  if (window_process_id != target_process_id) return false;

  wchar_t class_name[128]{};
  if (GetClassNameW(window, class_name,
                    static_cast<int>(sizeof(class_name) / sizeof(wchar_t))) <=
      0) {
    return false;
  }
  constexpr size_t prefix_length =
      (sizeof(kVcXsrvWindowClassPrefix) / sizeof(wchar_t)) - 1;
  return _wcsnicmp(class_name, kVcXsrvWindowClassPrefix, prefix_length) == 0;
}

bool IsWpsX11Window(HWND window, DWORD target_process_id) {
  if (!IsTargetVcXsrvWindow(window, target_process_id)) return false;
  wchar_t title[256]{};
  if (GetWindowTextW(window, title,
                     static_cast<int>(sizeof(title) / sizeof(wchar_t))) <= 0) {
    return false;
  }
  std::wstring normalized(title);
  std::transform(normalized.begin(), normalized.end(), normalized.begin(),
                 [](wchar_t value) {
                   return static_cast<wchar_t>(std::towlower(value));
                 });
  return normalized.find(L"wps office") != std::wstring::npos ||
         normalized.find(L"wpsoffice") != std::wstring::npos ||
         normalized.rfind(L"wps", 0) == 0;
}

UINT WindowDpi(HWND window) {
  using GetDpiForWindowFunction = UINT(WINAPI*)(HWND);
  static const auto get_dpi_for_window =
      reinterpret_cast<GetDpiForWindowFunction>(GetProcAddress(
          GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
  const UINT dpi = get_dpi_for_window ? get_dpi_for_window(window) : 96;
  return dpi >= 96 && dpi <= 768 ? dpi : 96;
}

int SystemMetricForWindow(HWND window, int metric) {
  using GetSystemMetricsForDpiFunction = int(WINAPI*)(int, UINT);
  static const auto get_system_metrics_for_dpi =
      reinterpret_cast<GetSystemMetricsForDpiFunction>(GetProcAddress(
          GetModuleHandleW(L"user32.dll"), "GetSystemMetricsForDpi"));
  const UINT dpi = WindowDpi(window);
  const int value = get_system_metrics_for_dpi
                        ? get_system_metrics_for_dpi(metric, dpi)
                        : GetSystemMetrics(metric);
  return value;
}

X11CaptionAction WpsCaptionActionAtPoint(HWND window, POINT point,
                                         bool* is_drag_area) {
  if (is_drag_area) *is_drag_area = false;
  RECT rect{};
  if (!GetWindowRect(window, &rect)) return X11CaptionAction::kNone;
  const LONG width = rect.right - rect.left;
  const LONG relative_x = point.x - rect.left;
  const LONG relative_y = point.y - rect.top;
  if (width <= 0 || relative_x < 0 || relative_x >= width || relative_y < 0) {
    return X11CaptionAction::kNone;
  }

  const UINT dpi = WindowDpi(window);
  const int raw_button_width = SystemMetricForWindow(window, SM_CXSIZE);
  const int raw_button_height = SystemMetricForWindow(window, SM_CYSIZE);
  const double button_width = static_cast<double>(
      raw_button_width >= 24 && raw_button_width <= 160
          ? raw_button_width
          : MulDiv(48, static_cast<int>(dpi), 96));
  const LONG top_bar_height = std::max<LONG>(
      MulDiv(56, static_cast<int>(dpi), 96),
      (raw_button_height >= 20 && raw_button_height <= 120
           ? raw_button_height
           : MulDiv(48, static_cast<int>(dpi), 96)) +
          MulDiv(8, static_cast<int>(dpi), 96));
  if (relative_y > top_bar_height) return X11CaptionAction::kNone;

  // Rootless VcXsrv windows normally expose the real Windows caption hit
  // target even though the X11 application owns the title text. Prefer that
  // result over geometry so custom DPI/scaling and non-standard button widths
  // cannot turn a maximize click into close.
  const LPARAM hit_test_point =
      MAKELPARAM(static_cast<short>(point.x), static_cast<short>(point.y));
  const LRESULT native_hit =
      SendMessageW(window, kWmNcHitTest, 0, hit_test_point);
  g_x11_window_guard_last_hit_test.store(
      static_cast<DWORD>(native_hit >= 0 ? native_hit : 0));
  if (native_hit == kHtMinButton) return X11CaptionAction::kMinimize;
  if (native_hit == kHtMaxButton) return X11CaptionAction::kMaximize;
  if (native_hit == kHtClose) return X11CaptionAction::kClose;
  if (native_hit == kHtCaption) {
    if (is_drag_area) *is_drag_area = true;
    return X11CaptionAction::kNone;
  }

  const double min_center = width - button_width * 2.5;
  const double max_center = width - button_width * 1.5;
  const double close_center = width - button_width * 0.5;
  const double caption_left = width - button_width * 3.4;
  if (relative_x >= caption_left) {
    const double min_distance = std::abs(relative_x - min_center);
    const double max_distance = std::abs(relative_x - max_center);
    const double close_distance = std::abs(relative_x - close_center);
    if (close_distance <= max_distance && close_distance <= min_distance) {
      return X11CaptionAction::kClose;
    }
    if (max_distance <= min_distance) return X11CaptionAction::kMaximize;
    return X11CaptionAction::kMinimize;
  }

  const LONG drag_left = MulDiv(240, static_cast<int>(dpi), 96);
  const LONG drag_height = MulDiv(32, static_cast<int>(dpi), 96);
  if (relative_x >= drag_left && relative_x < caption_left &&
      relative_y <= drag_height) {
    if (is_drag_area) *is_drag_area = true;
  }
  return X11CaptionAction::kNone;
}

void ApplyWpsCaptionAction(HWND window, X11CaptionAction action) {
  if (!IsWindow(window)) return;
  const bool before_iconic = IsIconic(window) != FALSE;
  const bool before_zoomed = IsZoomed(window) != FALSE;
  g_x11_window_guard_last_before_iconic.store(before_iconic);
  g_x11_window_guard_last_before_zoomed.store(before_zoomed);
  switch (action) {
    case X11CaptionAction::kMinimize:
      // VcXsrv's rootless WPS windows draw these controls inside HTCLIENT and
      // ignore SC_MINIMIZE. SW_FORCEMINIMIZE asks the window manager to apply
      // the state even though the target belongs to another process.
      {
        RECT restore_rect{};
        if (GetWindowRect(window, &restore_rect)) {
          g_x11_window_guard_minimize_states[
              reinterpret_cast<uintptr_t>(window)] =
              X11MinimizeState{restore_rect, false};
        }
        ShowWindowAsync(window, SW_FORCEMINIMIZE);
      }
      break;
    case X11CaptionAction::kMaximize: {
      RECT current{};
      MONITORINFO monitor_info{};
      monitor_info.cbSize = sizeof(monitor_info);
      HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
      if (!GetWindowRect(window, &current) || monitor == nullptr ||
          !GetMonitorInfoW(monitor, &monitor_info)) {
        break;
      }
      const RECT& work = monitor_info.rcWork;
      const RECT& screen = monitor_info.rcMonitor;
      auto fills = [&current](const RECT& target) {
        constexpr LONG tolerance = 8;
        return std::abs(current.left - target.left) <= tolerance &&
               std::abs(current.top - target.top) <= tolerance &&
               std::abs(current.right - target.right) <= tolerance &&
               std::abs(current.bottom - target.bottom) <= tolerance;
      };
      const uintptr_t key = reinterpret_cast<uintptr_t>(window);
      RECT target{};
      const auto saved = g_x11_window_guard_restore_rects.find(key);
      if (saved != g_x11_window_guard_restore_rects.end()) {
        target = saved->second;
        g_x11_window_guard_restore_rects.erase(saved);
      } else if (fills(work) || fills(screen)) {
        const LONG work_width = work.right - work.left;
        const LONG work_height = work.bottom - work.top;
        const LONG target_width = std::max<LONG>(800, work_width * 4 / 5);
        const LONG target_height = std::max<LONG>(600, work_height * 4 / 5);
        target.left = work.left + (work_width - target_width) / 2;
        target.top = work.top + (work_height - target_height) / 2;
        target.right = target.left + target_width;
        target.bottom = target.top + target_height;
      } else {
        g_x11_window_guard_restore_rects[key] = current;
        target = work;
      }
      SetWindowPos(window, nullptr, target.left, target.top,
                   target.right - target.left, target.bottom - target.top,
                   SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED |
                       SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
      break;
    }
    case X11CaptionAction::kClose:
      PostMessageW(window, WM_CLOSE, 0, 0);
      break;
    default:
      break;
  }
  g_x11_window_guard_last_after_iconic.store(IsIconic(window) != FALSE);
  g_x11_window_guard_last_after_zoomed.store(IsZoomed(window) != FALSE);
}

LRESULT CALLBACK X11WindowGuardMouseHook(int code, WPARAM message,
                                         LPARAM parameter) {
  if (code < 0) return CallNextHookEx(nullptr, code, message, parameter);
  const DWORD process_id = g_x11_window_guard_process_id.load();
  if (process_id == 0 || parameter == 0) {
    return CallNextHookEx(nullptr, code, message, parameter);
  }
  const auto* mouse = reinterpret_cast<const MSLLHOOKSTRUCT*>(parameter);
  if (message == WM_LBUTTONDOWN) {
    HWND window = GetAncestor(WindowFromPoint(mouse->pt), GA_ROOT);
    if (!IsWpsX11Window(window, process_id)) {
      return CallNextHookEx(nullptr, code, message, parameter);
    }
    bool is_drag_area = false;
    const X11CaptionAction action =
        WpsCaptionActionAtPoint(window, mouse->pt, &is_drag_area);
    if (action != X11CaptionAction::kNone) {
      g_x11_window_guard_pending_window = window;
      g_x11_window_guard_pending_action = action;
      g_x11_window_guard_last_window.store(
          reinterpret_cast<uintptr_t>(window));
      g_x11_window_guard_last_action.store(static_cast<int>(action));
      g_x11_window_guard_last_mouse_x.store(mouse->pt.x);
      g_x11_window_guard_last_mouse_y.store(mouse->pt.y);
      g_x11_window_guard_last_event_id.fetch_add(1);
      return 1;
    }
    if (is_drag_area) {
      RECT drag_rect{};
      if (!GetWindowRect(window, &drag_rect)) {
        return CallNextHookEx(nullptr, code, message, parameter);
      }
      g_x11_window_guard_last_window.store(
          reinterpret_cast<uintptr_t>(window));
      g_x11_window_guard_last_action.store(4);
      g_x11_window_guard_last_mouse_x.store(mouse->pt.x);
      g_x11_window_guard_last_mouse_y.store(mouse->pt.y);
      g_x11_window_guard_last_event_id.fetch_add(1);
      g_x11_window_guard_restore_rects.erase(
          reinterpret_cast<uintptr_t>(window));
      g_x11_window_guard_drag_window = window;
      g_x11_window_guard_drag_start_point = mouse->pt;
      g_x11_window_guard_drag_start_rect = drag_rect;
      return 1;
    }
  } else if (message == WM_MOUSEMOVE &&
             g_x11_window_guard_drag_window != nullptr) {
    HWND window = g_x11_window_guard_drag_window;
    if (!IsWpsX11Window(window, process_id)) {
      g_x11_window_guard_drag_window = nullptr;
      return CallNextHookEx(nullptr, code, message, parameter);
    }
    const LONG next_left = g_x11_window_guard_drag_start_rect.left +
                           mouse->pt.x - g_x11_window_guard_drag_start_point.x;
    const LONG next_top = g_x11_window_guard_drag_start_rect.top +
                          mouse->pt.y - g_x11_window_guard_drag_start_point.y;
    SetWindowPos(window, nullptr, next_left, next_top, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                     SWP_ASYNCWINDOWPOS);
    return 1;
  } else if (message == WM_LBUTTONUP &&
             g_x11_window_guard_drag_window != nullptr) {
    g_x11_window_guard_drag_window = nullptr;
    return 1;
  } else if (message == WM_LBUTTONUP &&
             g_x11_window_guard_pending_action != X11CaptionAction::kNone) {
    HWND window = g_x11_window_guard_pending_window;
    const X11CaptionAction pending_action =
        g_x11_window_guard_pending_action;
    g_x11_window_guard_pending_window = nullptr;
    g_x11_window_guard_pending_action = X11CaptionAction::kNone;
    if (IsWpsX11Window(window, process_id)) {
      bool ignored_drag_area = false;
      const X11CaptionAction release_action =
          WpsCaptionActionAtPoint(window, mouse->pt, &ignored_drag_area);
      if (release_action == pending_action) {
        ApplyWpsCaptionAction(window, pending_action);
      }
    }
    return 1;
  }
  return CallNextHookEx(nullptr, code, message, parameter);
}

BOOL CALLBACK GuardX11Window(HWND window, LPARAM parameter) {
  const DWORD target_process_id =
      static_cast<DWORD>(static_cast<uintptr_t>(parameter));
  if (!IsTargetVcXsrvWindow(window, target_process_id, false)) {
    return TRUE;
  }

  const uintptr_t window_key = reinterpret_cast<uintptr_t>(window);
  const auto minimized = g_x11_window_guard_minimize_states.find(window_key);
  if (minimized != g_x11_window_guard_minimize_states.end()) {
    if (IsIconic(window)) {
      minimized->second.observed_iconic = true;
      return TRUE;
    }
    if (minimized->second.observed_iconic) {
      const RECT restore = minimized->second.restore_rect;
      g_x11_window_guard_minimize_states.erase(minimized);
      SetWindowPos(window, nullptr, restore.left, restore.top,
                   restore.right - restore.left, restore.bottom - restore.top,
                   SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED |
                       SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
      return TRUE;
    }
  }
  if (IsIconic(window) || IsZoomed(window)) return TRUE;

  const LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
  if ((style & WS_CAPTION) == 0) return TRUE;

  RECT window_rect{};
  POINT client_origin{};
  if (!GetWindowRect(window, &window_rect) ||
      !ClientToScreen(window, &client_origin)) {
    return TRUE;
  }

  HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
  if (monitor == nullptr) return TRUE;
  MONITORINFO monitor_info{};
  monitor_info.cbSize = sizeof(monitor_info);
  if (!GetMonitorInfoW(monitor, &monitor_info)) return TRUE;

  const RECT& work = monitor_info.rcWork;
  const LONG non_client_top =
      std::max<LONG>(0, client_origin.y - window_rect.top);
  const LONG minimum_title_visible =
      std::min<LONG>(16, std::max<LONG>(8, non_client_top));
  const LONG visible_title_height = std::max<LONG>(
      0, std::min(client_origin.y, work.bottom) -
             std::max(window_rect.top, work.top));
  const LONG visible_width = std::max<LONG>(
      0, std::min(window_rect.right, work.right) -
             std::max(window_rect.left, work.left));
  const bool title_is_unreachable =
      non_client_top > 0 && visible_title_height < minimum_title_visible;
  const bool window_is_horizontally_unreachable =
      visible_width < kX11WindowGuardMinimumVisibleWidth;
  if (!title_is_unreachable && !window_is_horizontally_unreachable) {
    return TRUE;
  }

  const LONG width = window_rect.right - window_rect.left;
  LONG next_left = window_rect.left;
  LONG next_top = window_rect.top;
  if (title_is_unreachable) {
    next_top = work.top;
    if (width <= work.right - work.left) {
      next_left = std::max(
          work.left, std::min(window_rect.left, work.right - width));
    } else if (window_rect.left < work.left) {
      next_left = work.left;
    }
  }
  if (window_is_horizontally_unreachable) {
    next_left = window_rect.right <=
                        work.left + kX11WindowGuardMinimumVisibleWidth
                    ? work.left
                    : std::max(work.left, work.right - width);
    if (next_top < work.top || next_top >= work.bottom - 16) {
      next_top = work.top;
    }
  }

  if (next_left != window_rect.left || next_top != window_rect.top) {
    SetWindowPos(window, nullptr, next_left, next_top, 0, 0,
                 SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                     SWP_ASYNCWINDOWPOS);
  }
  return TRUE;
}

void RunX11WindowGuard(DWORD process_id) {
  g_x11_window_guard_process_id.store(process_id);
  g_x11_window_guard_pending_window = nullptr;
  g_x11_window_guard_pending_action = X11CaptionAction::kNone;
  g_x11_window_guard_restore_rects.clear();
  g_x11_window_guard_minimize_states.clear();
  g_x11_window_guard_drag_window = nullptr;
  HHOOK mouse_hook =
      SetWindowsHookExW(WH_MOUSE_LL, X11WindowGuardMouseHook,
                        GetModuleHandleW(nullptr), 0);
  g_x11_window_guard_hook_installed.store(mouse_hook != nullptr);
  g_x11_window_guard_hook_error.store(mouse_hook == nullptr ? GetLastError() : 0);
  auto next_correction = std::chrono::steady_clock::now();
  while (!g_x11_window_guard_stop.load()) {
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      if (message.message == WM_QUIT) {
        g_x11_window_guard_stop.store(true);
        break;
      }
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    const auto now = std::chrono::steady_clock::now();
    if (now >= next_correction) {
      EnumWindows(GuardX11Window, static_cast<LPARAM>(process_id));
      next_correction =
          now + std::chrono::milliseconds(kX11WindowGuardIntervalMs);
    }
    MsgWaitForMultipleObjectsEx(0, nullptr, 25, QS_ALLINPUT,
                                MWMO_INPUTAVAILABLE);
  }
  if (mouse_hook != nullptr) UnhookWindowsHookEx(mouse_hook);
  g_x11_window_guard_hook_installed.store(false);
  g_x11_window_guard_pending_window = nullptr;
  g_x11_window_guard_pending_action = X11CaptionAction::kNone;
  g_x11_window_guard_restore_rects.clear();
  g_x11_window_guard_minimize_states.clear();
  g_x11_window_guard_drag_window = nullptr;
  g_x11_window_guard_process_id.store(0);
}

bool StopX11WindowGuardLocked() {
  const bool was_running = g_x11_window_guard_worker.joinable();
  g_x11_window_guard_stop.store(true);
  g_x11_window_guard_wait_cv.notify_all();
  if (g_x11_window_guard_worker.joinable()) {
    g_x11_window_guard_worker.join();
  }
  g_x11_window_guard_stop.store(false);
  return was_running;
}

bool StopX11WindowGuardWorker() {
  std::lock_guard<std::mutex> lock(g_x11_window_guard_lifecycle_mutex);
  return StopX11WindowGuardLocked();
}

bool StartX11WindowGuardWorker(DWORD process_id) {
  std::lock_guard<std::mutex> lock(g_x11_window_guard_lifecycle_mutex);
  StopX11WindowGuardLocked();
  if (process_id == 0 || g_shutting_down.load()) return false;
  try {
    g_x11_window_guard_worker =
        std::thread([process_id]() { RunX11WindowGuard(process_id); });
  } catch (...) {
    throw;
  }
  return true;
}

std::string LastErrorMessage(DWORD code) {
  LPWSTR raw = nullptr;
  DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<LPWSTR>(&raw), 0, nullptr);
  if (length == 0 || raw == nullptr) {
    return "Windows error " + std::to_string(code);
  }
  int utf8_length =
      WideCharToMultiByte(CP_UTF8, 0, raw, static_cast<int>(length), nullptr, 0,
                          nullptr, nullptr);
  std::string result(std::max(utf8_length, 0), '\0');
  if (utf8_length > 0) {
    WideCharToMultiByte(CP_UTF8, 0, raw, static_cast<int>(length), result.data(),
                        utf8_length, nullptr, nullptr);
  }
  LocalFree(raw);
  while (!result.empty() &&
         (result.back() == '\r' || result.back() == '\n' ||
          result.back() == ' ')) {
    result.pop_back();
  }
  return result;
}

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) {
    return {};
  }
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                   static_cast<int>(value.size()), nullptr, 0);
  if (length <= 0) {
    throw std::runtime_error("Invalid UTF-8 string");
  }
  std::wstring result(length, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), length);
  return result;
}

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) {
    return {};
  }
  int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                                   static_cast<int>(value.size()), nullptr, 0,
                                   nullptr, nullptr);
  if (length <= 0) {
    throw std::runtime_error("Invalid UTF-16 string");
  }
  std::string result(length, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), length,
                      nullptr, nullptr);
  return result;
}

std::wstring ToLower(std::wstring value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
  return value;
}

std::string GetString(napi_env env, napi_value value, const char* label) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
    throw std::runtime_error(std::string(label) + " must be a string");
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    throw std::runtime_error(std::string("Unable to read ") + label);
  }
  std::string result(length + 1, '\0');
  if (length > 0 &&
      napi_get_value_string_utf8(env, value, result.data(), length + 1,
                                 &length) != napi_ok) {
    throw std::runtime_error(std::string("Unable to read ") + label);
  }
  result.resize(length);
  return result;
}

bool GetNamed(napi_env env,
              napi_value object,
              const char* name,
              napi_value* value) {
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok || !has) {
    return false;
  }
  return napi_get_named_property(env, object, name, value) == napi_ok;
}

std::string GetOptionalString(napi_env env,
                              napi_value object,
                              const char* name) {
  napi_value value;
  if (!GetNamed(env, object, name, &value)) {
    return {};
  }
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type == napi_undefined || type == napi_null) {
    return {};
  }
  return GetString(env, value, name);
}

bool GetOptionalBool(napi_env env,
                     napi_value object,
                     const char* name,
                     bool fallback) {
  napi_value value;
  if (!GetNamed(env, object, name, &value)) {
    return fallback;
  }
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type == napi_undefined || type == napi_null) {
    return fallback;
  }
  if (type != napi_boolean) {
    throw std::runtime_error(std::string(name) + " must be a boolean");
  }
  bool result = false;
  napi_get_value_bool(env, value, &result);
  return result;
}

uint64_t GetUnsignedInteger(napi_env env,
                            napi_value value,
                            const char* label) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type == napi_bigint) {
    uint64_t result = 0;
    bool lossless = false;
    napi_get_value_bigint_uint64(env, value, &result, &lossless);
    if (!lossless) {
      throw std::runtime_error(std::string(label) + " is out of range");
    }
    return result;
  }
  if (type == napi_number) {
    double number = 0;
    napi_get_value_double(env, value, &number);
    if (number < 0 || number > static_cast<double>(
                                  std::numeric_limits<uint64_t>::max()) ||
        number != std::floor(number)) {
      throw std::runtime_error(std::string(label) +
                               " must be a non-negative integer");
    }
    return static_cast<uint64_t>(number);
  }
  if (type == napi_string) {
    std::string text = GetString(env, value, label);
    size_t parsed = 0;
    uint64_t result = std::stoull(text, &parsed, 10);
    if (parsed != text.size()) {
      throw std::runtime_error(std::string(label) + " must be an integer");
    }
    return result;
  }
  throw std::runtime_error(std::string(label) +
                           " must be a number, bigint, or decimal string");
}

uint64_t GetOptionalUnsignedInteger(napi_env env,
                                    napi_value object,
                                    const char* name,
                                    uint64_t fallback) {
  napi_value value;
  if (!GetNamed(env, object, name, &value)) {
    return fallback;
  }
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type == napi_undefined || type == napi_null) {
    return fallback;
  }
  return GetUnsignedInteger(env, value, name);
}

FILETIME UnixMillisecondsToFileTime(uint64_t milliseconds) {
  constexpr uint64_t kEpochOffsetMs = 11644473600000ULL;
  uint64_t ticks = (milliseconds + kEpochOffsetMs) * 10000ULL;
  ULARGE_INTEGER value;
  value.QuadPart = ticks;
  FILETIME result;
  result.dwLowDateTime = value.LowPart;
  result.dwHighDateTime = value.HighPart;
  return result;
}

FILETIME CurrentFileTime() {
  FILETIME result;
  GetSystemTimeAsFileTime(&result);
  return result;
}

std::wstring ValidateRelativePath(const std::string& input) {
  std::wstring path = Utf8ToWide(input);
  std::replace(path.begin(), path.end(), L'/', L'\\');
  while (!path.empty() && path.front() == L'\\') {
    path.erase(path.begin());
  }
  if (path.empty() || path.size() >= MAX_PATH ||
      path.find(L':') != std::wstring::npos) {
    throw std::runtime_error("relativePath is invalid or too long");
  }
  std::wstringstream stream(path);
  std::wstring segment;
  while (std::getline(stream, segment, L'\\')) {
    if (segment.empty() || segment == L"." || segment == L"..") {
      throw std::runtime_error("relativePath contains an invalid segment");
    }
  }
  return path;
}

std::string UrlEncode(const std::string& input) {
  constexpr char kHex[] = "0123456789ABCDEF";
  std::string result;
  result.reserve(input.size() * 3);
  for (unsigned char ch : input) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
        (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' ||
        ch == '~') {
      result.push_back(static_cast<char>(ch));
    } else {
      result.push_back('%');
      result.push_back(kHex[ch >> 4]);
      result.push_back(kHex[ch & 0x0F]);
    }
  }
  return result;
}

std::wstring ReplaceAll(std::wstring value,
                        const std::wstring& needle,
                        const std::wstring& replacement) {
  size_t position = 0;
  while ((position = value.find(needle, position)) != std::wstring::npos) {
    value.replace(position, needle.size(), replacement);
    position += replacement.size();
  }
  return value;
}

bool ContainsCrlf(const std::wstring& value) {
  return value.find(L'\r') != std::wstring::npos ||
         value.find(L'\n') != std::wstring::npos;
}

struct JsonValue {
  enum class Type { kNull, kBool, kNumber, kString, kArray, kObject };

  Type type = Type::kNull;
  bool boolean = false;
  std::string scalar;
  std::vector<JsonValue> array;
  std::map<std::string, JsonValue> object;

  const JsonValue* Find(const std::string& key) const {
    auto found = object.find(key);
    return found == object.end() ? nullptr : &found->second;
  }
};

class JsonParser {
 public:
  explicit JsonParser(const std::string& source) : source_(source) {}

  JsonValue Parse() {
    SkipWhitespace();
    JsonValue result = ParseValue();
    SkipWhitespace();
    if (position_ != source_.size()) {
      Fail("Unexpected trailing JSON data");
    }
    return result;
  }

 private:
  [[noreturn]] void Fail(const char* message) const {
    throw std::runtime_error(std::string(message) + " at byte " +
                             std::to_string(position_));
  }

  void SkipWhitespace() {
    while (position_ < source_.size()) {
      char ch = source_[position_];
      if (ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n') {
        break;
      }
      ++position_;
    }
  }

  bool Consume(char expected) {
    if (position_ < source_.size() && source_[position_] == expected) {
      ++position_;
      return true;
    }
    return false;
  }

  void Expect(char expected) {
    if (!Consume(expected)) {
      Fail("Unexpected JSON token");
    }
  }

  JsonValue ParseValue() {
    SkipWhitespace();
    if (position_ >= source_.size()) {
      Fail("Unexpected end of JSON");
    }
    switch (source_[position_]) {
      case 'n':
        return ParseLiteral("null", JsonValue::Type::kNull, false);
      case 't':
        return ParseLiteral("true", JsonValue::Type::kBool, true);
      case 'f':
        return ParseLiteral("false", JsonValue::Type::kBool, false);
      case '"': {
        JsonValue result;
        result.type = JsonValue::Type::kString;
        result.scalar = ParseString();
        return result;
      }
      case '[':
        return ParseArray();
      case '{':
        return ParseObject();
      default:
        if (source_[position_] == '-' ||
            (source_[position_] >= '0' && source_[position_] <= '9')) {
          return ParseNumber();
        }
        Fail("Unsupported JSON value");
    }
  }

  JsonValue ParseLiteral(const char* text,
                         JsonValue::Type type,
                         bool boolean) {
    size_t length = std::strlen(text);
    if (source_.compare(position_, length, text) != 0) {
      Fail("Invalid JSON literal");
    }
    position_ += length;
    JsonValue result;
    result.type = type;
    result.boolean = boolean;
    return result;
  }

  static uint32_t HexDigit(char ch) {
    if (ch >= '0' && ch <= '9') {
      return static_cast<uint32_t>(ch - '0');
    }
    if (ch >= 'a' && ch <= 'f') {
      return static_cast<uint32_t>(ch - 'a' + 10);
    }
    if (ch >= 'A' && ch <= 'F') {
      return static_cast<uint32_t>(ch - 'A' + 10);
    }
    return std::numeric_limits<uint32_t>::max();
  }

  uint32_t ParseHexCodeUnit() {
    if (position_ + 4 > source_.size()) {
      Fail("Incomplete JSON Unicode escape");
    }
    uint32_t value = 0;
    for (int index = 0; index < 4; ++index) {
      uint32_t digit = HexDigit(source_[position_++]);
      if (digit == std::numeric_limits<uint32_t>::max()) {
        Fail("Invalid JSON Unicode escape");
      }
      value = (value << 4) | digit;
    }
    return value;
  }

  static void AppendUtf8(uint32_t codepoint, std::string* output) {
    if (codepoint <= 0x7F) {
      output->push_back(static_cast<char>(codepoint));
    } else if (codepoint <= 0x7FF) {
      output->push_back(static_cast<char>(0xC0 | (codepoint >> 6)));
      output->push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    } else if (codepoint <= 0xFFFF) {
      output->push_back(static_cast<char>(0xE0 | (codepoint >> 12)));
      output->push_back(
          static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
      output->push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    } else {
      output->push_back(static_cast<char>(0xF0 | (codepoint >> 18)));
      output->push_back(
          static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
      output->push_back(
          static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
      output->push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    }
  }

  std::string ParseString() {
    Expect('"');
    std::string result;
    while (position_ < source_.size()) {
      unsigned char ch = static_cast<unsigned char>(source_[position_++]);
      if (ch == '"') {
        return result;
      }
      if (ch < 0x20) {
        Fail("Control character in JSON string");
      }
      if (ch != '\\') {
        result.push_back(static_cast<char>(ch));
        continue;
      }
      if (position_ >= source_.size()) {
        Fail("Incomplete JSON escape");
      }
      char escaped = source_[position_++];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          result.push_back(escaped);
          break;
        case 'b':
          result.push_back('\b');
          break;
        case 'f':
          result.push_back('\f');
          break;
        case 'n':
          result.push_back('\n');
          break;
        case 'r':
          result.push_back('\r');
          break;
        case 't':
          result.push_back('\t');
          break;
        case 'u': {
          uint32_t codepoint = ParseHexCodeUnit();
          if (codepoint >= 0xD800 && codepoint <= 0xDBFF) {
            if (position_ + 2 > source_.size() ||
                source_[position_] != '\\' ||
                source_[position_ + 1] != 'u') {
              Fail("Missing low surrogate in JSON string");
            }
            position_ += 2;
            uint32_t low = ParseHexCodeUnit();
            if (low < 0xDC00 || low > 0xDFFF) {
              Fail("Invalid low surrogate in JSON string");
            }
            codepoint =
                0x10000 + ((codepoint - 0xD800) << 10) + (low - 0xDC00);
          } else if (codepoint >= 0xDC00 && codepoint <= 0xDFFF) {
            Fail("Unexpected low surrogate in JSON string");
          }
          AppendUtf8(codepoint, &result);
          break;
        }
        default:
          Fail("Unknown JSON escape");
      }
    }
    Fail("Unterminated JSON string");
  }

  JsonValue ParseNumber() {
    size_t start = position_;
    Consume('-');
    if (Consume('0')) {
      // A leading zero is complete unless a fraction or exponent follows.
    } else {
      if (position_ >= source_.size() || source_[position_] < '1' ||
          source_[position_] > '9') {
        Fail("Invalid JSON number");
      }
      while (position_ < source_.size() && source_[position_] >= '0' &&
             source_[position_] <= '9') {
        ++position_;
      }
    }
    if (Consume('.')) {
      if (position_ >= source_.size() || source_[position_] < '0' ||
          source_[position_] > '9') {
        Fail("Invalid JSON fraction");
      }
      while (position_ < source_.size() && source_[position_] >= '0' &&
             source_[position_] <= '9') {
        ++position_;
      }
    }
    if (position_ < source_.size() &&
        (source_[position_] == 'e' || source_[position_] == 'E')) {
      ++position_;
      if (position_ < source_.size() &&
          (source_[position_] == '+' || source_[position_] == '-')) {
        ++position_;
      }
      if (position_ >= source_.size() || source_[position_] < '0' ||
          source_[position_] > '9') {
        Fail("Invalid JSON exponent");
      }
      while (position_ < source_.size() && source_[position_] >= '0' &&
             source_[position_] <= '9') {
        ++position_;
      }
    }
    JsonValue result;
    result.type = JsonValue::Type::kNumber;
    result.scalar = source_.substr(start, position_ - start);
    return result;
  }

  JsonValue ParseArray() {
    Expect('[');
    JsonValue result;
    result.type = JsonValue::Type::kArray;
    SkipWhitespace();
    if (Consume(']')) {
      return result;
    }
    while (true) {
      result.array.push_back(ParseValue());
      SkipWhitespace();
      if (Consume(']')) {
        return result;
      }
      Expect(',');
      SkipWhitespace();
    }
  }

  JsonValue ParseObject() {
    Expect('{');
    JsonValue result;
    result.type = JsonValue::Type::kObject;
    SkipWhitespace();
    if (Consume('}')) {
      return result;
    }
    while (true) {
      if (position_ >= source_.size() || source_[position_] != '"') {
        Fail("JSON object key must be a string");
      }
      std::string key = ParseString();
      SkipWhitespace();
      Expect(':');
      result.object[key] = ParseValue();
      SkipWhitespace();
      if (Consume('}')) {
        return result;
      }
      Expect(',');
      SkipWhitespace();
    }
  }

  const std::string& source_;
  size_t position_ = 0;
};

void EnsureLoopbackUrl(const std::wstring& url) {
  if (url.empty() || url.size() > 8192) {
    throw std::runtime_error("Content URL is empty or too long");
  }
  URL_COMPONENTS components{};
  components.dwStructSize = sizeof(components);
  components.dwHostNameLength = static_cast<DWORD>(-1);
  components.dwUrlPathLength = static_cast<DWORD>(-1);
  components.dwExtraInfoLength = static_cast<DWORD>(-1);
  if (!WinHttpCrackUrl(url.c_str(), 0, 0, &components)) {
    throw std::runtime_error("Content URL is invalid");
  }
  if (components.nScheme != INTERNET_SCHEME_HTTP &&
      components.nScheme != INTERNET_SCHEME_HTTPS) {
    throw std::runtime_error("Content URL must use HTTP or HTTPS");
  }
  std::wstring host(components.lpszHostName, components.dwHostNameLength);
  host = ToLower(host);
  if (host != L"localhost" && host != L"127.0.0.1" && host != L"::1" &&
      host != L"[::1]") {
    throw std::runtime_error(
        "Content URL must point to the local Terma service");
  }
}

std::wstring BuildContentUrl(const DragSpec& spec,
                             const std::string& item_id,
                             const std::string& explicit_url) {
  if (!explicit_url.empty()) {
    std::wstring result = Utf8ToWide(explicit_url);
    EnsureLoopbackUrl(result);
    return result;
  }

  std::wstring encoded_id = Utf8ToWide(UrlEncode(item_id));
  if (!spec.content_base_url.empty()) {
    std::wstring result = spec.content_base_url;
    if (result.find(L"{id}") != std::wstring::npos) {
      result = ReplaceAll(result, L"{id}", encoded_id);
    } else {
      while (!result.empty() && result.back() == L'/') {
        result.pop_back();
      }
      result += L"/";
      result += encoded_id;
    }
    EnsureLoopbackUrl(result);
    return result;
  }

  if (spec.base_url.empty() || spec.token.empty()) {
    throw std::runtime_error(
        "A file item requires contentUrl, contentBaseUrl, or baseUrl + token");
  }
  std::wstring result = spec.base_url;
  while (!result.empty() && result.back() == L'/') {
    result.pop_back();
  }
  result += L"/api/sftp/native-drag/";
  result += Utf8ToWide(UrlEncode(WideToUtf8(spec.token)));
  result += L"/content/";
  result += encoded_id;
  EnsureLoopbackUrl(result);
  return result;
}

std::wstring ParseHeaders(napi_env env, napi_value spec) {
  std::wstring result;
  napi_value headers;
  if (!GetNamed(env, spec, "headers", &headers)) {
    return result;
  }
  napi_valuetype type;
  napi_typeof(env, headers, &type);
  if (type == napi_undefined || type == napi_null) {
    return result;
  }
  if (type != napi_object) {
    throw std::runtime_error("headers must be an object");
  }
  napi_value keys;
  napi_get_property_names(env, headers, &keys);
  uint32_t count = 0;
  napi_get_array_length(env, keys, &count);
  for (uint32_t index = 0; index < count; ++index) {
    napi_value key_value;
    napi_get_element(env, keys, index, &key_value);
    std::string key = GetString(env, key_value, "header name");
    napi_value header_value;
    napi_get_property(env, headers, key_value, &header_value);
    std::string value = GetString(env, header_value, "header value");
    std::wstring wide_key = Utf8ToWide(key);
    std::wstring wide_value = Utf8ToWide(value);
    if (wide_key.empty() || ContainsCrlf(wide_key) ||
        ContainsCrlf(wide_value) || wide_key.find(L':') != std::wstring::npos) {
      throw std::runtime_error("headers contain an invalid name or value");
    }
    result += wide_key + L": " + wide_value + L"\r\n";
  }
  return result;
}

DragSpec ParseSpec(napi_env env, napi_value value) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type != napi_object) {
    throw std::runtime_error("spec must be an object");
  }

  DragSpec spec;
  spec.base_url = Utf8ToWide(GetOptionalString(env, value, "baseUrl"));
  spec.token = Utf8ToWide(GetOptionalString(env, value, "token"));
  spec.manifest_url =
      Utf8ToWide(GetOptionalString(env, value, "manifestUrl"));
  spec.content_base_url =
      Utf8ToWide(GetOptionalString(env, value, "contentBaseUrl"));
  spec.extra_headers = ParseHeaders(env, value);
  uint64_t timeout =
      GetOptionalUnsignedInteger(env, value, "timeoutMs", kDefaultTimeoutMs);
  timeout = std::clamp<uint64_t>(timeout, kMinTimeoutMs, kMaxTimeoutMs);
  spec.timeout_ms = static_cast<DWORD>(timeout);
  uint64_t arm_timeout =
      GetOptionalUnsignedInteger(env, value, "armTimeoutMs", 10000);
  spec.arm_timeout_ms = static_cast<DWORD>(
      std::clamp<uint64_t>(arm_timeout, 1000, 30000));
  spec.wait_for_activation =
      GetOptionalBool(env, value, "waitForActivation", false);
  const uint64_t source_window =
      GetOptionalUnsignedInteger(env, value, "sourceWindowHandle", 0);
  spec.source_window = reinterpret_cast<HWND>(
      static_cast<uintptr_t>(source_window));
  if (spec.source_window != nullptr && !IsWindow(spec.source_window)) {
    throw std::runtime_error("sourceWindowHandle is not a valid window");
  }

  if (!spec.base_url.empty()) {
    EnsureLoopbackUrl(spec.base_url);
  }
  if (!spec.content_base_url.empty()) {
    std::wstring probe_url =
        ReplaceAll(spec.content_base_url, L"{id}", L"probe");
    EnsureLoopbackUrl(probe_url);
  }
  if (spec.manifest_url.empty() && !spec.base_url.empty() &&
      !spec.token.empty()) {
    spec.manifest_url = spec.base_url;
    while (!spec.manifest_url.empty() && spec.manifest_url.back() == L'/') {
      spec.manifest_url.pop_back();
    }
    spec.manifest_url += L"/api/sftp/native-drag/";
    spec.manifest_url += Utf8ToWide(UrlEncode(WideToUtf8(spec.token)));
  }
  if (!spec.manifest_url.empty()) {
    EnsureLoopbackUrl(spec.manifest_url);
  }
  if (ContainsCrlf(spec.token)) {
    throw std::runtime_error("token contains invalid characters");
  }

  napi_value items_value;
  if (!GetNamed(env, value, "items", &items_value)) {
    if (spec.manifest_url.empty()) {
      throw std::runtime_error("spec.items or spec.manifestUrl is required");
    }
    items_value = nullptr;
  }
  uint32_t count = 0;
  if (items_value != nullptr) {
    bool is_array = false;
    napi_is_array(env, items_value, &is_array);
    if (!is_array) {
      throw std::runtime_error("spec.items must be an array");
    }
    napi_get_array_length(env, items_value, &count);
    if (count == 0 || count > kMaxItems) {
      throw std::runtime_error("spec.items must contain 1 to 10000 entries");
    }
  }

  std::unordered_set<std::wstring> paths;
  spec.items.reserve(count);
  for (uint32_t index = 0; index < count; ++index) {
    napi_value item_value;
    napi_get_element(env, items_value, index, &item_value);
    napi_typeof(env, item_value, &type);
    if (type != napi_object) {
      throw std::runtime_error("Each item must be an object");
    }
    DragItem item;
    item.id = GetOptionalString(env, item_value, "id");
    if (item.id.empty()) {
      throw std::runtime_error("Each item requires a non-empty id");
    }
    std::string relative_path =
        GetOptionalString(env, item_value, "relativePath");
    if (relative_path.empty()) {
      relative_path = GetOptionalString(env, item_value, "name");
    }
    item.relative_path = ValidateRelativePath(relative_path);
    std::wstring folded = ToLower(item.relative_path);
    if (!paths.insert(folded).second) {
      throw std::runtime_error("spec.items contains duplicate relative paths");
    }
    item.is_directory =
        GetOptionalBool(env, item_value, "isDirectory", false);
    item.size =
        GetOptionalUnsignedInteger(env, item_value, "size", static_cast<uint64_t>(0));
    uint64_t mtime =
        GetOptionalUnsignedInteger(env, item_value, "mtimeMs", 0);
    item.modified = mtime == 0 ? CurrentFileTime()
                              : UnixMillisecondsToFileTime(mtime);
    if (!item.is_directory) {
      std::string explicit_url =
          GetOptionalString(env, item_value, "contentUrl");
      item.content_url = BuildContentUrl(spec, item.id, explicit_url);
    }
    spec.items.push_back(std::move(item));
  }

  if (!spec.token.empty()) {
    std::wstring lower_headers = ToLower(spec.extra_headers);
    if (lower_headers.find(L"authorization:") == std::wstring::npos) {
      spec.extra_headers += L"Authorization: Bearer " + spec.token + L"\r\n";
    }
  }
  spec.extra_headers += L"Cache-Control: no-store\r\n";
  return spec;
}

std::string GenerateRequestId() {
  uint64_t sequence = g_request_counter.fetch_add(1);
  std::ostringstream stream;
  stream << "win-" << GetCurrentProcessId() << "-" << GetTickCount64() << "-"
         << sequence;
  return stream.str();
}

void NapiSetString(napi_env env,
                   napi_value object,
                   const char* name,
                   const std::string& value) {
  napi_value js_value;
  napi_create_string_utf8(env, value.c_str(), value.size(), &js_value);
  napi_set_named_property(env, object, name, js_value);
}

void NapiSetBool(napi_env env,
                 napi_value object,
                 const char* name,
                 bool value) {
  napi_value js_value;
  napi_get_boolean(env, value, &js_value);
  napi_set_named_property(env, object, name, js_value);
}

void EventCallJs(napi_env env,
                 napi_value callback,
                 void*,
                 void* raw_payload) {
  std::unique_ptr<EventPayload> payload(
      static_cast<EventPayload*>(raw_payload));
  if (env == nullptr || callback == nullptr || payload == nullptr) {
    return;
  }
  napi_value event;
  napi_create_object(env, &event);
  NapiSetString(env, event, "type", payload->type);
  NapiSetString(env, event, "requestId", payload->request_id);
  if (!payload->message.empty()) {
    NapiSetString(env, event, "message", payload->message);
  }
  if (!payload->drop_effect.empty()) {
    NapiSetString(env, event, "dropEffect", payload->drop_effect);
  }
  if (FAILED(payload->result)) {
    napi_value result;
    napi_create_int64(env, static_cast<int64_t>(payload->result), &result);
    napi_set_named_property(env, event, "hresult", result);
  }
  if (payload->has_position) {
    napi_value screen_x;
    napi_value screen_y;
    napi_create_int32(env, payload->screen_x, &screen_x);
    napi_create_int32(env, payload->screen_y, &screen_y);
    napi_set_named_property(env, event, "screenX", screen_x);
    napi_set_named_property(env, event, "screenY", screen_y);
  }
  napi_value global;
  napi_get_global(env, &global);
  napi_value ignored;
  napi_call_function(env, global, callback, 1, &event, &ignored);
}

struct DragSession : std::enable_shared_from_this<DragSession> {
  explicit DragSession(DragSpec parsed_spec, std::string id)
      : spec(std::move(parsed_spec)), request_id(std::move(id)),
        manifest_state(spec.items.empty() ? ManifestState::kPending
                                          : ManifestState::kReady),
        async_event(CreateEventW(nullptr, TRUE, TRUE, nullptr)) {
    InitializeContentTracking();
  }

  ~DragSession() {
    if (async_event != nullptr) {
      CloseHandle(async_event);
      async_event = nullptr;
    }
  }

  DragSpec spec;
  std::string request_id;
  napi_threadsafe_function event_tsfn = nullptr;
  std::atomic<bool> tsfn_released{false};
  std::atomic<bool> cancelled{false};
  std::atomic<bool> finished{false};
  std::atomic<bool> activated{false};
  std::atomic<bool> prepared{false};
  std::atomic<bool> dragging{false};
  std::atomic<bool> released{false};
  std::atomic<bool> internal_target_active{false};
  std::mutex activation_mutex;
  std::condition_variable activation_cv;
  std::mutex manifest_mutex;
  std::condition_variable manifest_cv;
  ManifestState manifest_state;
  HRESULT manifest_result = S_OK;
  std::string manifest_error;
  std::atomic<bool> async_mode{false};
  std::atomic<bool> async_in_operation{false};
  std::atomic<HRESULT> async_result{S_OK};
  HANDLE async_event = nullptr;
  std::mutex content_mutex;
  std::vector<std::vector<std::pair<uint64_t, uint64_t>>> content_ranges;
  uint64_t content_total_bytes = 0;
  uint64_t content_read_bytes = 0;
  bool content_initialized = false;
  std::atomic<bool> content_started{false};
  std::atomic<bool> content_complete{false};
  std::atomic<bool> content_complete_emitted{false};
  std::atomic<uint32_t> open_streams{0};
  std::thread worker;
  std::thread manifest_worker;
  std::atomic<bool> manifest_worker_done{true};
  std::atomic<ULONGLONG> last_motion_tick{0};
  std::atomic<LONG> last_motion_x{std::numeric_limits<LONG>::min()};
  std::atomic<LONG> last_motion_y{std::numeric_limits<LONG>::min()};

  void Emit(const std::string& type,
            const std::string& message = {},
            const std::string& drop_effect = {},
            HRESULT result = S_OK,
            bool include_cursor = false) {
    if (event_tsfn == nullptr || tsfn_released.load()) {
      return;
    }
    auto* payload = new EventPayload;
    payload->type = type;
    payload->request_id = request_id;
    payload->message = message;
    payload->drop_effect = drop_effect;
    payload->result = result;
    if (include_cursor) {
      POINT point;
      if (GetCursorPos(&point)) {
        payload->screen_x = point.x;
        payload->screen_y = point.y;
        payload->has_position = true;
      }
    }
    napi_status status = napi_call_threadsafe_function(
        event_tsfn, payload, napi_tsfn_nonblocking);
    if (status != napi_ok) {
      delete payload;
    }
  }

  void EmitMotion() {
    POINT point;
    if (!GetCursorPos(&point)) {
      return;
    }
    ULONGLONG now = GetTickCount64();
    ULONGLONG previous_tick = last_motion_tick.load();
    LONG previous_x = last_motion_x.load();
    LONG previous_y = last_motion_y.load();
    if (point.x == previous_x && point.y == previous_y &&
        now - previous_tick < 100) {
      return;
    }
    if (now - previous_tick < 32 ||
        !last_motion_tick.compare_exchange_strong(previous_tick, now)) {
      return;
    }
    last_motion_x.store(point.x);
    last_motion_y.store(point.y);
    if (event_tsfn == nullptr || tsfn_released.load()) {
      return;
    }
    auto* payload = new EventPayload;
    payload->type = "motion";
    payload->request_id = request_id;
    payload->screen_x = point.x;
    payload->screen_y = point.y;
    payload->has_position = true;
    napi_status status = napi_call_threadsafe_function(
        event_tsfn, payload, napi_tsfn_nonblocking);
    if (status != napi_ok) {
      delete payload;
    }
  }

  void ReleaseTsfn(napi_threadsafe_function_release_mode mode) {
    bool expected = false;
    if (event_tsfn != nullptr &&
        tsfn_released.compare_exchange_strong(expected, true)) {
      napi_release_threadsafe_function(event_tsfn, mode);
    }
  }

  void Cancel() {
    // WinHttpOpen is intentionally synchronous. Microsoft documents that a
    // synchronous HINTERNET must not be closed from another thread because it
    // races the active WinHTTP call. The request-owning stack closes its Handle;
    // IStream::Read observes this flag and reports Windows user cancellation.
    cancelled.store(true);
    activation_cv.notify_all();
    manifest_cv.notify_all();
    if (async_event != nullptr) SetEvent(async_event);
  }

  void InitializeContentTracking() {
    std::lock_guard<std::mutex> lock(content_mutex);
    if (content_initialized || spec.items.empty()) return;
    content_ranges.resize(spec.items.size());
    for (const auto& item : spec.items) {
      if (!item.is_directory) {
        content_total_bytes += item.size;
      }
    }
    content_initialized = true;
    if (content_total_bytes == 0) {
      content_complete.store(true);
    }
  }

  void BeginContentStream() {
    open_streams.fetch_add(1);
    if (!content_started.exchange(true)) {
      Emit("consuming");
    }
    MaybeMarkContentComplete();
  }

  void EndContentStream() {
    uint32_t current = open_streams.load();
    while (current > 0 &&
           !open_streams.compare_exchange_weak(current, current - 1)) {
    }
    if (content_complete.load() && async_event != nullptr) {
      SetEvent(async_event);
    }
  }

  static uint64_t AddUniqueContentRange(
      std::vector<std::pair<uint64_t, uint64_t>>& ranges,
      uint64_t start,
      uint64_t end) {
    if (end < start) return 0;
    uint64_t before = 0;
    for (const auto& range : ranges) {
      before += range.second - range.first + 1;
    }
    std::vector<std::pair<uint64_t, uint64_t>> merged;
    merged.reserve(ranges.size() + 1);
    bool inserted = false;
    for (const auto& range : ranges) {
      const bool range_is_before =
          range.second < start && start - range.second > 1;
      if (range_is_before) {
        merged.push_back(range);
        continue;
      }
      const bool range_is_after =
          end < range.first && range.first - end > 1;
      if (range_is_after) {
        if (!inserted) {
          merged.emplace_back(start, end);
          inserted = true;
        }
        merged.push_back(range);
        continue;
      }
      start = std::min(start, range.first);
      end = std::max(end, range.second);
    }
    if (!inserted) merged.emplace_back(start, end);
    ranges.swap(merged);
    uint64_t after = 0;
    for (const auto& range : ranges) {
      after += range.second - range.first + 1;
    }
    return after >= before ? after - before : 0;
  }

  void RecordContentRead(size_t item_index, uint64_t offset, size_t length) {
    if (length == 0) return;
    {
      std::lock_guard<std::mutex> lock(content_mutex);
      if (!content_initialized || item_index >= content_ranges.size()) return;
      const uint64_t max_length = std::numeric_limits<uint64_t>::max() - offset;
      const uint64_t bounded_length =
          std::min<uint64_t>(static_cast<uint64_t>(length), max_length);
      if (bounded_length == 0) return;
      const uint64_t end = offset + bounded_length - 1;
      content_read_bytes +=
          AddUniqueContentRange(content_ranges[item_index], offset, end);
    }
    MaybeMarkContentComplete();
  }

  void MaybeMarkContentComplete() {
    bool complete = false;
    {
      std::lock_guard<std::mutex> lock(content_mutex);
      complete = content_initialized && content_read_bytes >= content_total_bytes;
    }
    if (!complete) return;
    content_complete.store(true);
    if (!content_complete_emitted.exchange(true)) {
      Emit("contentComplete");
    }
    if (async_event != nullptr) SetEvent(async_event);
  }

  void Activate() {
    activated.store(true);
    activation_cv.notify_all();
  }

  void PublishManifest(std::vector<DragItem> items) {
    {
      std::lock_guard<std::mutex> lock(manifest_mutex);
      if (manifest_state != ManifestState::kPending) {
        return;
      }
      spec.items = std::move(items);
      manifest_result = S_OK;
      manifest_error.clear();
      manifest_state = ManifestState::kReady;
    }
    InitializeContentTracking();
    MaybeMarkContentComplete();
    manifest_cv.notify_all();
  }

  void FailManifest(HRESULT result, std::string message) {
    {
      std::lock_guard<std::mutex> lock(manifest_mutex);
      if (manifest_state != ManifestState::kPending) {
        return;
      }
      manifest_result = FAILED(result) ? result : E_FAIL;
      manifest_error = std::move(message);
      manifest_state = ManifestState::kFailed;
    }
    activation_cv.notify_all();
    manifest_cv.notify_all();
  }

  HRESULT WaitForManifest(std::string* error = nullptr) {
    std::unique_lock<std::mutex> lock(manifest_mutex);
    manifest_cv.wait(lock, [&]() {
      return manifest_state != ManifestState::kPending || cancelled.load() ||
             g_shutting_down.load();
    });
    if (manifest_state == ManifestState::kReady) {
      return S_OK;
    }
    if (manifest_state == ManifestState::kFailed) {
      if (error != nullptr) {
        *error = manifest_error;
      }
      return manifest_result;
    }
    if (error != nullptr) {
      *error = "Drag operation was cancelled";
    }
    return E_ABORT;
  }

  bool GetManifestFailure(HRESULT* result = nullptr,
                          std::string* error = nullptr) {
    std::lock_guard<std::mutex> lock(manifest_mutex);
    if (manifest_state != ManifestState::kFailed) {
      return false;
    }
    if (result != nullptr) {
      *result = manifest_result;
    }
    if (error != nullptr) {
      *error = manifest_error;
    }
    return true;
  }

  bool IsManifestPending() {
    std::lock_guard<std::mutex> lock(manifest_mutex);
    return manifest_state == ManifestState::kPending;
  }

  bool RegisterHttpRequest(HINTERNET request) {
    if (request == nullptr) {
      return false;
    }
    return !cancelled.load() && !g_shutting_down.load();
  }
};

class Handle {
 public:
  Handle() = default;
  explicit Handle(HINTERNET handle) : handle_(handle) {}
  ~Handle() { reset(); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : handle_(other.release()) {}
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) {
      reset(other.release());
    }
    return *this;
  }
  HINTERNET get() const { return handle_; }
  explicit operator bool() const { return handle_ != nullptr; }
  HINTERNET release() {
    HINTERNET result = handle_;
    handle_ = nullptr;
    return result;
  }
  void reset(HINTERNET replacement = nullptr) {
    if (handle_ != nullptr) {
      WinHttpCloseHandle(handle_);
    }
    handle_ = replacement;
  }

 private:
  HINTERNET handle_ = nullptr;
};

bool FetchDocument(const std::shared_ptr<DragSession>& session,
                   const std::wstring& url,
                   std::string* output,
                   std::string* error) {
  if (session->cancelled.load()) {
    *error = "Drag operation was cancelled";
    return false;
  }
  URL_COMPONENTS components{};
  components.dwStructSize = sizeof(components);
  components.dwHostNameLength = static_cast<DWORD>(-1);
  components.dwUrlPathLength = static_cast<DWORD>(-1);
  components.dwExtraInfoLength = static_cast<DWORD>(-1);
  if (!WinHttpCrackUrl(url.c_str(), 0, 0, &components)) {
    *error = "Invalid manifest URL";
    return false;
  }
  std::wstring host(components.lpszHostName, components.dwHostNameLength);
  std::wstring object_name;
  if (components.dwUrlPathLength > 0) {
    object_name.assign(components.lpszUrlPath, components.dwUrlPathLength);
  }
  if (components.dwExtraInfoLength > 0) {
    object_name.append(components.lpszExtraInfo,
                       components.dwExtraInfoLength);
  }
  if (object_name.empty()) {
    object_name = L"/";
  }

  Handle internet(WinHttpOpen(
      L"Terma-SFTP-Drag/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY,
      WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
  if (!internet) {
    *error = LastErrorMessage(GetLastError());
    return false;
  }
  WinHttpSetTimeouts(internet.get(), session->spec.timeout_ms,
                     session->spec.timeout_ms, session->spec.timeout_ms,
                     session->spec.timeout_ms);
  Handle connection(
      WinHttpConnect(internet.get(), host.c_str(), components.nPort, 0));
  if (!connection) {
    *error = LastErrorMessage(GetLastError());
    return false;
  }
  DWORD flags =
      components.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
  Handle request(WinHttpOpenRequest(
      connection.get(), L"GET", object_name.c_str(), nullptr,
      WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
  if (!request) {
    *error = LastErrorMessage(GetLastError());
    return false;
  }
  if (!session->RegisterHttpRequest(request.get())) {
    *error = "Drag operation was cancelled";
    return false;
  }
  std::wstring headers =
      session->spec.extra_headers + L"Accept: application/json\r\n";
  if (!WinHttpAddRequestHeaders(
          request.get(), headers.c_str(), static_cast<DWORD>(headers.size()),
          WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE) ||
      !WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                          WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
      !WinHttpReceiveResponse(request.get(), nullptr)) {
    *error = LastErrorMessage(GetLastError());
    return false;
  }
  DWORD status = 0;
  DWORD status_size = sizeof(status);
  if (!WinHttpQueryHeaders(
          request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
          WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size,
          WINHTTP_NO_HEADER_INDEX)) {
    *error = LastErrorMessage(GetLastError());
    return false;
  }
  if (status != 200) {
    *error = "Manifest endpoint returned HTTP " + std::to_string(status);
    return false;
  }

  output->clear();
  while (!session->cancelled.load()) {
    DWORD available = 0;
    if (!WinHttpQueryDataAvailable(request.get(), &available)) {
      *error = LastErrorMessage(GetLastError());
      return false;
    }
    if (available == 0) {
      break;
    }
    if (output->size() + available > kMaxManifestBytes) {
      *error = "Manifest is larger than 16 MiB";
      return false;
    }
    size_t old_size = output->size();
    output->resize(old_size + available);
    DWORD read = 0;
    if (!WinHttpReadData(request.get(), output->data() + old_size, available,
                         &read)) {
      *error = LastErrorMessage(GetLastError());
      return false;
    }
    output->resize(old_size + read);
    if (read == 0) {
      break;
    }
  }
  if (session->cancelled.load()) {
    *error = "Drag operation was cancelled";
    return false;
  }
  return true;
}

std::string JsonScalar(const JsonValue& value, const char* label) {
  if (value.type != JsonValue::Type::kString &&
      value.type != JsonValue::Type::kNumber) {
    throw std::runtime_error(std::string(label) +
                             " must be a string or number");
  }
  return value.scalar;
}

uint64_t ParseManifestInteger(const JsonValue& value, const char* label) {
  std::string text = JsonScalar(value, label);
  if (text.empty() || text.front() == '-') {
    throw std::runtime_error(std::string(label) +
                             " must be a non-negative integer");
  }
  size_t parsed = 0;
  uint64_t result = std::stoull(text, &parsed, 10);
  if (parsed != text.size()) {
    throw std::runtime_error(std::string(label) + " must be an integer");
  }
  return result;
}

bool ParseManifestBool(const JsonValue& value, const char* label) {
  if (value.type != JsonValue::Type::kBool) {
    throw std::runtime_error(std::string(label) + " must be a boolean");
  }
  return value.boolean;
}

FILETIME ParseManifestTime(const JsonValue* value) {
  if (value == nullptr || value->type == JsonValue::Type::kNull) {
    return CurrentFileTime();
  }
  if (value->type == JsonValue::Type::kNumber) {
    uint64_t timestamp = ParseManifestInteger(*value, "modified_at");
    if (timestamp < 100000000000ULL) {
      timestamp *= 1000ULL;
    }
    return UnixMillisecondsToFileTime(timestamp);
  }
  if (value->type != JsonValue::Type::kString) {
    throw std::runtime_error(
        "modified_at must be a Unix timestamp or ISO-8601 string");
  }
  const std::string& text = value->scalar;
  bool decimal = !text.empty() &&
                 std::all_of(text.begin(), text.end(),
                             [](unsigned char ch) { return std::isdigit(ch); });
  if (decimal) {
    uint64_t timestamp = ParseManifestInteger(*value, "modified_at");
    if (timestamp < 100000000000ULL) {
      timestamp *= 1000ULL;
    }
    return UnixMillisecondsToFileTime(timestamp);
  }

  std::wstring wide = Utf8ToWide(text);
  SYSTEMTIME system_time{};
  int parsed = swscanf_s(wide.c_str(), L"%hu-%hu-%huT%hu:%hu:%hu",
                         &system_time.wYear, &system_time.wMonth,
                         &system_time.wDay, &system_time.wHour,
                         &system_time.wMinute, &system_time.wSecond);
  if (parsed != 6) {
    throw std::runtime_error("modified_at contains an invalid ISO-8601 value");
  }
  size_t dot = wide.find(L'.');
  if (dot != std::wstring::npos) {
    uint16_t milliseconds = 0;
    size_t digits = 0;
    for (size_t index = dot + 1;
         index < wide.size() && std::iswdigit(wide[index]) && digits < 3;
         ++index, ++digits) {
      milliseconds =
          static_cast<uint16_t>(milliseconds * 10 + (wide[index] - L'0'));
    }
    while (digits++ < 3) {
      milliseconds = static_cast<uint16_t>(milliseconds * 10);
    }
    system_time.wMilliseconds = milliseconds;
  }
  FILETIME result;
  if (!SystemTimeToFileTime(&system_time, &result)) {
    throw std::runtime_error("modified_at is outside the Windows time range");
  }
  return result;
}

std::vector<DragItem> ParseManifest(const DragSpec& spec,
                                    const std::string& document) {
  JsonValue root = JsonParser(document).Parse();
  const JsonValue* entries = &root;
  if (root.type == JsonValue::Type::kObject) {
    entries = root.Find("entries");
    if (entries == nullptr) {
      entries = root.Find("items");
    }
  }
  if (entries == nullptr || entries->type != JsonValue::Type::kArray ||
      entries->array.empty() || entries->array.size() > kMaxItems) {
    throw std::runtime_error(
        "Manifest entries must contain 1 to 10000 items");
  }

  std::vector<DragItem> parsed_items;
  std::unordered_set<std::wstring> paths;
  parsed_items.reserve(entries->array.size());
  for (const JsonValue& entry : entries->array) {
    if (entry.type != JsonValue::Type::kObject) {
      throw std::runtime_error("Each manifest entry must be an object");
    }
    const JsonValue* index = entry.Find("index");
    if (index == nullptr) {
      index = entry.Find("id");
    }
    const JsonValue* path = entry.Find("relative_path");
    if (path == nullptr) {
      path = entry.Find("relativePath");
    }
    if (path == nullptr) {
      path = entry.Find("name");
    }
    if (index == nullptr || path == nullptr) {
      throw std::runtime_error(
          "Each manifest entry requires index and relative_path");
    }

    DragItem item;
    item.id = JsonScalar(*index, "manifest index");
    if (item.id.empty()) {
      throw std::runtime_error("Manifest index cannot be empty");
    }
    item.relative_path =
        ValidateRelativePath(JsonScalar(*path, "relative_path"));
    if (!paths.insert(ToLower(item.relative_path)).second) {
      throw std::runtime_error(
          "Manifest contains duplicate relative paths");
    }

    const JsonValue* directory = entry.Find("is_directory");
    if (directory == nullptr) {
      directory = entry.Find("isDirectory");
    }
    if (directory != nullptr) {
      item.is_directory =
          ParseManifestBool(*directory, "is_directory");
    } else {
      const JsonValue* type = entry.Find("type");
      if (type != nullptr) {
        std::string type_name = JsonScalar(*type, "type");
        std::transform(type_name.begin(), type_name.end(), type_name.begin(),
                       [](unsigned char ch) {
                         return static_cast<char>(std::tolower(ch));
                       });
        item.is_directory =
            type_name == "directory" || type_name == "dir" ||
            type_name == "folder";
      }
    }

    const JsonValue* size = entry.Find("size");
    item.size = size == nullptr ? 0
                                : ParseManifestInteger(*size, "size");
    const JsonValue* modified = entry.Find("mtimeMs");
    if (modified == nullptr) {
      modified = entry.Find("modified_at");
    }
    if (modified == nullptr) {
      modified = entry.Find("modifiedAt");
    }
    item.modified = ParseManifestTime(modified);

    if (!item.is_directory) {
      const JsonValue* explicit_url = entry.Find("content_url");
      if (explicit_url == nullptr) {
        explicit_url = entry.Find("contentUrl");
      }
      item.content_url = BuildContentUrl(
          spec, item.id,
          explicit_url == nullptr
              ? std::string()
              : JsonScalar(*explicit_url, "content_url"));
    }
    parsed_items.push_back(std::move(item));
  }
  return parsed_items;
}

HRESULT CancelledReadResult(std::string* error) {
  if (error != nullptr) {
    *error = "Drag operation was cancelled";
  }
  return HRESULT_FROM_WIN32(ERROR_CANCELLED);
}

bool IsUserCancellationResult(HRESULT result) {
  return result == DRAGDROP_S_CANCEL
      || result == E_ABORT
      || result == STG_E_REVERTED
      || result == HRESULT_FROM_WIN32(ERROR_CANCELLED)
      || result == HRESULT_FROM_WIN32(ERROR_OPERATION_ABORTED)
      || result == COPYENGINE_S_USER_IGNORED
      || result == COPYENGINE_E_USER_CANCELLED
      || result == COPYENGINE_E_CANCELLED;
}

HRESULT FetchRange(const std::shared_ptr<DragSession>& session,
                   const DragItem& item,
                   uint64_t offset,
                   size_t requested,
                   std::vector<uint8_t>* output,
                   std::string* error) {
  const auto fail = [&](std::string message) -> HRESULT {
    if (session->cancelled.load() || g_shutting_down.load()) {
      return CancelledReadResult(error);
    }
    *error = std::move(message);
    return STG_E_READFAULT;
  };
  if (session->cancelled.load()) {
    return CancelledReadResult(error);
  }
  URL_COMPONENTS components{};
  components.dwStructSize = sizeof(components);
  components.dwHostNameLength = static_cast<DWORD>(-1);
  components.dwUrlPathLength = static_cast<DWORD>(-1);
  components.dwExtraInfoLength = static_cast<DWORD>(-1);
  if (!WinHttpCrackUrl(item.content_url.c_str(), 0, 0, &components)) {
    return fail("Invalid content URL");
  }

  std::wstring host(components.lpszHostName, components.dwHostNameLength);
  std::wstring object_name;
  if (components.dwUrlPathLength > 0) {
    object_name.assign(components.lpszUrlPath, components.dwUrlPathLength);
  }
  if (components.dwExtraInfoLength > 0) {
    object_name.append(components.lpszExtraInfo,
                       components.dwExtraInfoLength);
  }
  if (object_name.empty()) {
    object_name = L"/";
  }

  Handle internet(WinHttpOpen(
      L"Terma-SFTP-Drag/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY,
      WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
  if (!internet) {
    return fail(LastErrorMessage(GetLastError()));
  }
  WinHttpSetTimeouts(internet.get(), session->spec.timeout_ms,
                     session->spec.timeout_ms, session->spec.timeout_ms,
                     session->spec.timeout_ms);
  Handle connection(
      WinHttpConnect(internet.get(), host.c_str(), components.nPort, 0));
  if (!connection) {
    return fail(LastErrorMessage(GetLastError()));
  }
  DWORD flags =
      components.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
  Handle request(WinHttpOpenRequest(
      connection.get(), L"GET", object_name.c_str(), nullptr,
      WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
  if (!request) {
    return fail(LastErrorMessage(GetLastError()));
  }

  uint64_t remaining = item.size > offset ? item.size - offset : 0;
  size_t fetch_length =
      static_cast<size_t>(std::min<uint64_t>(
          remaining, std::max<size_t>(requested, kReadAheadBytes)));
  if (fetch_length == 0) {
    output->clear();
    return session->cancelled.load() ? CancelledReadResult(error) : S_OK;
  }
  if (!session->RegisterHttpRequest(request.get())) {
    return CancelledReadResult(error);
  }
  uint64_t end = offset + fetch_length - 1;
  std::wstring headers = session->spec.extra_headers;
  headers += L"Range: bytes=" + std::to_wstring(offset) + L"-" +
             std::to_wstring(end) + L"\r\n";
  if (!WinHttpAddRequestHeaders(
          request.get(), headers.c_str(), static_cast<DWORD>(headers.size()),
          WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE)) {
    return fail(LastErrorMessage(GetLastError()));
  }
  if (!WinHttpSendRequest(request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                          WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
      !WinHttpReceiveResponse(request.get(), nullptr)) {
    return fail(LastErrorMessage(GetLastError()));
  }
  DWORD status = 0;
  DWORD status_size = sizeof(status);
  if (!WinHttpQueryHeaders(
          request.get(), WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
          WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size,
          WINHTTP_NO_HEADER_INDEX)) {
    return fail(LastErrorMessage(GetLastError()));
  }
  if (status != 206) {
    return fail("Content endpoint returned HTTP " + std::to_string(status));
  }

  DWORD content_range_size = 0;
  SetLastError(ERROR_SUCCESS);
  if (WinHttpQueryHeaders(
          request.get(), WINHTTP_QUERY_CUSTOM, L"Content-Range",
          WINHTTP_NO_OUTPUT_BUFFER, &content_range_size,
          WINHTTP_NO_HEADER_INDEX) ||
      GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
      content_range_size < sizeof(wchar_t)) {
    return fail("Content endpoint did not return a valid Content-Range header");
  }
  std::wstring content_range(
      content_range_size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(
          request.get(), WINHTTP_QUERY_CUSTOM, L"Content-Range",
          content_range.data(), &content_range_size,
          WINHTTP_NO_HEADER_INDEX)) {
    return fail(LastErrorMessage(GetLastError()));
  }
  while (!content_range.empty() &&
         (content_range.back() == L'\0' ||
          std::iswspace(content_range.back()))) {
    content_range.pop_back();
  }
  size_t content_range_start = 0;
  while (content_range_start < content_range.size() &&
         std::iswspace(content_range[content_range_start])) {
    ++content_range_start;
  }
  content_range.erase(0, content_range_start);

  constexpr wchar_t kByteUnit[] = L"bytes ";
  constexpr size_t kByteUnitLength =
      sizeof(kByteUnit) / sizeof(kByteUnit[0]) - 1;
  const size_t dash = content_range.find(L'-', kByteUnitLength);
  const size_t slash = content_range.find(L'/', dash == std::wstring::npos
                                                    ? kByteUnitLength
                                                    : dash + 1);
  auto parse_unsigned = [](const std::wstring& value,
                           uint64_t* parsed) -> bool {
    if (value.empty() || parsed == nullptr ||
        !std::all_of(value.begin(), value.end(), [](wchar_t character) {
          return character >= L'0' && character <= L'9';
        })) {
      return false;
    }
    errno = 0;
    wchar_t* end = nullptr;
    unsigned long long number =
        std::wcstoull(value.c_str(), &end, 10);
    if (errno == ERANGE || end == value.c_str() ||
        end != value.c_str() + value.size()) {
      return false;
    }
    *parsed = static_cast<uint64_t>(number);
    return true;
  };
  uint64_t response_start = 0;
  uint64_t response_end = 0;
  uint64_t response_total = 0;
  if (content_range.size() <= kByteUnitLength ||
      _wcsnicmp(content_range.c_str(), kByteUnit, kByteUnitLength) != 0 ||
      dash == std::wstring::npos || slash == std::wstring::npos ||
      dash <= kByteUnitLength || slash <= dash + 1 ||
      slash + 1 >= content_range.size() ||
      !parse_unsigned(
          content_range.substr(kByteUnitLength,
                               dash - kByteUnitLength),
          &response_start) ||
      !parse_unsigned(
          content_range.substr(dash + 1, slash - dash - 1),
          &response_end) ||
      !parse_unsigned(content_range.substr(slash + 1), &response_total) ||
      response_start != offset || response_end != end ||
      response_total != item.size || response_end < response_start ||
      response_end >= response_total) {
    return fail("Content endpoint returned an unexpected Content-Range");
  }

  output->clear();
  output->reserve(fetch_length);
  while (output->size() < fetch_length && !session->cancelled.load()) {
    DWORD available = 0;
    if (!WinHttpQueryDataAvailable(request.get(), &available)) {
      return fail(LastErrorMessage(GetLastError()));
    }
    if (available == 0) {
      break;
    }
    size_t wanted =
        std::min<size_t>(available, fetch_length - output->size());
    size_t old_size = output->size();
    output->resize(old_size + wanted);
    DWORD read = 0;
    if (!WinHttpReadData(request.get(), output->data() + old_size,
                         static_cast<DWORD>(wanted), &read)) {
      return fail(LastErrorMessage(GetLastError()));
    }
    output->resize(old_size + read);
    if (read == 0) {
      break;
    }
  }
  if (session->cancelled.load()) {
    return CancelledReadResult(error);
  }
  if (output->size() != fetch_length) {
    return fail("Content endpoint returned an incomplete byte range: expected " +
                std::to_string(fetch_length) + " bytes, received " +
                std::to_string(output->size()));
  }
  return S_OK;
}

class RemoteFileStream final : public IStream {
 public:
  RemoteFileStream(std::shared_ptr<DragSession> session, size_t item_index)
      : session_(std::move(session)), item_index_(item_index) {
    if (session_ != nullptr) {
      session_->BeginContentStream();
    }
  }

  STDMETHODIMP QueryInterface(REFIID riid, void** object) override {
    if (object == nullptr) {
      return E_POINTER;
    }
    if (riid == IID_IUnknown || riid == IID_ISequentialStream ||
        riid == IID_IStream) {
      *object = static_cast<IStream*>(this);
      AddRef();
      return S_OK;
    }
    *object = nullptr;
    return E_NOINTERFACE;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++references_; }

  STDMETHODIMP_(ULONG) Release() override {
    ULONG remaining = --references_;
    if (remaining == 0) {
      delete this;
    }
    return remaining;
  }

  STDMETHODIMP Read(void* destination,
                    ULONG count,
                    ULONG* bytes_read) override {
    if (bytes_read != nullptr) {
      *bytes_read = 0;
    }
    if (destination == nullptr && count != 0) {
      return STG_E_INVALIDPOINTER;
    }
    if (session_->cancelled.load() || g_shutting_down.load()) {
      return CancelledReadResult(nullptr);
    }
    const DragItem& item = session_->spec.items[item_index_];
    if (item.is_directory) {
      return STG_E_ACCESSDENIED;
    }
    if (position_ >= item.size || count == 0) {
      return S_FALSE;
    }
    size_t wanted = static_cast<size_t>(
        std::min<uint64_t>(count, item.size - position_));
    uint8_t* output = static_cast<uint8_t*>(destination);
    size_t copied = 0;
    while (copied < wanted) {
      if (session_->cancelled.load() || g_shutting_down.load()) {
        return CancelledReadResult(nullptr);
      }
      if (position_ < cache_offset_ ||
          position_ >= cache_offset_ + cache_.size()) {
        std::string error;
        std::vector<uint8_t> fresh;
        HRESULT fetch_result = FetchRange(
            session_, item, position_, wanted - copied, &fresh, &error);
        if (FAILED(fetch_result)) {
          // ERROR_CANCELLED is an expected user outcome. Reporting it as
          // STG_E_READFAULT makes Explorer show a misleading disk-error dialog.
          if (fetch_result == HRESULT_FROM_WIN32(ERROR_CANCELLED) ||
              session_->cancelled.load() || g_shutting_down.load()) {
            return CancelledReadResult(nullptr);
          }
          session_->Emit("contentError", error, {}, STG_E_READFAULT);
          return STG_E_READFAULT;
        }
        if (session_->cancelled.load() || g_shutting_down.load()) {
          return CancelledReadResult(nullptr);
        }
        cache_offset_ = position_;
        cache_ = std::move(fresh);
        if (cache_.empty()) {
          break;
        }
      }
      size_t cache_position =
          static_cast<size_t>(position_ - cache_offset_);
      size_t available = cache_.size() - cache_position;
      size_t chunk = std::min(available, wanted - copied);
      const uint64_t read_start = position_;
      std::memcpy(output + copied, cache_.data() + cache_position, chunk);
      copied += chunk;
      position_ += chunk;
      session_->RecordContentRead(item_index_, read_start, chunk);
    }
    if (session_->cancelled.load() || g_shutting_down.load()) {
      return CancelledReadResult(nullptr);
    }
    if (bytes_read != nullptr) {
      *bytes_read = static_cast<ULONG>(copied);
    }
    return copied == count ? S_OK : S_FALSE;
  }

  STDMETHODIMP Write(const void*, ULONG, ULONG*) override {
    return STG_E_ACCESSDENIED;
  }

  STDMETHODIMP Seek(LARGE_INTEGER movement,
                    DWORD origin,
                    ULARGE_INTEGER* new_position) override {
    const DragItem& item = session_->spec.items[item_index_];
    uint64_t base = 0;
    switch (origin) {
      case STREAM_SEEK_SET:
        base = 0;
        break;
      case STREAM_SEEK_CUR:
        base = position_;
        break;
      case STREAM_SEEK_END:
        base = item.size;
        break;
      default:
        return STG_E_INVALIDFUNCTION;
    }
    if (movement.QuadPart < 0) {
      uint64_t magnitude =
          static_cast<uint64_t>(-(movement.QuadPart + 1)) + 1;
      if (magnitude > base) {
        return STG_E_INVALIDFUNCTION;
      }
      position_ = base - magnitude;
    } else {
      uint64_t addition = static_cast<uint64_t>(movement.QuadPart);
      if (addition > std::numeric_limits<uint64_t>::max() - base) {
        return STG_E_INVALIDFUNCTION;
      }
      position_ = base + addition;
    }
    if (new_position != nullptr) {
      new_position->QuadPart = position_;
    }
    return S_OK;
  }

  STDMETHODIMP SetSize(ULARGE_INTEGER) override {
    return STG_E_ACCESSDENIED;
  }

  STDMETHODIMP CopyTo(IStream* target,
                      ULARGE_INTEGER count,
                      ULARGE_INTEGER* bytes_read,
                      ULARGE_INTEGER* bytes_written) override {
    if (target == nullptr) {
      return STG_E_INVALIDPOINTER;
    }
    if (bytes_read != nullptr) {
      bytes_read->QuadPart = 0;
    }
    if (bytes_written != nullptr) {
      bytes_written->QuadPart = 0;
    }
    std::vector<uint8_t> buffer(64 * 1024);
    uint64_t remaining = count.QuadPart;
    while (remaining > 0) {
      ULONG wanted =
          static_cast<ULONG>(std::min<uint64_t>(remaining, buffer.size()));
      ULONG read = 0;
      HRESULT read_result = Read(buffer.data(), wanted, &read);
      if (FAILED(read_result)) {
        return read_result;
      }
      if (read == 0) {
        return S_OK;
      }
      ULONG written = 0;
      HRESULT write_result = target->Write(buffer.data(), read, &written);
      if (bytes_read != nullptr) {
        bytes_read->QuadPart += read;
      }
      if (bytes_written != nullptr) {
        bytes_written->QuadPart += written;
      }
      if (FAILED(write_result) || written != read) {
        return FAILED(write_result) ? write_result : STG_E_MEDIUMFULL;
      }
      remaining -= read;
      if (read_result == S_FALSE) {
        return S_OK;
      }
    }
    return S_OK;
  }

  STDMETHODIMP Commit(DWORD) override { return S_OK; }
  STDMETHODIMP Revert() override { return STG_E_REVERTED; }
  STDMETHODIMP LockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override {
    return STG_E_INVALIDFUNCTION;
  }
  STDMETHODIMP UnlockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override {
    return STG_E_INVALIDFUNCTION;
  }

  STDMETHODIMP Stat(STATSTG* stat, DWORD flags) override {
    if (stat == nullptr) {
      return STG_E_INVALIDPOINTER;
    }
    std::memset(stat, 0, sizeof(*stat));
    const DragItem& item = session_->spec.items[item_index_];
    stat->type = STGTY_STREAM;
    stat->cbSize.QuadPart = item.size;
    stat->mtime = item.modified;
    stat->grfMode = STGM_READ;
    if ((flags & STATFLAG_NONAME) == 0) {
      size_t bytes = (item.relative_path.size() + 1) * sizeof(wchar_t);
      stat->pwcsName =
          static_cast<LPWSTR>(CoTaskMemAlloc(bytes));
      if (stat->pwcsName == nullptr) {
        return STG_E_INSUFFICIENTMEMORY;
      }
      std::memcpy(stat->pwcsName, item.relative_path.c_str(), bytes);
    }
    return S_OK;
  }

  STDMETHODIMP Clone(IStream** stream) override {
    if (stream == nullptr) {
      return E_POINTER;
    }
    auto* clone = new (std::nothrow) RemoteFileStream(session_, item_index_);
    if (clone == nullptr) {
      return E_OUTOFMEMORY;
    }
    clone->position_ = position_;
    clone->cache_offset_ = cache_offset_;
    clone->cache_ = cache_;
    *stream = clone;
    return S_OK;
  }

 private:
  ~RemoteFileStream() {
    if (session_ != nullptr) {
      session_->EndContentStream();
    }
  }

  std::atomic<ULONG> references_{1};
  std::shared_ptr<DragSession> session_;
  size_t item_index_;
  uint64_t position_ = 0;
  uint64_t cache_offset_ = 0;
  std::vector<uint8_t> cache_;
};

class FormatEnumerator final : public IEnumFORMATETC {
 public:
  explicit FormatEnumerator(std::vector<FORMATETC> formats)
      : formats_(std::move(formats)) {}

  STDMETHODIMP QueryInterface(REFIID riid, void** object) override {
    if (object == nullptr) {
      return E_POINTER;
    }
    if (riid == IID_IUnknown || riid == IID_IEnumFORMATETC) {
      *object = static_cast<IEnumFORMATETC*>(this);
      AddRef();
      return S_OK;
    }
    *object = nullptr;
    return E_NOINTERFACE;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++references_; }

  STDMETHODIMP_(ULONG) Release() override {
    ULONG remaining = --references_;
    if (remaining == 0) {
      delete this;
    }
    return remaining;
  }

  STDMETHODIMP Next(ULONG count,
                    FORMATETC* output,
                    ULONG* fetched) override {
    if (output == nullptr || (count != 1 && fetched == nullptr)) {
      return E_POINTER;
    }
    ULONG copied = 0;
    while (copied < count && position_ < formats_.size()) {
      output[copied] = formats_[position_];
      output[copied].ptd = nullptr;
      ++copied;
      ++position_;
    }
    if (fetched != nullptr) {
      *fetched = copied;
    }
    return copied == count ? S_OK : S_FALSE;
  }

  STDMETHODIMP Skip(ULONG count) override {
    size_t remaining = formats_.size() - position_;
    size_t skipped = std::min<size_t>(count, remaining);
    position_ += skipped;
    return skipped == count ? S_OK : S_FALSE;
  }

  STDMETHODIMP Reset() override {
    position_ = 0;
    return S_OK;
  }

  STDMETHODIMP Clone(IEnumFORMATETC** output) override {
    if (output == nullptr) {
      return E_POINTER;
    }
    auto* clone = new (std::nothrow) FormatEnumerator(formats_);
    if (clone == nullptr) {
      return E_OUTOFMEMORY;
    }
    clone->position_ = position_;
    *output = clone;
    return S_OK;
  }

 private:
  ~FormatEnumerator() = default;
  std::atomic<ULONG> references_{1};
  std::vector<FORMATETC> formats_;
  size_t position_ = 0;
};

class VirtualFileDataObject final : public IDataObject,
                                    public IDataObjectAsyncCapability {
 public:
  explicit VirtualFileDataObject(std::shared_ptr<DragSession> session)
      : session_(std::move(session)) {
    descriptor_format_ = RegisterClipboardFormatW(CFSTR_FILEDESCRIPTORW);
    contents_format_ = RegisterClipboardFormatW(CFSTR_FILECONTENTS);
    preferred_effect_format_ =
        RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT);
    performed_effect_format_ =
        RegisterClipboardFormatW(CFSTR_PERFORMEDDROPEFFECT);
  }

  STDMETHODIMP QueryInterface(REFIID riid, void** object) override {
    if (object == nullptr) {
      return E_POINTER;
    }
    if (riid == IID_IUnknown || riid == IID_IDataObject) {
      *object = static_cast<IDataObject*>(this);
    } else if (riid == IID_IDataObjectAsyncCapability) {
      *object = static_cast<IDataObjectAsyncCapability*>(this);
    } else {
      *object = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++references_; }

  STDMETHODIMP_(ULONG) Release() override {
    ULONG remaining = --references_;
    if (remaining == 0) {
      delete this;
    }
    return remaining;
  }

  STDMETHODIMP GetData(FORMATETC* format, STGMEDIUM* medium) override {
    if (format == nullptr || medium == nullptr) {
      return E_POINTER;
    }
    std::memset(medium, 0, sizeof(*medium));
    if (format->cfFormat == descriptor_format_ &&
        (format->tymed & TYMED_HGLOBAL) != 0) {
      return GetDescriptors(medium);
    }
    if (format->cfFormat == contents_format_ &&
        (format->tymed & TYMED_ISTREAM) != 0) {
      HRESULT manifest_result = ResolveManifestForDataRequest();
      if (FAILED(manifest_result)) {
        return manifest_result;
      }
      if (format->lindex < 0 ||
          static_cast<size_t>(format->lindex) >= session_->spec.items.size()) {
        return DV_E_LINDEX;
      }
      const DragItem& item = session_->spec.items[format->lindex];
      if (item.is_directory) {
        return DV_E_FORMATETC;
      }
      auto* stream = new (std::nothrow)
          RemoteFileStream(session_, static_cast<size_t>(format->lindex));
      if (stream == nullptr) {
        return E_OUTOFMEMORY;
      }
      medium->tymed = TYMED_ISTREAM;
      medium->pstm = stream;
      medium->pUnkForRelease = nullptr;
      return S_OK;
    }
    if (format->cfFormat == preferred_effect_format_ &&
        (format->tymed & TYMED_HGLOBAL) != 0) {
      HGLOBAL global =
          GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, sizeof(DWORD));
      if (global == nullptr) {
        return E_OUTOFMEMORY;
      }
      auto* effect = static_cast<DWORD*>(GlobalLock(global));
      if (effect == nullptr) {
        GlobalFree(global);
        return E_OUTOFMEMORY;
      }
      *effect = DROPEFFECT_COPY;
      GlobalUnlock(global);
      medium->tymed = TYMED_HGLOBAL;
      medium->hGlobal = global;
      return S_OK;
    }
    return DV_E_FORMATETC;
  }

  STDMETHODIMP GetDataHere(FORMATETC*, STGMEDIUM*) override {
    return DATA_E_FORMATETC;
  }

  STDMETHODIMP QueryGetData(FORMATETC* format) override {
    if (format == nullptr) {
      return E_POINTER;
    }
    if (format->dwAspect != DVASPECT_CONTENT) {
      return DV_E_DVASPECT;
    }
    if (format->cfFormat == descriptor_format_) {
      return (format->tymed & TYMED_HGLOBAL) != 0 ? S_OK : DV_E_TYMED;
    }
    if (format->cfFormat == contents_format_) {
      if ((format->tymed & TYMED_ISTREAM) == 0) {
        return DV_E_TYMED;
      }
      // A generic availability probe uses lindex -1 before Explorer has
      // requested FILEGROUPDESCRIPTOR. The concrete index is validated after
      // the lazily loaded manifest becomes available.
      if (format->lindex == -1) {
        return S_OK;
      }
      // QueryGetData is an availability probe and must never hold the OLE
      // pointer loop while a remote directory is still being enumerated.
      if (session_->IsManifestPending()) {
        return S_OK;
      }
      HRESULT manifest_result = session_->WaitForManifest();
      if (FAILED(manifest_result)) {
        return manifest_result;
      }
      if (format->lindex < 0 ||
          static_cast<size_t>(format->lindex) >= session_->spec.items.size()) {
        return DV_E_LINDEX;
      }
      return session_->spec.items[format->lindex].is_directory
                 ? DV_E_FORMATETC
                 : S_OK;
    }
    if (format->cfFormat == preferred_effect_format_) {
      return (format->tymed & TYMED_HGLOBAL) != 0 ? S_OK : DV_E_TYMED;
    }
    return DV_E_FORMATETC;
  }

  STDMETHODIMP GetCanonicalFormatEtc(FORMATETC*, FORMATETC* output) override {
    if (output != nullptr) {
      output->ptd = nullptr;
    }
    return E_NOTIMPL;
  }

  STDMETHODIMP SetData(FORMATETC* format,
                       STGMEDIUM* medium,
                       BOOL release) override {
    if (format != nullptr && medium != nullptr &&
        format->cfFormat == performed_effect_format_ &&
        medium->tymed == TYMED_HGLOBAL && medium->hGlobal != nullptr) {
      auto* effect = static_cast<DWORD*>(GlobalLock(medium->hGlobal));
      if (effect != nullptr) {
        performed_effect_.store(*effect);
        performed_effect_set_.store(true);
        GlobalUnlock(medium->hGlobal);
      }
      if (release) {
        ReleaseStgMedium(medium);
      }
      // Explorer may publish the performed effect without calling
      // EndOperation on a few shell/code paths. Wake the worker so it can
      // apply the bounded completion handshake instead of remaining at 99%.
      if (session_->async_event != nullptr) SetEvent(session_->async_event);
      return S_OK;
    }
    return E_NOTIMPL;
  }

  STDMETHODIMP EnumFormatEtc(DWORD direction,
                            IEnumFORMATETC** enumerator) override {
    if (enumerator == nullptr) {
      return E_POINTER;
    }
    if (direction != DATADIR_GET) {
      return E_NOTIMPL;
    }
    std::vector<FORMATETC> formats = {
        {descriptor_format_, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL},
        {contents_format_, nullptr, DVASPECT_CONTENT, -1, TYMED_ISTREAM},
        {preferred_effect_format_, nullptr, DVASPECT_CONTENT, -1,
         TYMED_HGLOBAL},
    };
    auto* result = new (std::nothrow) FormatEnumerator(std::move(formats));
    if (result == nullptr) {
      return E_OUTOFMEMORY;
    }
    *enumerator = result;
    return S_OK;
  }

  STDMETHODIMP DAdvise(FORMATETC*,
                       DWORD,
                       IAdviseSink*,
                       DWORD*) override {
    return OLE_E_ADVISENOTSUPPORTED;
  }
  STDMETHODIMP DUnadvise(DWORD) override {
    return OLE_E_ADVISENOTSUPPORTED;
  }
  STDMETHODIMP EnumDAdvise(IEnumSTATDATA**) override {
    return OLE_E_ADVISENOTSUPPORTED;
  }

  STDMETHODIMP SetAsyncMode(BOOL asynchronous) override {
    session_->async_mode.store(asynchronous != FALSE);
    return S_OK;
  }

  STDMETHODIMP GetAsyncMode(BOOL* asynchronous) override {
    if (asynchronous == nullptr) {
      return E_POINTER;
    }
    *asynchronous = session_->async_mode.load() ? TRUE : FALSE;
    return S_OK;
  }

  STDMETHODIMP StartOperation(IBindCtx*) override {
    session_->async_result.store(S_OK);
    session_->async_in_operation.store(true);
    if (session_->async_event != nullptr) ResetEvent(session_->async_event);
    return S_OK;
  }

  STDMETHODIMP InOperation(BOOL* operation) override {
    if (operation == nullptr) {
      return E_POINTER;
    }
    *operation = session_->async_in_operation.load() ? TRUE : FALSE;
    return S_OK;
  }

  STDMETHODIMP EndOperation(HRESULT result,
                            IBindCtx*,
                            DWORD effects) override {
    session_->async_result.store(result);
    performed_effect_.store(effects);
    performed_effect_set_.store(true);
    session_->async_in_operation.store(false);
    if (session_->async_event != nullptr) SetEvent(session_->async_event);
    return S_OK;
  }

  DWORD performed_effect() const { return performed_effect_.load(); }
  bool has_performed_effect() const { return performed_effect_set_.load(); }

 private:
  ~VirtualFileDataObject() = default;

  bool IsCursorOverSourceWindow() const {
    HWND source_window = session_->spec.source_window;
    if (source_window == nullptr || !IsWindow(source_window)) {
      return false;
    }
    POINT cursor{};
    if (!GetCursorPos(&cursor)) {
      return false;
    }
    HWND target_window = WindowFromPoint(cursor);
    if (target_window == nullptr) {
      return false;
    }
    HWND source_root = GetAncestor(source_window, GA_ROOT);
    HWND target_root = GetAncestor(target_window, GA_ROOT);
    return source_root != nullptr && source_root == target_root;
  }

  HRESULT ResolveManifestForDataRequest() {
    if (session_->IsManifestPending()) {
      // Chromium probes the OLE data object while the pointer is still over
      // Terma. Waiting here keeps the hidden drag window's mouse capture
      // alive and makes the application appear frozen for large directories.
      // Explorer's asynchronous extraction retries after StartOperation.
      if ((!session_->released.load() && IsCursorOverSourceWindow()) ||
          !session_->async_in_operation.load()) {
        return E_PENDING;
      }
    }
    return session_->WaitForManifest();
  }

  HRESULT GetDescriptors(STGMEDIUM* medium) {
    HRESULT manifest_result = ResolveManifestForDataRequest();
    if (FAILED(manifest_result)) {
      return manifest_result;
    }
    size_t count = session_->spec.items.size();
    size_t bytes = sizeof(FILEGROUPDESCRIPTORW);
    if (count > 1) {
      bytes += (count - 1) * sizeof(FILEDESCRIPTORW);
    }
    HGLOBAL global = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes);
    if (global == nullptr) {
      return E_OUTOFMEMORY;
    }
    auto* group = static_cast<FILEGROUPDESCRIPTORW*>(GlobalLock(global));
    if (group == nullptr) {
      GlobalFree(global);
      return E_OUTOFMEMORY;
    }
    group->cItems = static_cast<UINT>(count);
    for (size_t index = 0; index < count; ++index) {
      const DragItem& item = session_->spec.items[index];
      FILEDESCRIPTORW& descriptor = group->fgd[index];
      descriptor.dwFlags = FD_ATTRIBUTES | FD_WRITESTIME;
      descriptor.dwFileAttributes =
          item.is_directory ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
      descriptor.ftLastWriteTime = item.modified;
      if (!item.is_directory) {
        descriptor.dwFlags |= FD_FILESIZE;
        ULARGE_INTEGER size;
        size.QuadPart = item.size;
        descriptor.nFileSizeHigh = size.HighPart;
        descriptor.nFileSizeLow = size.LowPart;
      }
      std::wmemcpy(descriptor.cFileName, item.relative_path.c_str(),
                   item.relative_path.size());
      descriptor.cFileName[item.relative_path.size()] = L'\0';
    }
    GlobalUnlock(global);
    medium->tymed = TYMED_HGLOBAL;
    medium->hGlobal = global;
    medium->pUnkForRelease = nullptr;
    return S_OK;
  }

  std::atomic<ULONG> references_{1};
  std::shared_ptr<DragSession> session_;
  CLIPFORMAT descriptor_format_ = 0;
  CLIPFORMAT contents_format_ = 0;
  CLIPFORMAT preferred_effect_format_ = 0;
  CLIPFORMAT performed_effect_format_ = 0;
  std::atomic<DWORD> performed_effect_{DROPEFFECT_NONE};
  std::atomic<bool> performed_effect_set_{false};
};

class DragSource final : public IDropSource {
 public:
  explicit DragSource(std::shared_ptr<DragSession> session)
      : session_(std::move(session)) {}

  STDMETHODIMP QueryInterface(REFIID riid, void** object) override {
    if (object == nullptr) {
      return E_POINTER;
    }
    if (riid == IID_IUnknown || riid == IID_IDropSource) {
      *object = static_cast<IDropSource*>(this);
      AddRef();
      return S_OK;
    }
    *object = nullptr;
    return E_NOINTERFACE;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++references_; }

  STDMETHODIMP_(ULONG) Release() override {
    ULONG remaining = --references_;
    if (remaining == 0) {
      delete this;
    }
    return remaining;
  }

  STDMETHODIMP QueryContinueDrag(BOOL escape_pressed,
                                 DWORD key_state) override {
    session_->EmitMotion();
    if (escape_pressed || session_->cancelled.load()) {
      return DRAGDROP_S_CANCEL;
    }
    if (session_->GetManifestFailure()) {
      return DRAGDROP_S_CANCEL;
    }
    if ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) == 0 ||
        (key_state & MK_LBUTTON) == 0) {
      return session_->internal_target_active.load() ||
                     IsCursorOverSourceWindow()
                 ? DRAGDROP_S_CANCEL
                 : DRAGDROP_S_DROP;
    }
    return S_OK;
  }

  STDMETHODIMP GiveFeedback(DWORD) override {
    session_->EmitMotion();
    return DRAGDROP_S_USEDEFAULTCURSORS;
  }

 private:
  bool IsCursorOverSourceWindow() const {
    HWND source_window = session_->spec.source_window;
    if (source_window == nullptr || !IsWindow(source_window)) {
      return false;
    }
    POINT cursor{};
    if (!GetCursorPos(&cursor)) {
      return false;
    }
    HWND target_window = WindowFromPoint(cursor);
    if (target_window == nullptr) {
      return false;
    }
    HWND source_root = GetAncestor(source_window, GA_ROOT);
    HWND target_root = GetAncestor(target_window, GA_ROOT);
    return source_root != nullptr && source_root == target_root;
  }

  ~DragSource() = default;
  std::atomic<ULONG> references_{1};
  std::shared_ptr<DragSession> session_;
};

class ScopedThreadInputAttachment {
 public:
  explicit ScopedThreadInputAttachment(HWND window) {
    if (window == nullptr) return;
    source_thread_ = GetWindowThreadProcessId(window, nullptr);
    current_thread_ = GetCurrentThreadId();
    if (source_thread_ != 0 && source_thread_ != current_thread_) {
      attached_ = AttachThreadInput(current_thread_, source_thread_, TRUE) != FALSE;
    }
  }

  ~ScopedThreadInputAttachment() { Detach(); }

  void Detach() {
    if (attached_) {
      AttachThreadInput(current_thread_, source_thread_, FALSE);
      attached_ = false;
    }
  }

  ScopedThreadInputAttachment(const ScopedThreadInputAttachment&) = delete;
  ScopedThreadInputAttachment& operator=(const ScopedThreadInputAttachment&) = delete;

 private:
  DWORD source_thread_ = 0;
  DWORD current_thread_ = 0;
  bool attached_ = false;
};

void PrepareManifest(const std::shared_ptr<DragSession>& session) {
  std::string document;
  std::string error;
  if (!FetchDocument(session, session->spec.manifest_url, &document, &error)) {
    session->FailManifest(session->cancelled.load() ? E_ABORT : E_FAIL,
                          std::move(error));
    return;
  }
  try {
    session->PublishManifest(ParseManifest(session->spec, document));
  } catch (const std::exception& exception) {
    session->FailManifest(
        E_INVALIDARG,
        std::string("Invalid drag manifest: ") + exception.what());
  }
}

void StartManifestWorker(const std::shared_ptr<DragSession>& session) {
  if (!session->spec.items.empty()) {
    return;
  }
  session->Emit("preparing");
  session->manifest_worker_done.store(false);
  try {
    session->manifest_worker = std::thread([session]() {
      try {
        PrepareManifest(session);
      } catch (const std::exception& exception) {
        session->FailManifest(
            E_FAIL,
            std::string("Unable to prepare drag manifest: ") +
                exception.what());
      } catch (...) {
        session->FailManifest(E_FAIL, "Unable to prepare drag manifest");
      }
      session->manifest_worker_done.store(true);
    });
  } catch (const std::exception& exception) {
    session->manifest_worker_done.store(true);
    session->FailManifest(
        E_FAIL,
        std::string("Unable to start drag manifest worker: ") +
            exception.what());
  } catch (...) {
    session->manifest_worker_done.store(true);
    session->FailManifest(E_FAIL,
                          "Unable to start drag manifest worker");
  }
}

bool ArmDrag(const std::shared_ptr<DragSession>& session) {
  session->prepared.store(true);
  session->Emit("ready");
  if (session->spec.wait_for_activation && !session->activated.load()) {
    std::unique_lock<std::mutex> lock(session->activation_mutex);
    const bool signalled = session->activation_cv.wait_for(
        lock, std::chrono::milliseconds(session->spec.arm_timeout_ms), [&]() {
          return session->activated.load() || session->cancelled.load() ||
                 g_shutting_down.load();
        });
    if (session->cancelled.load() || g_shutting_down.load()) {
      session->Emit("cancelled", "Drag preparation was cancelled", "none",
                    DRAGDROP_S_CANCEL, true);
      session->finished.store(true);
      session->ReleaseTsfn(napi_tsfn_release);
      return false;
    }
    if (!signalled || !session->activated.load()) {
      session->Emit("cancelled", "Drag preparation was cancelled", "none",
                    DRAGDROP_S_CANCEL, true);
      session->finished.store(true);
      session->ReleaseTsfn(napi_tsfn_release);
      return false;
    }
  }
  return true;
}

bool RunDragOnWorkerThread(const std::shared_ptr<DragSession>& session) {
  if (session == nullptr || session->finished.load()) {
    return false;
  }
  if (!session->prepared.load() || session->cancelled.load() ||
      g_shutting_down.load()) {
    if (!session->finished.exchange(true)) {
      session->Emit("cancelled", {}, "none", DRAGDROP_S_CANCEL, true);
      session->ReleaseTsfn(napi_tsfn_release);
    }
    return false;
  }
  HRESULT manifest_result = S_OK;
  std::string manifest_error;
  if (session->GetManifestFailure(&manifest_result, &manifest_error)) {
    session->Emit("error", manifest_error, {}, manifest_result, true);
    session->finished.store(true);
    session->ReleaseTsfn(napi_tsfn_release);
    return false;
  }
  // Direct manifests and lazily loaded manifests can contain only directories
  // or zero-byte files. Mark those sessions complete before Explorer starts
  // probing FILECONTENTS so the lifecycle does not wait forever for a read.
  session->InitializeContentTracking();
  session->MaybeMarkContentComplete();
  bool expected = false;
  if (!session->dragging.compare_exchange_strong(expected, true)) {
    return false;
  }

  HRESULT ole_result = OleInitialize(nullptr);
  if (FAILED(ole_result)) {
    session->Emit("error", "OleInitialize failed", {}, ole_result);
    session->finished.store(true);
    session->ReleaseTsfn(napi_tsfn_release);
    return false;
  }

  MSG message;
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  ScopedThreadInputAttachment input_attachment(session->spec.source_window);
  HWND drag_window = CreateWindowExW(
      WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, L"STATIC",
      L"Terma SFTP virtual drag", WS_POPUP, -32000, -32000, 1, 1,
      nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (drag_window == nullptr) {
    OleUninitialize();
    session->Emit("error", "Unable to create the Windows drag input window",
                  {}, HRESULT_FROM_WIN32(GetLastError()));
    session->finished.store(true);
    session->ReleaseTsfn(napi_tsfn_release);
    return false;
  }

  auto* data_object = new (std::nothrow) VirtualFileDataObject(session);
  auto* drag_source = new (std::nothrow) DragSource(session);
  if (data_object == nullptr || drag_source == nullptr) {
    if (data_object != nullptr) {
      data_object->Release();
    }
    if (drag_source != nullptr) {
      drag_source->Release();
    }
    DestroyWindow(drag_window);
    OleUninitialize();
    session->Emit("error", "Unable to allocate the Windows drag provider", {},
                  E_OUTOFMEMORY);
    session->finished.store(true);
    session->ReleaseTsfn(napi_tsfn_release);
    return false;
  }

  if ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) == 0) {
    session->Cancel();
    data_object->Release();
    drag_source->Release();
    DestroyWindow(drag_window);
    OleUninitialize();
    session->Emit("cancelled", {}, "none", DRAGDROP_S_CANCEL, true);
    session->finished.store(true);
    session->ReleaseTsfn(napi_tsfn_release);
    return false;
  }

  SetCapture(drag_window);
  if (GetCapture() != drag_window) {
    data_object->Release();
    drag_source->Release();
    DestroyWindow(drag_window);
    OleUninitialize();
    session->Emit("error", "Unable to capture the active pointer gesture",
                  {}, HRESULT_FROM_WIN32(GetLastError()));
    session->finished.store(true);
    session->ReleaseTsfn(napi_tsfn_release);
    return false;
  }

  // Advertise delayed extraction before entering OLE drag/drop. Explorer then
  // releases the pointer gesture immediately and consumes the remote streams
  // in its copy operation while Terma's main thread stays responsive.
  data_object->SetAsyncMode(TRUE);
  session->Emit("started", {}, {}, S_OK, true);
  DWORD effect = DROPEFFECT_NONE;
  HRESULT drag_result = SHDoDragDrop(drag_window, data_object, drag_source,
                                     DROPEFFECT_COPY, &effect);
  if (drag_result == DRAGDROP_S_CANCEL &&
      !session->GetManifestFailure()) {
    session->Cancel();
  }
  if (GetCapture() == drag_window) {
    ReleaseCapture();
  }
  input_attachment.Detach();
  session->released.store(true);
  session->Emit("released", {},
                (effect & DROPEFFECT_COPY) != 0 ? "copy" : "none",
                drag_result, true);

  bool async_completion_fallback = false;
  bool async_completion_timed_out = false;
  ULONGLONG content_complete_since = 0;
  while (session->async_mode.load() &&
         session->async_in_operation.load() &&
         !session->cancelled.load() && !g_shutting_down.load()) {
    DWORD event_index = 0;
    HRESULT wait_result = CoWaitForMultipleHandles(
        COWAIT_DISPATCH_CALLS | COWAIT_DISPATCH_WINDOW_MESSAGES,
        250, 1, &session->async_event, &event_index);
    if (wait_result != S_OK && wait_result != RPC_S_CALLPENDING) {
      session->Cancel();
      break;
    }
    if (!session->async_in_operation.load()) break;

    // The copy engine normally calls EndOperation. Some Explorer builds
    // finish reading the IStreams and publish DROPEFFECT_COPY but omit that
    // callback. A short grace period is safe only after both signals exist.
    const ULONGLONG now = GetTickCount64();
    if (session->content_complete.load() && content_complete_since == 0) {
      content_complete_since = now;
    }
    if (content_complete_since != 0 && data_object->has_performed_effect()
        && (data_object->performed_effect() & DROPEFFECT_COPY) != 0) {
      if (now - content_complete_since >= kAsyncCompletionGraceMs) {
        async_completion_fallback = true;
        session->async_in_operation.store(false);
        break;
      }
    }
    if (content_complete_since != 0
        && now - content_complete_since >= kAsyncCompletionTimeoutMs) {
      // Content being fully read is not enough to claim success. If Explorer
      // never confirms a copy effect, surface a terminal error instead.
      async_completion_timed_out = true;
      session->async_result.store(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
      session->async_in_operation.store(false);
      break;
    }
    if (session->async_event != nullptr) ResetEvent(session->async_event);
  }
  const bool has_performed_effect = data_object->has_performed_effect();
  DWORD performed = data_object->performed_effect();
  if (has_performed_effect) {
    effect = performed;
  }
  HRESULT async_result = session->async_result.load();
  manifest_result = S_OK;
  manifest_error.clear();
  const bool manifest_failed =
      session->GetManifestFailure(&manifest_result, &manifest_error);
  // Explorer reports an explicit conflict-dialog cancel through
  // IDataObjectAsyncCapability::EndOperation. Depending on the Windows
  // version this is either a Copy Engine cancellation HRESULT or a successful
  // operation with no performed effect. Both mean that the user chose not to
  // copy anything and must not surface as a background-copy error.
  const bool user_cancelled =
      IsUserCancellationResult(async_result)
      || (has_performed_effect && SUCCEEDED(async_result)
          && effect == DROPEFFECT_NONE);

  data_object->Release();
  drag_source->Release();
  DestroyWindow(drag_window);
  OleUninitialize();

  if (session->cancelled.load() || user_cancelled) {
    session->Cancel();
    session->Emit("cancelled", {}, "none", drag_result, true);
  } else if (manifest_failed) {
    session->Emit("error", manifest_error, {}, manifest_result, true);
  } else if (async_completion_timed_out) {
    session->Emit("error",
                  "Windows background file copy did not confirm completion",
                  {}, HRESULT_FROM_WIN32(ERROR_TIMEOUT), true);
  } else if (drag_result == DRAGDROP_S_CANCEL) {
    session->Emit("cancelled", {}, "none", drag_result, true);
  } else if (FAILED(drag_result)) {
    session->Emit("error", "Windows drag-and-drop failed", {}, drag_result,
                  true);
  } else if (FAILED(async_result)) {
    session->Emit("error", "Windows background file copy failed", {},
                  async_result, true);
  } else if (async_completion_fallback || !session->async_mode.load()
             || !session->async_in_operation.load()) {
    session->Emit("completed", {},
                  (effect & DROPEFFECT_COPY) != 0 ? "copy" : "none",
                  drag_result, true);
  } else {
    session->Emit("error", "Windows background file copy did not finish", {},
                  HRESULT_FROM_WIN32(ERROR_TIMEOUT), true);
  }
  session->finished.store(true);
  session->ReleaseTsfn(napi_tsfn_release);
  return true;
}

void ReapFinishedSessions() {
  std::vector<std::shared_ptr<DragSession>> finished;
  {
    std::lock_guard<std::mutex> lock(g_sessions_mutex);
    for (auto iterator = g_sessions.begin(); iterator != g_sessions.end();) {
      if (iterator->second->finished.load() &&
          iterator->second->manifest_worker_done.load()) {
        finished.push_back(iterator->second);
        iterator = g_sessions.erase(iterator);
      } else {
        ++iterator;
      }
    }
  }
  for (const auto& session : finished) {
    if (session->worker.joinable()) {
      session->worker.join();
    }
    if (session->manifest_worker.joinable()) {
      session->manifest_worker.join();
    }
  }
}

void Cleanup(void*) {
  g_shutting_down.store(true);
  StopX11WindowGuardWorker();
  std::vector<std::shared_ptr<DragSession>> sessions;
  {
    std::lock_guard<std::mutex> lock(g_sessions_mutex);
    for (const auto& pair : g_sessions) {
      sessions.push_back(pair.second);
    }
    g_sessions.clear();
  }
  for (const auto& session : sessions) {
    session->Cancel();
    session->ReleaseTsfn(napi_tsfn_abort);
  }
  for (const auto& session : sessions) {
    if (session->worker.joinable()) {
      session->worker.join();
    }
    if (session->manifest_worker.joinable()) {
      session->manifest_worker.join();
    }
  }
}

napi_value Probe(napi_env env, napi_callback_info) {
  ReapFinishedSessions();
  napi_value result;
  napi_create_object(env, &result);
  NapiSetBool(env, result, "available", !g_shutting_down.load());
  NapiSetBool(env, result, "supported", !g_shutting_down.load());
  NapiSetString(env, result, "platform", "win32");
  napi_value version;
  napi_create_uint32(env, kApiVersion, &version);
  napi_set_named_property(env, result, "apiVersion", version);
  NapiSetBool(env, result, "delayed", true);
  NapiSetString(env, result, "protocol",
                "CFSTR_FILEDESCRIPTORW/CFSTR_FILECONTENTS");
  NapiSetString(env, result, "mode", "virtual-file-stream");
  NapiSetBool(env, result, "oneGesture", true);
  NapiSetBool(env, result, "delayedContent", true);
  NapiSetBool(env, result, "multipleItems", true);
  NapiSetBool(env, result, "directories", true);
  return result;
}

napi_value StartX11WindowGuard(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &argument_count, &argument, nullptr, nullptr);
  double process_id_value = 0;
  if (argument_count < 1 ||
      napi_get_value_double(env, argument, &process_id_value) != napi_ok ||
      !std::isfinite(process_id_value) || process_id_value < 1 ||
      process_id_value > std::numeric_limits<uint32_t>::max() ||
      std::floor(process_id_value) != process_id_value) {
    napi_throw_type_error(env, nullptr,
                          "startX11WindowGuard requires a positive process ID");
    return nullptr;
  }
  const DWORD process_id = static_cast<DWORD>(process_id_value);
  try {
    napi_value result;
    napi_get_boolean(env, StartX11WindowGuardWorker(process_id), &result);
    return result;
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value StopX11WindowGuard(napi_env env, napi_callback_info) {
  napi_value result;
  napi_get_boolean(env, StopX11WindowGuardWorker(), &result);
  return result;
}

napi_value GetX11WindowGuardDiagnostics(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  NapiSetBool(env, result, "running", g_x11_window_guard_process_id.load() != 0);
  NapiSetBool(env, result, "hookInstalled",
              g_x11_window_guard_hook_installed.load());
  napi_value hook_error;
  napi_create_uint32(env, g_x11_window_guard_hook_error.load(), &hook_error);
  napi_set_named_property(env, result, "hookError", hook_error);
  napi_value process_id_value;
  napi_create_uint32(env, g_x11_window_guard_process_id.load(),
                     &process_id_value);
  napi_set_named_property(env, result, "processId", process_id_value);
  const uintptr_t last_window_value = g_x11_window_guard_last_window.load();
  NapiSetString(env, result, "lastWindow",
                std::to_string(static_cast<uint64_t>(last_window_value)));
  napi_value event_id;
  napi_create_double(
      env, static_cast<double>(g_x11_window_guard_last_event_id.load()),
      &event_id);
  napi_set_named_property(env, result, "lastEventId", event_id);
  napi_value action;
  napi_create_int32(env, g_x11_window_guard_last_action.load(), &action);
  napi_set_named_property(env, result, "lastAction", action);
  napi_value mouse_x;
  napi_create_int32(env, g_x11_window_guard_last_mouse_x.load(), &mouse_x);
  napi_set_named_property(env, result, "lastMouseX", mouse_x);
  napi_value mouse_y;
  napi_create_int32(env, g_x11_window_guard_last_mouse_y.load(), &mouse_y);
  napi_set_named_property(env, result, "lastMouseY", mouse_y);
  napi_value hit_test;
  napi_create_uint32(env, g_x11_window_guard_last_hit_test.load(), &hit_test);
  napi_set_named_property(env, result, "lastHitTest", hit_test);
  NapiSetBool(env, result, "beforeIconic",
              g_x11_window_guard_last_before_iconic.load());
  NapiSetBool(env, result, "beforeZoomed",
              g_x11_window_guard_last_before_zoomed.load());
  NapiSetBool(env, result, "afterIconic",
              g_x11_window_guard_last_after_iconic.load());
  NapiSetBool(env, result, "afterZoomed",
              g_x11_window_guard_last_after_zoomed.load());
  HWND last_window = reinterpret_cast<HWND>(last_window_value);
  const bool current_window_valid =
      last_window != nullptr && IsWindow(last_window) != FALSE;
  NapiSetBool(env, result, "currentWindowValid", current_window_valid);
  NapiSetBool(env, result, "currentIconic",
              current_window_valid && IsIconic(last_window) != FALSE);
  NapiSetBool(env, result, "currentZoomed",
              current_window_valid && IsZoomed(last_window) != FALSE);
  RECT current_rect{};
  if (current_window_valid && GetWindowRect(last_window, &current_rect)) {
    napi_value rect;
    napi_create_object(env, &rect);
    napi_value left;
    napi_create_int32(env, current_rect.left, &left);
    napi_set_named_property(env, rect, "left", left);
    napi_value top;
    napi_create_int32(env, current_rect.top, &top);
    napi_set_named_property(env, rect, "top", top);
    napi_value right;
    napi_create_int32(env, current_rect.right, &right);
    napi_set_named_property(env, rect, "right", right);
    napi_value bottom;
    napi_create_int32(env, current_rect.bottom, &bottom);
    napi_set_named_property(env, rect, "bottom", bottom);
    napi_set_named_property(env, result, "currentRect", rect);
    napi_value style;
    napi_create_double(
        env, static_cast<double>(static_cast<uintptr_t>(
                 GetWindowLongPtrW(last_window, GWL_STYLE))),
        &style);
    napi_set_named_property(env, result, "currentStyle", style);
  }
  return result;
}

napi_value StartDrag(napi_env env, napi_callback_info info) {
  ReapFinishedSessions();
  if (g_shutting_down.load()) {
    napi_throw_error(env, nullptr, "Native drag module is shutting down");
    return nullptr;
  }
  size_t argument_count = 3;
  napi_value arguments[3];
  napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr);
  if (argument_count < 1) {
    napi_throw_type_error(env, nullptr, "startDrag requires a spec object");
    return nullptr;
  }

  napi_value event_callback = nullptr;
  if (argument_count >= 3) {
    event_callback = arguments[2];
  } else if (argument_count >= 2) {
    event_callback = arguments[1];
  }
  napi_valuetype callback_type = napi_undefined;
  if (event_callback != nullptr) {
    napi_typeof(env, event_callback, &callback_type);
  }
  if (callback_type != napi_function) {
    napi_throw_type_error(env, nullptr,
                          "startDrag requires an onEvent callback");
    return nullptr;
  }

  try {
    DragSpec spec = ParseSpec(env, arguments[0]);
    {
      std::lock_guard<std::mutex> lock(g_sessions_mutex);
      for (const auto& entry : g_sessions) {
        const auto& existing = entry.second;
        if (existing == nullptr || existing->finished.load() ||
            existing->released.load()) {
          continue;
        }
        if (existing->activated.load() || existing->dragging.load()) {
          throw std::runtime_error(
              "Another Windows native drag gesture is still active");
        }
        existing->Cancel();
      }
    }
    std::string request_id = GenerateRequestId();
    auto session =
        std::make_shared<DragSession>(std::move(spec), request_id);
    napi_value resource_name;
    napi_create_string_utf8(env, "Terma Windows SFTP drag",
                            NAPI_AUTO_LENGTH, &resource_name);
    napi_status status = napi_create_threadsafe_function(
        env, event_callback, nullptr, resource_name, 0, 1, nullptr, nullptr,
        nullptr, EventCallJs, &session->event_tsfn);
    if (status != napi_ok) {
      throw std::runtime_error("Unable to create the drag event callback");
    }
    napi_unref_threadsafe_function(env, session->event_tsfn);

    {
      std::lock_guard<std::mutex> lock(g_sessions_mutex);
      g_sessions.emplace(request_id, session);
    }
    try {
      session->worker = std::thread([session]() {
        if (ArmDrag(session) && !session->finished.load()) {
          StartManifestWorker(session);
          RunDragOnWorkerThread(session);
        }
      });
    } catch (...) {
      session->Cancel();
      {
        std::lock_guard<std::mutex> lock(g_sessions_mutex);
        g_sessions.erase(request_id);
      }
      if (session->worker.joinable()) {
        session->worker.join();
      }
      if (session->manifest_worker.joinable()) {
        session->manifest_worker.join();
      }
      session->ReleaseTsfn(napi_tsfn_abort);
      throw;
    }

    napi_value result;
    napi_create_object(env, &result);
    NapiSetString(env, result, "requestId", request_id);
    NapiSetBool(env, result, "accepted", true);
    return result;
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
}

napi_value ActivateDrag(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &argument_count, &argument, nullptr, nullptr);
  if (argument_count < 1) {
    napi_throw_type_error(env, nullptr, "activateDrag requires a requestId");
    return nullptr;
  }
  bool activated = false;
  try {
    std::string request_id = GetString(env, argument, "requestId");
    std::shared_ptr<DragSession> session;
    {
      std::lock_guard<std::mutex> lock(g_sessions_mutex);
      auto found = g_sessions.find(request_id);
      if (found != g_sessions.end()) {
        session = found->second;
      }
    }
    if (session != nullptr && !session->finished.load() &&
        !session->cancelled.load()) {
      session->Activate();
      activated = true;
    }
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, activated, &result);
  return result;
}

napi_value CancelDrag(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value argument;
  napi_get_cb_info(env, info, &argument_count, &argument, nullptr, nullptr);
  if (argument_count < 1) {
    napi_throw_type_error(env, nullptr, "cancelDrag requires a requestId");
    return nullptr;
  }
  bool cancelled = false;
  try {
    std::string request_id = GetString(env, argument, "requestId");
    std::shared_ptr<DragSession> session;
    {
      std::lock_guard<std::mutex> lock(g_sessions_mutex);
      auto found = g_sessions.find(request_id);
      if (found != g_sessions.end()) {
        session = found->second;
      }
    }
    if (session != nullptr && !session->finished.load()) {
      session->Cancel();
      cancelled = true;
    }
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, cancelled, &result);
  return result;
}

napi_value SetInternalTarget(napi_env env, napi_callback_info info) {
  size_t argument_count = 2;
  napi_value arguments[2];
  napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr);
  if (argument_count < 2) {
    napi_throw_type_error(env, nullptr,
                          "setInternalTarget requires a requestId and active flag");
    return nullptr;
  }
  bool active = false;
  if (napi_get_value_bool(env, arguments[1], &active) != napi_ok) {
    napi_throw_type_error(env, nullptr, "active flag must be a boolean");
    return nullptr;
  }
  bool updated = false;
  try {
    std::string request_id = GetString(env, arguments[0], "requestId");
    std::shared_ptr<DragSession> session;
    {
      std::lock_guard<std::mutex> lock(g_sessions_mutex);
      auto found = g_sessions.find(request_id);
      if (found != g_sessions.end()) {
        session = found->second;
      }
    }
    if (session != nullptr && !session->finished.load()) {
      session->internal_target_active.store(active);
      updated = true;
    }
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  }
  napi_value result;
  napi_get_boolean(env, updated, &result);
  return result;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"probe", nullptr, Probe, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"startX11WindowGuard", nullptr, StartX11WindowGuard, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"stopX11WindowGuard", nullptr, StopX11WindowGuard, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"getX11WindowGuardDiagnostics", nullptr,
       GetX11WindowGuardDiagnostics, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"startDrag", nullptr, StartDrag, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"activateDrag", nullptr, ActivateDrag, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setInternalTarget", nullptr, SetInternalTarget, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"cancelDrag", nullptr, CancelDrag, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]),
                         properties);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
