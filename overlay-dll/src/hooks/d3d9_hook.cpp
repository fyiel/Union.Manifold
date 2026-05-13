/**
 * D3D9 hook installer.
 *
 * Hooks installed (vtable indices per IDirect3DDevice9):
 *   - Reset    (vtable[16])
 *   - Present  (vtable[17])
 *
 * Reset hook is required because D3DPOOL_DEFAULT resources (our overlay
 * texture) are destroyed by the runtime on device-lost / fullscreen
 * alt-tab / resolution change. After Reset the next Present triggers a
 * re-init. Pattern mirrored from hiitiger/goverlay (d3d9hook.cc).
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <d3d9.h>
#include <cstdio>

#include <MinHook.h>
#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }
namespace uc_d3d9_renderer {
    void render(IDirect3DDevice9* device);
    bool init(IDirect3DDevice9* device, uint32_t w, uint32_t h);
    void onResetPre();
    void onResetPost(IDirect3DDevice9* device);
    void cleanup();
}

namespace uc_d3d9 {

typedef HRESULT(STDMETHODCALLTYPE* PFN_Present)(IDirect3DDevice9*, const RECT*, const RECT*, HWND, const RGNDATA*);
typedef HRESULT(STDMETHODCALLTYPE* PFN_Reset)(IDirect3DDevice9*, D3DPRESENT_PARAMETERS*);

static PFN_Present g_origPresent = nullptr;
static PFN_Reset   g_origReset   = nullptr;
static bool g_hooked = false;
static bool g_rendererInitialized = false;

static HRESULT STDMETHODCALLTYPE hookedPresent(IDirect3DDevice9* device, const RECT* src, const RECT* dst, HWND hwndOverride, const RGNDATA* dirty) {
    const auto* hdr = uc_shmem::header();
    if (hdr && hdr->magic == UC_FRAME_MAGIC && hdr->visible) {
        if (!g_rendererInitialized) {
            g_rendererInitialized = uc_d3d9_renderer::init(device, hdr->width, hdr->height);
        }
        if (g_rendererInitialized) {
            uc_d3d9_renderer::render(device);
        }
    }
    return g_origPresent(device, src, dst, hwndOverride, dirty);
}

static HRESULT STDMETHODCALLTYPE hookedReset(IDirect3DDevice9* device, D3DPRESENT_PARAMETERS* pp) {
    uc_d3d9_renderer::onResetPre();
    g_rendererInitialized = false;
    HRESULT hr = g_origReset(device, pp);
    if (SUCCEEDED(hr)) {
        uc_d3d9_renderer::onResetPost(device);
    }
    return hr;
}

bool tryHook() {
    HMODULE hD3D9 = GetModuleHandleA("d3d9.dll");
    if (!hD3D9) return false;

    typedef IDirect3D9* (WINAPI* PFN_Direct3DCreate9)(UINT);
    auto pDirect3DCreate9 = (PFN_Direct3DCreate9)GetProcAddress(hD3D9, "Direct3DCreate9");
    if (!pDirect3DCreate9) return false;

    IDirect3D9* d3d = pDirect3DCreate9(D3D_SDK_VERSION);
    if (!d3d) return false;

    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(nullptr);
    wc.lpszClassName = "UCOverlayD3D9Dummy";
    RegisterClassA(&wc);
    HWND dummyHwnd = CreateWindowA("UCOverlayD3D9Dummy", "", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, nullptr, nullptr, wc.hInstance, nullptr);

    D3DPRESENT_PARAMETERS pp = {};
    pp.Windowed = TRUE;
    pp.SwapEffect = D3DSWAPEFFECT_DISCARD;
    pp.hDeviceWindow = dummyHwnd;

    IDirect3DDevice9* dummyDevice = nullptr;
    HRESULT hr = d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, dummyHwnd,
        D3DCREATE_SOFTWARE_VERTEXPROCESSING, &pp, &dummyDevice);

    if (FAILED(hr) || !dummyDevice) {
        d3d->Release();
        DestroyWindow(dummyHwnd);
        UnregisterClassA("UCOverlayD3D9Dummy", wc.hInstance);
        return false;
    }

    void** vtable = *reinterpret_cast<void***>(dummyDevice);
    void* resetAddr   = vtable[16];
    void* presentAddr = vtable[17];

    dummyDevice->Release();
    d3d->Release();
    DestroyWindow(dummyHwnd);
    UnregisterClassA("UCOverlayD3D9Dummy", wc.hInstance);

    MH_STATUS initStatus = MH_Initialize();
    if (initStatus != MH_OK && initStatus != MH_ERROR_ALREADY_INITIALIZED) return false;

    if (MH_CreateHook(presentAddr, (void*)&hookedPresent, (void**)&g_origPresent) != MH_OK) return false;
    if (MH_CreateHook(resetAddr,   (void*)&hookedReset,   (void**)&g_origReset)   != MH_OK) return false;
    if (MH_EnableHook(presentAddr) != MH_OK) return false;
    if (MH_EnableHook(resetAddr)   != MH_OK) return false;

    g_hooked = true;
    OutputDebugStringA("[UC-D3D9] Hooks installed (Present, Reset).\n");
    return true;
}

void unhook() {
    if (g_hooked) {
        MH_DisableHook(MH_ALL_HOOKS);
        g_hooked = false;
    }
    if (g_rendererInitialized) {
        uc_d3d9_renderer::cleanup();
        g_rendererInitialized = false;
    }
}

} // namespace uc_d3d9
