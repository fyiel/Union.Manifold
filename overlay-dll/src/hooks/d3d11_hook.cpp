/**
 * D3D11/DXGI Present Hook - intercepts IDXGISwapChain::Present.
 * This covers both D3D11 and D3D12 games (both go through DXGI).
 *
 * Strategy:
 *   1. Load dxgi.dll + d3d11.dll
 *   2. Create dummy device + swapchain to get the vtable address of Present
 *   3. Hook Present via MinHook
 *   4. In the hook: read overlay pixels from shared memory, upload to texture, draw quad
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <cstdio>

#include <MinHook.h>
#include "overlay_protocol.h"

// Forward declarations
namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }
namespace uc_d3d11_renderer { void render(ID3D11DeviceContext* ctx, IDXGISwapChain* swapChain); bool init(ID3D11Device* device); void cleanup(); }

namespace uc_d3d11 {

// Present signature: HRESULT (STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT)
typedef HRESULT(STDMETHODCALLTYPE* PFN_Present)(IDXGISwapChain* swapChain, UINT syncInterval, UINT flags);
static PFN_Present g_origPresent = nullptr;
static bool g_hooked = false;
static bool g_rendererInitialized = false;

static HRESULT STDMETHODCALLTYPE hookedPresent(IDXGISwapChain* swapChain, UINT syncInterval, UINT flags) {
    const auto* hdr = uc_shmem::header();
    if (hdr && hdr->magic == UC_FRAME_MAGIC && hdr->visible) {
        // Lazy-init renderer on first visible frame
        if (!g_rendererInitialized) {
            ID3D11Device* device = nullptr;
            if (SUCCEEDED(swapChain->GetDevice(__uuidof(ID3D11Device), (void**)&device))) {
                g_rendererInitialized = uc_d3d11_renderer::init(device);
                device->Release();
            }
        }

        if (g_rendererInitialized) {
            ID3D11Device* device = nullptr;
            ID3D11DeviceContext* ctx = nullptr;
            if (SUCCEEDED(swapChain->GetDevice(__uuidof(ID3D11Device), (void**)&device))) {
                device->GetImmediateContext(&ctx);
                if (ctx) {
                    uc_d3d11_renderer::render(ctx, swapChain);
                    ctx->Release();
                }
                device->Release();
            }
        }
    }

    return g_origPresent(swapChain, syncInterval, flags);
}

bool tryHook() {
    // Check if DXGI is loaded
    HMODULE hDXGI = GetModuleHandleA("dxgi.dll");
    HMODULE hD3D11 = GetModuleHandleA("d3d11.dll");
    if (!hDXGI || !hD3D11) return false;

    // Create a dummy window for the dummy device
    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(nullptr);
    wc.lpszClassName = "UCOverlayDummy";
    RegisterClassA(&wc);
    HWND dummyHwnd = CreateWindowA("UCOverlayDummy", "", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, nullptr, nullptr, wc.hInstance, nullptr);
    if (!dummyHwnd) return false;

    // Create dummy D3D11 device + swapchain
    DXGI_SWAP_CHAIN_DESC sd = {};
    sd.BufferCount = 1;
    sd.BufferDesc.Width = 100;
    sd.BufferDesc.Height = 100;
    sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow = dummyHwnd;
    sd.SampleDesc.Count = 1;
    sd.Windowed = TRUE;

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

    // Get vtable pointer for Present (index 8 in IDXGISwapChain vtable)
    void** vtable = *reinterpret_cast<void***>(dummySwapChain);
    void* presentAddr = vtable[8];

    // Clean up dummy objects
    dummySwapChain->Release();
    dummyDevice->Release();
    dummyCtx->Release();
    DestroyWindow(dummyHwnd);
    UnregisterClassA("UCOverlayDummy", wc.hInstance);

    // Install hook
    if (MH_Initialize() != MH_OK && MH_Initialize() != MH_ERROR_ALREADY_INITIALIZED) return false;

    if (MH_CreateHook(presentAddr, (void*)&hookedPresent, (void**)&g_origPresent) != MH_OK) return false;
    if (MH_EnableHook(presentAddr) != MH_OK) return false;

    g_hooked = true;
    OutputDebugStringA("[UC-D3D11] Present hooked.\n");
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
