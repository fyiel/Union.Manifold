/**
 * WndProc Hook - subclasses the game window to intercept input when the overlay is visible.
 * When visible: consumes WM_KEY*, WM_CHAR, WM_MOUSE* and forwards them to Electron via pipe.
 * When hidden: passes all messages through to the original WndProc.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <atomic>
#include <cstdio>

namespace uc_ipc {
    void sendKeyEvent(const char* key, bool down, bool ctrl, bool shift, bool alt);
    void sendMouseEvent(int x, int y, const char* button, bool down);
    void sendMouseMove(int x, int y);
}

namespace uc_wndproc {

static HWND g_hwnd = nullptr;
static WNDPROC g_origWndProc = nullptr;
static std::atomic<bool> g_overlayVisible{false};

void setOverlayVisible(bool v) {
    g_overlayVisible.store(v);
}

static const char* vkToName(WPARAM wParam) {
    switch (wParam) {
        case VK_ESCAPE: return "Escape";
        case VK_RETURN: return "Enter";
        case VK_TAB: return "Tab";
        case VK_BACK: return "Backspace";
        case VK_SPACE: return "Space";
        case VK_LEFT: return "ArrowLeft";
        case VK_RIGHT: return "ArrowRight";
        case VK_UP: return "ArrowUp";
        case VK_DOWN: return "ArrowDown";
        case VK_DELETE: return "Delete";
        case VK_HOME: return "Home";
        case VK_END: return "End";
        default: {
            static thread_local char buf[16];
            if (wParam >= 'A' && wParam <= 'Z') {
                buf[0] = (char)wParam;
                buf[1] = '\0';
            } else if (wParam >= '0' && wParam <= '9') {
                buf[0] = (char)wParam;
                buf[1] = '\0';
            } else {
                snprintf(buf, sizeof(buf), "VK_%u", (unsigned)wParam);
            }
            return buf;
        }
    }
}

static LRESULT CALLBACK hooked_WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (!g_overlayVisible.load()) {
        return CallWindowProcW(g_origWndProc, hwnd, msg, wParam, lParam);
    }

    // Overlay is visible - intercept input messages
    bool ctrl  = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
    bool shift = (GetKeyState(VK_SHIFT) & 0x8000) != 0;
    bool alt   = (GetKeyState(VK_MENU) & 0x8000) != 0;

    switch (msg) {
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
        uc_ipc::sendKeyEvent(vkToName(wParam), true, ctrl, shift, alt);
        return 0;

    case WM_KEYUP:
    case WM_SYSKEYUP:
        uc_ipc::sendKeyEvent(vkToName(wParam), false, ctrl, shift, alt);
        return 0;

    case WM_CHAR:
    case WM_SYSCHAR:
        return 0; // Consume

    case WM_LBUTTONDOWN:
        uc_ipc::sendMouseEvent(LOWORD(lParam), HIWORD(lParam), "left", true);
        return 0;
    case WM_LBUTTONUP:
        uc_ipc::sendMouseEvent(LOWORD(lParam), HIWORD(lParam), "left", false);
        return 0;
    case WM_RBUTTONDOWN:
        uc_ipc::sendMouseEvent(LOWORD(lParam), HIWORD(lParam), "right", true);
        return 0;
    case WM_RBUTTONUP:
        uc_ipc::sendMouseEvent(LOWORD(lParam), HIWORD(lParam), "right", false);
        return 0;
    case WM_MBUTTONDOWN:
        uc_ipc::sendMouseEvent(LOWORD(lParam), HIWORD(lParam), "middle", true);
        return 0;
    case WM_MBUTTONUP:
        uc_ipc::sendMouseEvent(LOWORD(lParam), HIWORD(lParam), "middle", false);
        return 0;
    case WM_MOUSEMOVE:
        uc_ipc::sendMouseMove(LOWORD(lParam), HIWORD(lParam));
        return 0;
    case WM_MOUSEWHEEL:
        // Forward scroll as a key event for now
        return 0;

    // Allow window management messages through
    case WM_SIZE:
    case WM_MOVE:
    case WM_ACTIVATE:
    case WM_ACTIVATEAPP:
    case WM_PAINT:
    case WM_ERASEBKGND:
    case WM_DESTROY:
    case WM_CLOSE:
    case WM_QUIT:
    case WM_NCDESTROY:
        return CallWindowProcW(g_origWndProc, hwnd, msg, wParam, lParam);

    default:
        // Non-input messages pass through
        if (msg < WM_KEYFIRST || msg > WM_KEYLAST) {
            if (msg < WM_MOUSEFIRST || msg > WM_MOUSELAST) {
                return CallWindowProcW(g_origWndProc, hwnd, msg, wParam, lParam);
            }
        }
        return 0; // Consume remaining input-related messages
    }
}

bool hook(HWND hwnd) {
    if (!hwnd || g_origWndProc) return false;
    g_hwnd = hwnd;
    g_origWndProc = (WNDPROC)SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)hooked_WndProc);
    if (!g_origWndProc) {
        OutputDebugStringA("[UC-WndProc] SetWindowLongPtr failed.\n");
        return false;
    }
    OutputDebugStringA("[UC-WndProc] Window subclassed successfully.\n");
    return true;
}

void unhook() {
    if (g_hwnd && g_origWndProc) {
        SetWindowLongPtrW(g_hwnd, GWLP_WNDPROC, (LONG_PTR)g_origWndProc);
        g_origWndProc = nullptr;
        g_hwnd = nullptr;
    }
}

} // namespace uc_wndproc
