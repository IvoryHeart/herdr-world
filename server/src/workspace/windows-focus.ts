import { dlopen, FFIType, ptr } from "bun:ffi";

// Explorer's folder window class.
const EXPLORER_WINDOW_CLASS = Buffer.from("CabinetWClass\0", "utf16le");
const SW_RESTORE = 9;
const FOCUS_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 30;

function openUser32() {
  const user32 = dlopen("user32.dll", {
    FindWindowExW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    GetForegroundWindow: { args: [], returns: FFIType.ptr },
    GetWindowThreadProcessId: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.u32,
    },
    AttachThreadInput: {
      args: [FFIType.u32, FFIType.u32, FFIType.bool],
      returns: FFIType.bool,
    },
    BringWindowToTop: { args: [FFIType.ptr], returns: FFIType.bool },
    SetForegroundWindow: { args: [FFIType.ptr], returns: FFIType.bool },
    IsIconic: { args: [FFIType.ptr], returns: FFIType.bool },
    ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
  });
  const kernel32 = dlopen("kernel32.dll", {
    GetCurrentThreadId: { args: [], returns: FFIType.u32 },
  });
  return { ...user32.symbols, ...kernel32.symbols };
}

type Win32 = ReturnType<typeof openUser32>;
type WindowHandle = NonNullable<ReturnType<Win32["FindWindowExW"]>>;

let win32: Win32 | undefined;
function api() {
  win32 ??= openUser32();
  return win32;
}

/** Returns the handles of the currently open Explorer folder windows. */
export function explorerWindows(): Set<WindowHandle> {
  const { FindWindowExW } = api();
  const windows = new Set<WindowHandle>();
  let window = FindWindowExW(null, null, ptr(EXPLORER_WINDOW_CLASS), null);
  while (window) {
    windows.add(window);
    window = FindWindowExW(null, window, ptr(EXPLORER_WINDOW_CLASS), null);
  }
  return windows;
}

/**
 * Windows keeps windows opened by a background process such as this server
 * behind the browser the user clicked in. Sharing the foreground thread's
 * input state lets the new Explorer window take the foreground instead.
 */
function bringToFront(window: WindowHandle) {
  const win = api();
  if (win.IsIconic(window)) win.ShowWindow(window, SW_RESTORE);
  const current = win.GetCurrentThreadId();
  const foreground = win.GetWindowThreadProcessId(
    win.GetForegroundWindow(),
    null,
  );
  const attached =
    foreground !== 0 &&
    foreground !== current &&
    win.AttachThreadInput(current, foreground, true);
  try {
    win.BringWindowToTop(window);
    win.SetForegroundWindow(window);
  } finally {
    if (attached) win.AttachThreadInput(current, foreground, false);
  }
}

/** Focuses the first Explorer window that was not open before the launch. */
export async function focusNewExplorerWindow(before: Set<WindowHandle>) {
  const deadline = performance.now() + FOCUS_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const opened = [...explorerWindows()].find((window) => !before.has(window));
    if (opened) {
      bringToFront(opened);
      return true;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  return false;
}
