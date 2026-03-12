/**
 * OpenGL wglSwapBuffers Hook - intercepts the final buffer swap.
 *
 * Strategy:
 *   1. Check if opengl32.dll is loaded
 *   2. Get wglSwapBuffers address
 *   3. Hook via MinHook
 *   4. In hook: read overlay pixels from shared memory, upload to GL texture, draw fullscreen quad
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <GL/gl.h>
#include <cstdio>

#include <MinHook.h>
#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }
namespace uc_gl_renderer { void render(); bool init(uint32_t w, uint32_t h); void cleanup(); }

namespace uc_gl {

typedef BOOL(WINAPI* PFN_wglSwapBuffers)(HDC);
static PFN_wglSwapBuffers g_origSwapBuffers = nullptr;
static bool g_hooked = false;
static bool g_rendererInitialized = false;

static BOOL WINAPI hookedSwapBuffers(HDC hdc) {
    const auto* hdr = uc_shmem::header();
    if (hdr && hdr->magic == UC_FRAME_MAGIC && hdr->visible) {
        if (!g_rendererInitialized) {
            g_rendererInitialized = uc_gl_renderer::init(hdr->width, hdr->height);
        }
        if (g_rendererInitialized) {
            uc_gl_renderer::render();
        }
    }
    return g_origSwapBuffers(hdc);
}

bool tryHook() {
    HMODULE hGL = GetModuleHandleA("opengl32.dll");
    if (!hGL) return false;

    // wglSwapBuffers is not exported by opengl32.dll - it's SwapBuffers from gdi32
    // But the actual GL-aware one is in opengl32.dll's internal dispatch.
    // We hook gdi32!SwapBuffers since that's what games call.
    HMODULE hGDI = GetModuleHandleA("gdi32.dll");
    if (!hGDI) return false;

    auto pSwapBuffers = (PFN_wglSwapBuffers)GetProcAddress(hGDI, "SwapBuffers");
    if (!pSwapBuffers) return false;

    if (MH_Initialize() != MH_OK && MH_Initialize() != MH_ERROR_ALREADY_INITIALIZED) return false;
    if (MH_CreateHook((void*)pSwapBuffers, (void*)&hookedSwapBuffers, (void**)&g_origSwapBuffers) != MH_OK) return false;
    if (MH_EnableHook((void*)pSwapBuffers) != MH_OK) return false;

    g_hooked = true;
    OutputDebugStringA("[UC-GL] SwapBuffers hooked.\n");
    return true;
}

void unhook() {
    if (g_hooked) {
        MH_DisableHook(MH_ALL_HOOKS);
        g_hooked = false;
    }
    if (g_rendererInitialized) {
        uc_gl_renderer::cleanup();
        g_rendererInitialized = false;
    }
}

} // namespace uc_gl
