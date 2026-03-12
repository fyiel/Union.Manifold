/**
 * UC Overlay DLL - Entry point.
 *
 * This DLL is injected into game processes by the Electron app's native addon.
 * On DLL_PROCESS_ATTACH it spawns a background thread that:
 *   1. Opens the shared memory segment for frame pixel data.
 *   2. Connects to the named pipe for IPC with the Electron process.
 *   3. Detects which graphics API the game uses (D3D9, D3D11/12, OpenGL).
 *   4. Installs Present/SwapBuffers hooks via MinHook.
 *   5. Subclasses the game window's WndProc for input isolation.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <cstdio>
#include <thread>
#include <atomic>

#include "overlay_protocol.h"

// Forward declarations from other translation units
namespace uc_ipc    { bool init(uint32_t pid); void shutdown(); void pumpMessages(); }
namespace uc_shmem  { bool open(uint32_t pid); void close(); const UCFrameHeader* header(); const uint8_t* pixels(); }
namespace uc_d3d9   { bool tryHook(); void unhook(); }
namespace uc_d3d11  { bool tryHook(); void unhook(); }
namespace uc_gl     { bool tryHook(); void unhook(); }
namespace uc_wndproc{ bool hook(HWND hwnd); void unhook(); void setOverlayVisible(bool v); }

// Globals
static HMODULE g_hModule = nullptr;
std::atomic<bool> g_running{false};
static std::thread g_initThread;
static HWND g_gameWindow = nullptr;

// Detect game window (largest visible top-level window in this process)
static HWND findGameWindow() {
    struct EnumCtx { HWND best; int bestArea; DWORD pid; };
    EnumCtx ctx{nullptr, 0, GetCurrentProcessId()};

    EnumWindows([](HWND hwnd, LPARAM lp) -> BOOL {
        auto* c = reinterpret_cast<EnumCtx*>(lp);
        DWORD wndPid = 0;
        GetWindowThreadProcessId(hwnd, &wndPid);
        if (wndPid != c->pid) return TRUE;
        if (!IsWindowVisible(hwnd)) return TRUE;
        RECT r;
        if (!GetClientRect(hwnd, &r)) return TRUE;
        int area = (r.right - r.left) * (r.bottom - r.top);
        if (area > c->bestArea) {
            c->bestArea = area;
            c->best = hwnd;
        }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&ctx));

    return ctx.best;
}

static void overlayThread() {
    uint32_t pid = GetCurrentProcessId();

    // 1. Open shared memory
    for (int attempt = 0; attempt < 30 && g_running; ++attempt) {
        if (uc_shmem::open(pid)) break;
        Sleep(200);
    }

    if (!uc_shmem::header()) {
        OutputDebugStringA("[UC-Overlay] Failed to open shared memory, aborting.\n");
        g_running = false;
        return;
    }

    // 2. Connect IPC pipe
    uc_ipc::init(pid);

    // 3. Wait for game window
    for (int attempt = 0; attempt < 50 && g_running; ++attempt) {
        g_gameWindow = findGameWindow();
        if (g_gameWindow) break;
        Sleep(200);
    }

    if (!g_gameWindow) {
        OutputDebugStringA("[UC-Overlay] Could not find game window, aborting.\n");
        g_running = false;
        return;
    }

    // 4. Hook graphics APIs (try each; game uses one)
    const char* hookedApi = nullptr;
    if (uc_d3d11::tryHook()) {
        hookedApi = "d3d11";
    } else if (uc_d3d9::tryHook()) {
        hookedApi = "d3d9";
    } else if (uc_gl::tryHook()) {
        hookedApi = "opengl";
    }

    if (!hookedApi) {
        OutputDebugStringA("[UC-Overlay] No graphics API detected.\n");
        g_running = false;
        return;
    }

    char msg[128];
    snprintf(msg, sizeof(msg), "[UC-Overlay] Hooked: %s\n", hookedApi);
    OutputDebugStringA(msg);

    // 5. Subclass WndProc for input isolation
    uc_wndproc::hook(g_gameWindow);

    // 6. Main loop: pump IPC messages, check visibility
    while (g_running) {
        uc_ipc::pumpMessages();

        const auto* hdr = uc_shmem::header();
        if (hdr && hdr->magic == UC_FRAME_MAGIC) {
            uc_wndproc::setOverlayVisible(hdr->visible != 0);
        }

        Sleep(16); // ~60Hz polling
    }

    // Cleanup
    uc_wndproc::unhook();
    uc_d3d9::unhook();
    uc_d3d11::unhook();
    uc_gl::unhook();
    uc_shmem::close();
    uc_ipc::shutdown();
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID) {
    switch (reason) {
    case DLL_PROCESS_ATTACH:
        g_hModule = hModule;
        DisableThreadLibraryCalls(hModule);
        g_running = true;
        g_initThread = std::thread(overlayThread);
        g_initThread.detach();
        break;

    case DLL_PROCESS_DETACH:
        g_running = false;
        // Give the thread a moment to wind down
        Sleep(100);
        break;
    }
    return TRUE;
}
