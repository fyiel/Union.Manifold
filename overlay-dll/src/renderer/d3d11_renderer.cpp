/**
 * D3D11 Overlay Renderer
 *
 * Reads BGRA pixels from shared memory and composites them as a fullscreen
 * alpha-blended quad over the game's backbuffer.
 *
 * Lifecycle: init() once -> render() per frame -> onResize() on backbuffer
 * change -> cleanup() on detach.
 *
 * State preservation (borrowed from hiitiger/goverlay):
 * we snapshot every pipeline binding we touch, draw the overlay, then
 * restore the game's state. Without this the game sees its IA/VS/PS/RTV/
 * blend/raster/depth state stomped each present -> visual corruption.
 */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <cstdio>
#include <cstring>

#include "overlay_protocol.h"

namespace uc_shmem { const UCFrameHeader* header(); const uint8_t* pixels(); }

namespace uc_d3d11_renderer {

void cleanup();

static ID3D11Device*             g_device    = nullptr;
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

static const char* kShaderSrc = R"(
Texture2D    overlayTex : register(t0);
SamplerState samp       : register(s0);

struct VSOut {
    float4 pos : SV_Position;
    float2 uv  : TEXCOORD0;
};

VSOut VS(uint vid : SV_VertexID) {
    VSOut o;
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

    g_device = dev;
    g_device->AddRef();

    g_texW = hdr->width;
    g_texH = hdr->height;

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
    if (FAILED(dev->CreateTexture2D(&td, nullptr, &g_tex))) { cleanup(); return false; }

    D3D11_SHADER_RESOURCE_VIEW_DESC srvd{};
    srvd.Format = td.Format;
    srvd.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
    srvd.Texture2D.MipLevels = 1;
    if (FAILED(dev->CreateShaderResourceView(g_tex, &srvd, &g_srv))) { cleanup(); return false; }

    D3D11_SAMPLER_DESC sd{};
    sd.Filter   = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    dev->CreateSamplerState(&sd, &g_sampler);

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

    D3D11_DEPTH_STENCIL_DESC dsd{};
    dsd.DepthEnable = FALSE;
    dev->CreateDepthStencilState(&dsd, &g_dss);

    D3D11_RASTERIZER_DESC rd{};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_NONE;
    dev->CreateRasterizerState(&rd, &g_raster);

    ID3DBlob* vsBlob = nullptr;
    ID3DBlob* psBlob = nullptr;
    ID3DBlob* err    = nullptr;

    HRESULT hr = D3DCompile(kShaderSrc, strlen(kShaderSrc), "overlay", nullptr, nullptr,
                            "VS", "vs_4_0", 0, 0, &vsBlob, &err);
    if (FAILED(hr)) {
        if (err) { OutputDebugStringA((char*)err->GetBufferPointer()); err->Release(); }
        cleanup();
        return false;
    }
    hr = D3DCompile(kShaderSrc, strlen(kShaderSrc), "overlay", nullptr, nullptr,
                    "PS", "ps_4_0", 0, 0, &psBlob, &err);
    if (FAILED(hr)) {
        if (err) { OutputDebugStringA((char*)err->GetBufferPointer()); err->Release(); }
        vsBlob->Release();
        cleanup();
        return false;
    }

    dev->CreateVertexShader(vsBlob->GetBufferPointer(), vsBlob->GetBufferSize(), nullptr, &g_vs);
    dev->CreatePixelShader(psBlob->GetBufferPointer(), psBlob->GetBufferSize(), nullptr, &g_ps);
    vsBlob->Release();
    psBlob->Release();

    OutputDebugStringA("[UC-D3D11] Renderer initialized.\n");
    return true;
}

// Snapshot of every pipeline binding we touch. Restored after our draw so
// the game's frame is unaffected.
namespace {
struct SavedState {
    UINT scissorCount = 0;
    D3D11_RECT scissors[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE]{};
    UINT viewportCount = 0;
    D3D11_VIEWPORT viewports[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE]{};
    ID3D11RasterizerState* rs = nullptr;
    ID3D11BlendState* blend = nullptr;
    FLOAT blendFactor[4]{};
    UINT blendMask = 0;
    ID3D11DepthStencilState* dss = nullptr;
    UINT stencilRef = 0;
    ID3D11ShaderResourceView* psSRV = nullptr;
    ID3D11SamplerState* psSampler = nullptr;
    ID3D11PixelShader* ps = nullptr;
    ID3D11VertexShader* vs = nullptr;
    ID3D11ClassInstance* psInst[256]{};
    UINT psInstCount = 256;
    ID3D11ClassInstance* vsInst[256]{};
    UINT vsInstCount = 256;
    D3D11_PRIMITIVE_TOPOLOGY topology = D3D11_PRIMITIVE_TOPOLOGY_UNDEFINED;
    ID3D11Buffer* ib = nullptr;
    DXGI_FORMAT ibFormat = DXGI_FORMAT_UNKNOWN;
    UINT ibOffset = 0;
    ID3D11Buffer* vb = nullptr;
    UINT vbStride = 0;
    UINT vbOffset = 0;
    ID3D11InputLayout* layout = nullptr;
    ID3D11RenderTargetView* rtvs[D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT]{};
    ID3D11DepthStencilView* dsv = nullptr;
};

void capture(ID3D11DeviceContext* ctx, SavedState& s) {
    s.scissorCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
    ctx->RSGetScissorRects(&s.scissorCount, s.scissors);
    s.viewportCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;
    ctx->RSGetViewports(&s.viewportCount, s.viewports);
    ctx->RSGetState(&s.rs);
    ctx->OMGetBlendState(&s.blend, s.blendFactor, &s.blendMask);
    ctx->OMGetDepthStencilState(&s.dss, &s.stencilRef);
    ctx->PSGetShaderResources(0, 1, &s.psSRV);
    ctx->PSGetSamplers(0, 1, &s.psSampler);
    ctx->PSGetShader(&s.ps, s.psInst, &s.psInstCount);
    ctx->VSGetShader(&s.vs, s.vsInst, &s.vsInstCount);
    ctx->IAGetPrimitiveTopology(&s.topology);
    ctx->IAGetIndexBuffer(&s.ib, &s.ibFormat, &s.ibOffset);
    ctx->IAGetVertexBuffers(0, 1, &s.vb, &s.vbStride, &s.vbOffset);
    ctx->IAGetInputLayout(&s.layout);
    ctx->OMGetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT, s.rtvs, &s.dsv);
}

void restore(ID3D11DeviceContext* ctx, SavedState& s) {
    ctx->RSSetScissorRects(s.scissorCount, s.scissors);
    ctx->RSSetViewports(s.viewportCount, s.viewports);
    ctx->RSSetState(s.rs);
    ctx->OMSetBlendState(s.blend, s.blendFactor, s.blendMask);
    ctx->OMSetDepthStencilState(s.dss, s.stencilRef);
    ctx->PSSetShaderResources(0, 1, &s.psSRV);
    ctx->PSSetSamplers(0, 1, &s.psSampler);
    ctx->PSSetShader(s.ps, s.psInst, s.psInstCount);
    ctx->VSSetShader(s.vs, s.vsInst, s.vsInstCount);
    ctx->IASetPrimitiveTopology(s.topology);
    ctx->IASetIndexBuffer(s.ib, s.ibFormat, s.ibOffset);
    ctx->IASetVertexBuffers(0, 1, &s.vb, &s.vbStride, &s.vbOffset);
    ctx->IASetInputLayout(s.layout);
    ctx->OMSetRenderTargets(D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT, s.rtvs, s.dsv);

    auto rel = [](IUnknown* p) { if (p) p->Release(); };
    rel(s.rs);
    rel(s.blend);
    rel(s.dss);
    rel(s.psSRV);
    rel(s.psSampler);
    rel(s.ps);
    rel(s.vs);
    for (UINT i = 0; i < s.psInstCount; ++i) rel(s.psInst[i]);
    for (UINT i = 0; i < s.vsInstCount; ++i) rel(s.vsInst[i]);
    rel(s.ib);
    rel(s.vb);
    rel(s.layout);
    for (UINT i = 0; i < D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT; ++i) rel(s.rtvs[i]);
    rel(s.dsv);
}
} // namespace

void render(ID3D11DeviceContext* ctx, IDXGISwapChain* pSwap) {
    const auto* hdr = uc_shmem::header();
    if (!hdr || !hdr->visible) return;
    const uint8_t* px = uc_shmem::pixels();
    if (!px || !g_tex) return;

    // Upload pixels if frame changed
    if (hdr->seq != g_lastSeq) {
        D3D11_MAPPED_SUBRESOURCE mapped{};
        if (SUCCEEDED(ctx->Map(g_tex, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped))) {
            const uint32_t srcPitch = g_texW * 4;
            for (uint32_t y = 0; y < g_texH; ++y) {
                memcpy((uint8_t*)mapped.pData + y * mapped.RowPitch,
                       px + y * srcPitch, srcPitch);
            }
            ctx->Unmap(g_tex, 0);
            g_lastSeq = hdr->seq;
        }
    }

    ID3D11Texture2D* backBuf = nullptr;
    if (FAILED(pSwap->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&backBuf)) || !backBuf) return;

    D3D11_TEXTURE2D_DESC bbDesc{};
    backBuf->GetDesc(&bbDesc);

    ID3D11RenderTargetView* rtv = nullptr;
    if (FAILED(g_device->CreateRenderTargetView(backBuf, nullptr, &rtv)) || !rtv) {
        backBuf->Release();
        return;
    }
    backBuf->Release();

    SavedState saved;
    capture(ctx, saved);

    ctx->OMSetRenderTargets(1, &rtv, nullptr);
    const float blendFactor[4] = { 0, 0, 0, 0 };
    ctx->OMSetBlendState(g_blend, blendFactor, 0xFFFFFFFF);
    ctx->OMSetDepthStencilState(g_dss, 0);
    ctx->RSSetState(g_raster);
    D3D11_VIEWPORT vp{ 0, 0, (float)bbDesc.Width, (float)bbDesc.Height, 0, 1 };
    ctx->RSSetViewports(1, &vp);
    D3D11_RECT noScissor{ 0, 0, (LONG)bbDesc.Width, (LONG)bbDesc.Height };
    ctx->RSSetScissorRects(1, &noScissor);
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->IASetInputLayout(nullptr);
    ID3D11Buffer* nullVB = nullptr;
    UINT zero = 0;
    ctx->IASetVertexBuffers(0, 1, &nullVB, &zero, &zero);
    ctx->IASetIndexBuffer(nullptr, DXGI_FORMAT_UNKNOWN, 0);
    ctx->VSSetShader(g_vs, nullptr, 0);
    ctx->PSSetShader(g_ps, nullptr, 0);
    ctx->PSSetShaderResources(0, 1, &g_srv);
    ctx->PSSetSamplers(0, 1, &g_sampler);

    ctx->Draw(3, 0);

    rtv->Release();

    restore(ctx, saved);
}

// Called from the DXGI ResizeBuffers hook: backbuffer is about to be
// recreated so any RTV/cached backbuffer-sized resource we kept would
// dangle. We only created the SRV on our own upload texture, no per-frame
// state is held across present, so there's nothing to free here besides
// resetting the upload sequence so the next frame re-uploads pixels.
void onResize() {
    g_lastSeq = 0;
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
    safeRelease(&g_device);
    g_texW = g_texH = g_lastSeq = 0;
}

} // namespace uc_d3d11_renderer
