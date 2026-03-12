/**
 * Shared Memory Frame Reader - runs inside the injected DLL.
 * Opens the shared memory created by the Node addon (uc-direct-frame-{pid})
 * and maps it read-only. The graphics hooks read pixels from here.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <cstdio>

#include "overlay_protocol.h"

namespace uc_shmem {

static HANDLE g_hMapFile = nullptr;
static void* g_pMapped = nullptr;
static size_t g_mapSize = 0;

bool open(uint32_t pid) {
    char name[256];
    uc::getSharedMemoryName(name, sizeof(name), pid);

    g_hMapFile = OpenFileMappingA(FILE_MAP_READ, FALSE, name);
    if (!g_hMapFile) {
        char msg[256];
        snprintf(msg, sizeof(msg), "[UC-SHMEM] OpenFileMapping failed for '%s' (err=%lu)\n", name, GetLastError());
        OutputDebugStringA(msg);
        return false;
    }

    // Map just the header first to read dimensions
    void* headerView = MapViewOfFile(g_hMapFile, FILE_MAP_READ, 0, 0, sizeof(UCFrameHeader));
    if (!headerView) {
        CloseHandle(g_hMapFile);
        g_hMapFile = nullptr;
        return false;
    }

    const auto* hdr = reinterpret_cast<const UCFrameHeader*>(headerView);
    if (hdr->magic != UC_FRAME_MAGIC || hdr->width == 0 || hdr->height == 0 ||
        hdr->width > UC_MAX_OVERLAY_WIDTH || hdr->height > UC_MAX_OVERLAY_HEIGHT) {
        UnmapViewOfFile(headerView);
        CloseHandle(g_hMapFile);
        g_hMapFile = nullptr;
        return false;
    }

    g_mapSize = (size_t)ucFrameMemorySize(hdr->width, hdr->height);
    UnmapViewOfFile(headerView);

    // Remap with full size
    g_pMapped = MapViewOfFile(g_hMapFile, FILE_MAP_READ, 0, 0, g_mapSize);
    if (!g_pMapped) {
        CloseHandle(g_hMapFile);
        g_hMapFile = nullptr;
        return false;
    }

    OutputDebugStringA("[UC-SHMEM] Shared memory mapped successfully.\n");
    return true;
}

void close() {
    if (g_pMapped) {
        UnmapViewOfFile(g_pMapped);
        g_pMapped = nullptr;
    }
    if (g_hMapFile) {
        CloseHandle(g_hMapFile);
        g_hMapFile = nullptr;
    }
    g_mapSize = 0;
}

const UCFrameHeader* header() {
    if (!g_pMapped) return nullptr;
    return reinterpret_cast<const UCFrameHeader*>(g_pMapped);
}

const uint8_t* pixels() {
    if (!g_pMapped) return nullptr;
    return reinterpret_cast<const uint8_t*>(g_pMapped) + sizeof(UCFrameHeader);
}

} // namespace uc_shmem
