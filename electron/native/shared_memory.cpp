/**
 * Shared Memory Manager - creates and writes to shared memory regions
 * that the injected DLL reads from.
 *
 * Memory layout (matches overlay_protocol.h):
 *   UCFrameHeader (32 bytes) + BGRA pixel data (width * height * 4)
 *
 * Naming convention: "uc-direct-frame-{pid}"
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <napi.h>
#include <string>
#include <unordered_map>
#include <cstring>

// Mirror of overlay_protocol.h UCFrameHeader
#pragma pack(push, 1)
struct UCFrameHeader {
    uint32_t magic;     // 0x55434F56  "UCOV"
    uint32_t width;
    uint32_t height;
    uint32_t visible;
    uint32_t seq;
    uint32_t reserved[3];
};
#pragma pack(pop)

static const uint32_t UC_FRAME_MAGIC = 0x55434F56;

namespace uc_shmem {

struct SharedFrame {
    HANDLE hMapping;
    uint8_t* pView;
    uint32_t width;
    uint32_t height;
    uint32_t totalSize;
    uint32_t seq;
};

static std::unordered_map<uint32_t, SharedFrame> g_frames; // key = handle id
static uint32_t g_nextHandle = 1;

/**
 * createSharedFrame(pid: number, width: number, height: number): number
 *
 * Creates a named shared memory region for the given pid.
 * Returns a handle ID (number) for use with writeSharedFrame/destroySharedFrame.
 */
Napi::Value CreateSharedFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (pid: number, width: number, height: number)").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t pid = info[0].As<Napi::Number>().Uint32Value();
    uint32_t width = info[1].As<Napi::Number>().Uint32Value();
    uint32_t height = info[2].As<Napi::Number>().Uint32Value();

    if (width == 0 || height == 0 || width > 7680 || height > 4320) {
        Napi::Error::New(env, "Invalid dimensions").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t pixelBytes = width * height * 4;
    uint32_t totalSize = sizeof(UCFrameHeader) + pixelBytes;

    std::string name = "uc-direct-frame-" + std::to_string(pid);

    HANDLE hMapping = CreateFileMappingA(
        INVALID_HANDLE_VALUE, nullptr,
        PAGE_READWRITE, 0, totalSize,
        name.c_str()
    );

    if (!hMapping) {
        Napi::Error::New(env, "CreateFileMapping failed").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint8_t* pView = (uint8_t*)MapViewOfFile(hMapping, FILE_MAP_ALL_ACCESS, 0, 0, totalSize);
    if (!pView) {
        CloseHandle(hMapping);
        Napi::Error::New(env, "MapViewOfFile failed").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Initialize header
    memset(pView, 0, totalSize);
    auto* hdr = (UCFrameHeader*)pView;
    hdr->magic = UC_FRAME_MAGIC;
    hdr->width = width;
    hdr->height = height;
    hdr->visible = 0;
    hdr->seq = 0;

    uint32_t handleId = g_nextHandle++;
    g_frames[handleId] = { hMapping, pView, width, height, totalSize, 0 };

    return Napi::Number::New(env, handleId);
}

/**
 * writeSharedFrame(handle: number, buffer: Buffer, visible: boolean): void
 *
 * Writes BGRA pixel data from the buffer into shared memory and updates
 * the header with the new sequence number and visibility flag.
 */
Napi::Value WriteSharedFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsBuffer() || !info[2].IsBoolean()) {
        Napi::TypeError::New(env, "Expected (handle: number, buffer: Buffer, visible: boolean)").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t handleId = info[0].As<Napi::Number>().Uint32Value();
    auto buffer = info[1].As<Napi::Buffer<uint8_t>>();
    bool visible = info[2].As<Napi::Boolean>().Value();

    auto it = g_frames.find(handleId);
    if (it == g_frames.end()) {
        Napi::Error::New(env, "Invalid shared frame handle").ThrowAsJavaScriptException();
        return env.Null();
    }

    auto& frame = it->second;
    uint32_t pixelBytes = frame.width * frame.height * 4;

    if (buffer.Length() < pixelBytes) {
        Napi::Error::New(env, "Buffer too small for frame dimensions").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Copy pixel data
    memcpy(frame.pView + sizeof(UCFrameHeader), buffer.Data(), pixelBytes);

    // Update header (atomic-ish - seq last to signal completion)
    auto* hdr = (UCFrameHeader*)frame.pView;
    hdr->visible = visible ? 1 : 0;
    MemoryBarrier();
    hdr->seq = ++frame.seq;

    return env.Undefined();
}

/**
 * destroySharedFrame(handle: number): void
 */
Napi::Value DestroySharedFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (handle: number)").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t handleId = info[0].As<Napi::Number>().Uint32Value();
    auto it = g_frames.find(handleId);
    if (it != g_frames.end()) {
        if (it->second.pView) UnmapViewOfFile(it->second.pView);
        if (it->second.hMapping) CloseHandle(it->second.hMapping);
        g_frames.erase(it);
    }

    return env.Undefined();
}

} // namespace uc_shmem
