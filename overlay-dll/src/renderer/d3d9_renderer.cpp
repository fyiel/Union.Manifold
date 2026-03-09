/**
 * D3D9 Overlay Renderer
 *
 * Reads BGRA pixels from shared memory and draws them as an alpha-blended
 * textured quad over the game frame using IDirect3DDevice9.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <d3d9.h>
#include <cstdio>
#include <cstring>

#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }

namespace uc_d3d9_renderer {

static IDirect3DTexture9*      g_tex     = nullptr;
static IDirect3DStateBlock9*   g_savedState = nullptr;
static uint32_t g_texW = 0, g_texH = 0;
static uint32_t g_lastSeq = 0;

struct Vertex {
    float x, y, z, rhw;
    float u, v;
};
static const DWORD FVF = D3DFVF_XYZRHW | D3DFVF_TEX1;

bool init(IDirect3DDevice9* dev, uint32_t w, uint32_t h) {
    g_texW = w;
    g_texH = h;

    HRESULT hr = dev->CreateTexture(g_texW, g_texH, 1,
                                     D3DUSAGE_DYNAMIC, D3DFMT_A8R8G8B8,
                                     D3DPOOL_DEFAULT, &g_tex, nullptr);
    if (FAILED(hr)) {
        OutputDebugStringA("[UC-D3D9] CreateTexture failed.\n");
        return false;
    }

    OutputDebugStringA("[UC-D3D9] Renderer initialized.\n");
    return true;
}

void render(IDirect3DDevice9* dev) {
    const auto* hdr = uc_shmem::header();
    if (!hdr || !hdr->visible) return;
    const uint8_t* px = uc_shmem::pixels();
    if (!px || !g_tex) return;

    // Upload pixels on sequence change
    if (hdr->seq != g_lastSeq) {
        D3DLOCKED_RECT lr{};
        if (SUCCEEDED(g_tex->LockRect(0, &lr, nullptr, D3DLOCK_DISCARD))) {
            const uint32_t srcPitch = g_texW * 4;
            for (uint32_t y = 0; y < g_texH; ++y)
                memcpy((uint8_t*)lr.pBits + y * lr.Pitch, px + y * srcPitch, srcPitch);
            g_tex->UnlockRect(0);
            g_lastSeq = hdr->seq;
        }
    }

    // Get backbuffer dimensions for the quad
    IDirect3DSurface9* bb = nullptr;
    D3DSURFACE_DESC bbDesc{};
    if (SUCCEEDED(dev->GetBackBuffer(0, 0, D3DBACKBUFFER_TYPE_MONO, &bb))) {
        bb->GetDesc(&bbDesc);
        bb->Release();
    } else {
        return;
    }

    float w = (float)bbDesc.Width;
    float h = (float)bbDesc.Height;

    Vertex quad[4] = {
        { 0, 0, 0, 1, 0, 0 },
        { w, 0, 0, 1, 1, 0 },
        { 0, h, 0, 1, 0, 1 },
        { w, h, 0, 1, 1, 1 },
    };

    // Save state
    dev->CreateStateBlock(D3DSBT_ALL, &g_savedState);
    if (g_savedState) g_savedState->Capture();

    // Set render state for alpha-blended textured quad
    dev->SetTexture(0, g_tex);
    dev->SetFVF(FVF);
    dev->SetPixelShader(nullptr);
    dev->SetVertexShader(nullptr);
    dev->SetRenderState(D3DRS_ALPHABLENDENABLE, TRUE);
    dev->SetRenderState(D3DRS_SRCBLEND, D3DBLEND_SRCALPHA);
    dev->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_INVSRCALPHA);
    dev->SetRenderState(D3DRS_LIGHTING, FALSE);
    dev->SetRenderState(D3DRS_ZENABLE, FALSE);
    dev->SetRenderState(D3DRS_CULLMODE, D3DCULL_NONE);
    dev->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_SELECTARG1);
    dev->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_TEXTURE);
    dev->SetTextureStageState(0, D3DTSS_ALPHAOP, D3DTOP_SELECTARG1);
    dev->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
    dev->SetSamplerState(0, D3DSAMP_MINFILTER, D3DTEXF_LINEAR);
    dev->SetSamplerState(0, D3DSAMP_MAGFILTER, D3DTEXF_LINEAR);

    dev->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, 2, quad, sizeof(Vertex));

    // Restore state
    if (g_savedState) {
        g_savedState->Apply();
        g_savedState->Release();
        g_savedState = nullptr;
    }
}

void cleanup() {
    if (g_tex) { g_tex->Release(); g_tex = nullptr; }
    if (g_savedState) { g_savedState->Release(); g_savedState = nullptr; }
    g_texW = g_texH = g_lastSeq = 0;
}

} // namespace uc_d3d9_renderer
