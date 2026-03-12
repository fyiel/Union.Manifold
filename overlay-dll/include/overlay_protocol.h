#pragma once
/**
 * UC Overlay Protocol - shared between DLL (injected into game) and Node addon (Electron side).
 *
 * Communication channels:
 *   1. Shared Memory: Electron renders the overlay UI offscreen → writes BGRA pixels here.
 *      The DLL reads these pixels in its Present hook and composites them onto the game frame.
 *
 *   2. Named Pipe: bidirectional JSON-line messages for commands and events.
 *      Pipe name: \\.\pipe\uc-direct-overlay-{pid}
 *      Shared memory name: uc-direct-frame-{pid}
 */

#include <cstdint>

// Magic value identifying a valid frame header: 'UCOV' in little-endian
#define UC_FRAME_MAGIC 0x564F4355u

// Maximum overlay resolution (capped to prevent excessive memory)
#define UC_MAX_OVERLAY_WIDTH  3840
#define UC_MAX_OVERLAY_HEIGHT 2160

#pragma pack(push, 1)
struct UCFrameHeader {
    uint32_t magic;        // Must be UC_FRAME_MAGIC
    uint32_t width;        // Overlay width in pixels
    uint32_t height;       // Overlay height in pixels
    uint32_t visible;      // 1 = draw overlay, 0 = hidden
    uint32_t seq;          // Incremented by Electron each frame write
    uint32_t reserved[3];  // Future use (padding to 32 bytes)
};
#pragma pack(pop)

// Total shared memory size = header + width * height * 4 (BGRA)
inline uint64_t ucFrameMemorySize(uint32_t w, uint32_t h) {
    return sizeof(UCFrameHeader) + (uint64_t)w * h * 4;
}

// --- Named Pipe JSON Commands (Electron → DLL) ---
// {"cmd":"show"}          - make the DLL start drawing
// {"cmd":"hide"}          - stop drawing
// {"cmd":"ping"}          - heartbeat check
// {"cmd":"shutdown"}      - graceful cleanup and unhook

// --- Named Pipe JSON Events (DLL → Electron) ---
// {"event":"connected","api":"d3d11"}   - DLL hooked successfully, reports graphics API
// {"event":"disconnected"}              - DLL shutting down
// {"event":"input_key","key":"Escape","down":true,"ctrl":false,"shift":false,"alt":false}
// {"event":"input_mouse","x":123,"y":456,"button":"left","down":true}
// {"event":"exclusive_fullscreen","active":true}

#ifdef __cplusplus
namespace uc {
    // Helper to build the pipe name for a given PID
    inline void getPipeName(char* buf, size_t bufLen, uint32_t pid) {
        snprintf(buf, bufLen, "\\\\.\\pipe\\uc-direct-overlay-%u", pid);
    }
    // Helper to build the shared memory name for a given PID
    inline void getSharedMemoryName(char* buf, size_t bufLen, uint32_t pid) {
        snprintf(buf, bufLen, "uc-direct-frame-%u", pid);
    }
}
#endif
