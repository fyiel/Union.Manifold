/**
 * D3D11 Overlay Renderer
 *
 * Reads BGRA pixels from shared memory and composites them as a fullscreen
 * alpha-blended quad over the game's backbuffer.
 *
 * Lifecycle: init() once → render() per frame → cleanup() on detach.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <cstdio>
#include <cstring>

#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }

namespace uc_d3d11_renderer {

// ---- GPU resources ----
static ID3D11Texture2D*          g_tex       = nullptr;
static ID3D11ShaderResourceView* g_srv       = nullptr;
static ID3D11SamplerState*       g_sampler   = nullptr;
static ID3D11BlendState*         g_blend     = nullptr;
static ID3D11VertexShader*       g_vs        = nullptr;
static ID3D11PixelShader*        g_ps        = nullptr;
static ID3D11RasterizerState*    g_raster    = nullptr;
static ID3D11DepthStencilState*  g_dss       = nullptr;

static uint32_t g_texW = 0, g_texH = 0;
static uint32_t g_lastSeq = 0;

// Minimal fullscreen triangle (vertex-id-only, no vertex buffer)
static const char* kShaderSrc = R"(
Texture2D    overlayTex : register(t0);
SamplerState samp       : register(s0);

struct VSOut {
    float4 pos : SV_Position;
    float2 uv  : TEXCOORD0;
};

VSOut VS(uint vid : SV_VertexID) {
    VSOut o;
    // Fullscreen triangle covering [-1,1] clip space
    float2 uv = float2((vid << 1) & 2, vid & 2);
    o.pos = float4(uv * float2(2, -2) + float2(-1, 1), 0, 1);
    o.uv  = uv;
    return o;
}

float4 PS(VSOut i) : SV_Target {
    return overlayTex.Sample(samp, i.uv);
}
)";

bool init(ID3D11Device* dev) {
    const auto* hdr = uc_shmem::header();
    if (!hdr || hdr->magic != UC_FRAME_MAGIC) return false;

    dev->AddRef(); // prevent premature release

    g_texW = hdr->width;
    g_texH = hdr->height;

    // Texture
    D3D11_TEXTURE2D_DESC td{};
    td.Width  = g_texW;
    td.Height = g_texH;
    td.MipLevels = 1;
    td.ArraySize = 1;
    td.Format    = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage     = D3D11_USAGE_DYNAMIC;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    td.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    dev->CreateTexture2D(&td, nullptr, &g_tex);

    // SRV
    D3D11_SHADER_RESOURCE_VIEW_DESC srvd{};
    srvd.Format = td.Format;
    srvd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
    srvd.Texture2D.MipLevels = 1;
    dev->CreateShaderResourceView(g_tex, &srvd, &g_srv);

    // Sampler
    D3D11_SAMPLER_DESC sd{};
    sd.Filter   = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    dev->CreateSamplerState(&sd, &g_sampler);

    // Blend (premultiplied alpha)
    D3D11_BLEND_DESC bd{};
    bd.RenderTarget[0].BlendEnable    = TRUE;
    bd.RenderTarget[0].SrcBlend       = D3D11_BLEND_SRC_ALPHA;
    bd.RenderTarget[0].DestBlend      = D3D11_BLEND_INV_SRC_ALPHA;
    bd.RenderTarget[0].BlendOp        = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].SrcBlendAlpha  = D3D11_BLEND_ONE;
    bd.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    bd.RenderTarget[0].BlendOpAlpha   = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    dev->CreateBlendState(&bd, &g_blend);

    // Depth-stencil (disabled)
    D3D11_DEPTH_STENCIL_DESC dsd{};
    dsd.DepthEnable = FALSE;
    dev->CreateDepthStencilState(&dsd, &g_dss);

    // Rasterizer (no culling)
    D3D11_RASTERIZER_DESC rd{};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_NONE;
    dev->CreateRasterizerState(&rd, &g_raster);

    // Compile shaders
    ID3DBlob* vsBlob = nullptr;
    ID3DBlob* psBlob = nullptr;
    ID3DBlob* err    = nullptr;

    HRESULT hr = D3DCompile(kShaderSrc, strlen(kShaderSrc), "overlay", nullptr, nullptr,
                            "VS", "vs_4_0", 0, 0, &vsBlob, &err);
    if (FAILED(hr)) {
        if (err) { OutputDebugStringA((char*)err->GetBufferPointer()); err->Release(); }
        dev->Release();
        return false;
    }
    hr = D3DCompile(kShaderSrc, strlen(kShaderSrc), "overlay", nullptr, nullptr,
                    "PS", "ps_4_0", 0, 0, &psBlob, &err);
    if (FAILED(hr)) {
        if (err) { OutputDebugStringA((char*)err->GetBufferPointer()); err->Release(); }
        vsBlob->Release(); dev->Release();
        return false;
    }

    dev->CreateVertexShader(vsBlob->GetBufferPointer(), vsBlob->GetBufferSize(), nullptr, &g_vs);
    dev->CreatePixelShader(psBlob->GetBufferPointer(), psBlob->GetBufferSize(), nullptr, &g_ps);
    vsBlob->Release();
    psBlob->Release();

    dev->Release(); // release the AddRef above
    OutputDebugStringA("[UC-D3D11] Renderer initialized.\n");
    return true;
}

void render(ID3D11DeviceContext* ctx, IDXGISwapChain* pSwap) {
    const auto* hdr = uc_shmem::header();
    if (!hdr || !hdr->visible) return;
    const uint8_t* px = uc_shmem::pixels();
    if (!px) return;

    ID3D11Device* dev = nullptr;
    ctx->GetDevice(&dev);
    if (!dev) return;

    // Upload pixels if sequence changed
    if (hdr->seq != g_lastSeq && g_tex) {
        D3D11_MAPPED_SUBRESOURCE mapped{};
        if (SUCCEEDED(ctx->Map(g_tex, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped))) {
            const uint32_t srcPitch = g_texW * 4;
            for (uint32_t y = 0; y < g_texH; ++y)
                memcpy((uint8_t*)mapped.pData + y * mapped.RowPitch,
                       px + y * srcPitch, srcPitch);
            ctx->Unmap(g_tex, 0);
            g_lastSeq = hdr->seq;
        }
    }

    // Get RTV from backbuffer
    ID3D11RenderTargetView* rtv = nullptr;
    ID3D11Texture2D* backBuf = nullptr;
    pSwap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&backBuf);
    if (backBuf) {
        dev->CreateRenderTargetView(backBuf, nullptr, &rtv);
        backBuf->Release();
    }
    if (!rtv) { ctx->Release(); dev->Release(); return; }

    // Set pipeline state
    ctx->OMSetRenderTargets(1, &rtv, nullptr);
    const float blendFactor[4] = { 0, 0, 0, 0 };
    ctx->OMSetBlendState(g_blend, blendFactor, 0xFFFFFFFF);
    ctx->OMSetDepthStencilState(g_dss, 0);
    ctx->RSSetState(g_raster);
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->IASetInputLayout(nullptr);
    ctx->VSSetShader(g_vs, nullptr, 0);
    ctx->PSSetShader(g_ps, nullptr, 0);
    ctx->PSSetShaderResources(0, 1, &g_srv);
    ctx->PSSetSamplers(0, 1, &g_sampler);

    // Set viewport to match backbuffer
    D3D11_TEXTURE2D_DESC bbDesc{};
    ID3D11Texture2D* bb2 = nullptr;
    pSwap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&bb2);
    if (bb2) { bb2->GetDesc(&bbDesc); bb2->Release(); }
    D3D11_VIEWPORT vp{ 0, 0, (float)bbDesc.Width, (float)bbDesc.Height, 0, 1 };
    ctx->RSSetViewports(1, &vp);

    // Draw fullscreen triangle (3 vertices, vertex-id driven)
    ctx->Draw(3, 0);

    rtv->Release();
    dev->Release();
}

void cleanup() {
    auto safeRelease = [](auto** p) { if (*p) { (*p)->Release(); *p = nullptr; } };
    safeRelease(&g_tex);
    safeRelease(&g_srv);
    safeRelease(&g_sampler);
    safeRelease(&g_blend);
    safeRelease(&g_vs);
    safeRelease(&g_ps);
    safeRelease(&g_raster);
    safeRelease(&g_dss);
    g_texW = g_texH = g_lastSeq = 0;
}

} // namespace uc_d3d11_renderer
