/**
 * D3D11/DXGI hook installer.
 *
 * Hooks installed (vtable indices per IDXGISwapChain/IDXGISwapChain1):
 *   - Present         (vtable[8],  IDXGISwapChain)
 *   - ResizeBuffers   (vtable[13], IDXGISwapChain)
 *   - ResizeTarget    (vtable[14], IDXGISwapChain)
 *   - Present1        (vtable[22], IDXGISwapChain1)   -- DXGI 1.2+
 *
 * Strategy follows hiitiger/goverlay:
 *   1. Create dummy HWND + device + swapchain.
 *   2. Read vtable slots to get original function addresses.
 *   3. MinHook trampolines installed at those addresses, hitting every
 *      future swapchain in-process.
 *   4. Query IDXGISwapChain1 from the dummy to hook Present1 (skipped on
 *      DXGI 1.1 only).
 *
 * On ResizeBuffers we tell the renderer to drop cached frame state so the
 * next Present recreates the RTV against the new backbuffer.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <dxgi1_2.h>
#include <cstdio>

#include <MinHook.h>
#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }
namespace uc_d3d11_renderer {
    void render(ID3D11DeviceContext* ctx, IDXGISwapChain* swapChain);
    bool init(ID3D11Device* device);
    void onResize();
    void cleanup();
}

namespace uc_d3d11 {

typedef HRESULT(STDMETHODCALLTYPE* PFN_Present)(IDXGISwapChain*, UINT, UINT);
typedef HRESULT(STDMETHODCALLTYPE* PFN_Present1)(IDXGISwapChain1*, UINT, UINT, const DXGI_PRESENT_PARAMETERS*);
typedef HRESULT(STDMETHODCALLTYPE* PFN_ResizeBuffers)(IDXGISwapChain*, UINT, UINT, UINT, DXGI_FORMAT, UINT);
typedef HRESULT(STDMETHODCALLTYPE* PFN_ResizeTarget)(IDXGISwapChain*, const DXGI_MODE_DESC*);

static PFN_Present        g_origPresent        = nullptr;
static PFN_Present1       g_origPresent1       = nullptr;
static PFN_ResizeBuffers  g_origResizeBuffers  = nullptr;
static PFN_ResizeTarget   g_origResizeTarget   = nullptr;

static bool g_hooked = false;
static bool g_rendererInitialized = false;

static void drawOverlay(IDXGISwapChain* swapChain) {
    const auto* hdr = uc_shmem::header();
    if (!hdr || hdr->magic != UC_FRAME_MAGIC || !hdr->visible) return;

    ID3D11Device* device = nullptr;
    if (FAILED(swapChain->GetDevice(__uuidof(ID3D11Device), (void**)&device)) || !device) return;

    if (!g_rendererInitialized) {
        g_rendererInitialized = uc_d3d11_renderer::init(device);
    }

    if (g_rendererInitialized) {
        ID3D11DeviceContext* ctx = nullptr;
        device->GetImmediateContext(&ctx);
        if (ctx) {
            uc_d3d11_renderer::render(ctx, swapChain);
            ctx->Release();
        }
    }

    device->Release();
}

static HRESULT STDMETHODCALLTYPE hookedPresent(IDXGISwapChain* swapChain, UINT syncInterval, UINT flags) {
    drawOverlay(swapChain);
    return g_origPresent(swapChain, syncInterval, flags);
}

static HRESULT STDMETHODCALLTYPE hookedPresent1(IDXGISwapChain1* swapChain, UINT syncInterval, UINT flags, const DXGI_PRESENT_PARAMETERS* params) {
    drawOverlay(swapChain);
    return g_origPresent1(swapChain, syncInterval, flags, params);
}

static HRESULT STDMETHODCALLTYPE hookedResizeBuffers(IDXGISwapChain* swapChain, UINT bufferCount, UINT w, UINT h, DXGI_FORMAT fmt, UINT swapChainFlags) {
    uc_d3d11_renderer::onResize();
    return g_origResizeBuffers(swapChain, bufferCount, w, h, fmt, swapChainFlags);
}

static HRESULT STDMETHODCALLTYPE hookedResizeTarget(IDXGISwapChain* swapChain, const DXGI_MODE_DESC* mode) {
    uc_d3d11_renderer::onResize();
    return g_origResizeTarget(swapChain, mode);
}

static bool installHook(void* target, void* detour, void** trampoline, const char* tag) {
    if (MH_CreateHook(target, detour, trampoline) != MH_OK) {
        char buf[128];
        wsprintfA(buf, "[UC-D3D11] CreateHook failed for %s\n", tag);
        OutputDebugStringA(buf);
        return false;
    }
    if (MH_EnableHook(target) != MH_OK) {
        char buf[128];
        wsprintfA(buf, "[UC-D3D11] EnableHook failed for %s\n", tag);
        OutputDebugStringA(buf);
        return false;
    }
    return true;
}

bool tryHook() {
    HMODULE hDXGI = GetModuleHandleA("dxgi.dll");
    HMODULE hD3D11 = GetModuleHandleA("d3d11.dll");
    if (!hDXGI || !hD3D11) return false;

    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(nullptr);
    wc.lpszClassName = "UCOverlayDummy";
    RegisterClassA(&wc);
    HWND dummyHwnd = CreateWindowA("UCOverlayDummy", "", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, nullptr, nullptr, wc.hInstance, nullptr);
    if (!dummyHwnd) return false;

    DXGI_SWAP_CHAIN_DESC sd = {};
    sd.BufferCount = 1;
    sd.BufferDesc.Width = 2;
    sd.BufferDesc.Height = 2;
    sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow = dummyHwnd;
    sd.SampleDesc.Count = 1;
    sd.Windowed = TRUE;
    sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    IDXGISwapChain* dummySwapChain = nullptr;
    ID3D11Device* dummyDevice = nullptr;
    ID3D11DeviceContext* dummyCtx = nullptr;

    HRESULT hr = D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
        nullptr, 0, D3D11_SDK_VERSION,
        &sd, &dummySwapChain, &dummyDevice, nullptr, &dummyCtx
    );

    if (FAILED(hr) || !dummySwapChain) {
        DestroyWindow(dummyHwnd);
        UnregisterClassA("UCOverlayDummy", wc.hInstance);
        return false;
    }

    void** vtable = *reinterpret_cast<void***>(dummySwapChain);
    void* presentAddr       = vtable[8];
    void* resizeBuffersAddr = vtable[13];
    void* resizeTargetAddr  = vtable[14];

    void* present1Addr = nullptr;
    IDXGISwapChain1* dummySwapChain1 = nullptr;
    if (SUCCEEDED(dummySwapChain->QueryInterface(__uuidof(IDXGISwapChain1), (void**)&dummySwapChain1)) && dummySwapChain1) {
        void** vtable1 = *reinterpret_cast<void***>(dummySwapChain1);
        present1Addr = vtable1[22];
        dummySwapChain1->Release();
    }

    dummySwapChain->Release();
    dummyDevice->Release();
    dummyCtx->Release();
    DestroyWindow(dummyHwnd);
    UnregisterClassA("UCOverlayDummy", wc.hInstance);

    MH_STATUS initStatus = MH_Initialize();
    if (initStatus != MH_OK && initStatus != MH_ERROR_ALREADY_INITIALIZED) return false;

    if (!installHook(presentAddr,       (void*)&hookedPresent,       (void**)&g_origPresent,       "Present"))       return false;
    if (!installHook(resizeBuffersAddr, (void*)&hookedResizeBuffers, (void**)&g_origResizeBuffers, "ResizeBuffers")) return false;
    if (!installHook(resizeTargetAddr,  (void*)&hookedResizeTarget,  (void**)&g_origResizeTarget,  "ResizeTarget"))  return false;
    if (present1Addr) {
        installHook(present1Addr, (void*)&hookedPresent1, (void**)&g_origPresent1, "Present1");
    }

    g_hooked = true;
    OutputDebugStringA("[UC-D3D11] Hooks installed (Present, ResizeBuffers, ResizeTarget, Present1).\n");
    return true;
}

void unhook() {
    if (g_hooked) {
        MH_DisableHook(MH_ALL_HOOKS);
        g_hooked = false;
    }
    if (g_rendererInitialized) {
        uc_d3d11_renderer::cleanup();
        g_rendererInitialized = false;
    }
}

} // namespace uc_d3d11
