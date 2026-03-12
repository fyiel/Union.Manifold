/**
 * Named Pipe IPC Client - runs inside the injected DLL.
 * Connects to \\.\pipe\uc-direct-overlay-{pid} (created by the Node addon on the Electron side).
 * Protocol: newline-delimited JSON messages in both directions.
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <string>

#include "overlay_protocol.h"

extern std::atomic<bool> g_running; // defined in dllmain.cpp

namespace uc_ipc {

static HANDLE g_pipe = INVALID_HANDLE_VALUE;
static char g_readBuf[4096];
static int g_readPos = 0;

bool init(uint32_t pid) {
    char pipeName[256];
    uc::getPipeName(pipeName, sizeof(pipeName), pid);

    // Try connecting with retries
    for (int attempt = 0; attempt < 20; ++attempt) {
        g_pipe = CreateFileA(
            pipeName,
            GENERIC_READ | GENERIC_WRITE,
            0, nullptr,
            OPEN_EXISTING,
            0, nullptr
        );
        if (g_pipe != INVALID_HANDLE_VALUE) break;
        Sleep(250);
    }

    if (g_pipe == INVALID_HANDLE_VALUE) {
        OutputDebugStringA("[UC-IPC] Failed to connect to pipe.\n");
        return false;
    }

    // Set pipe to non-blocking (message mode)
    DWORD pipeMode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
    SetNamedPipeHandleState(g_pipe, &pipeMode, nullptr, nullptr);

    OutputDebugStringA("[UC-IPC] Connected to Electron pipe.\n");
    return true;
}

void shutdown() {
    if (g_pipe != INVALID_HANDLE_VALUE) {
        // Send disconnect event
        const char* msg = "{\"event\":\"disconnected\"}\n";
        DWORD written;
        WriteFile(g_pipe, msg, (DWORD)strlen(msg), &written, nullptr);
        CloseHandle(g_pipe);
        g_pipe = INVALID_HANDLE_VALUE;
    }
}

// Send a JSON message to Electron
bool send(const char* json) {
    if (g_pipe == INVALID_HANDLE_VALUE) return false;
    std::string msg(json);
    msg += '\n';
    DWORD written;
    return WriteFile(g_pipe, msg.c_str(), (DWORD)msg.size(), &written, nullptr) != 0;
}

// Send connected event with the API that was hooked
void sendConnected(const char* api) {
    char buf[256];
    snprintf(buf, sizeof(buf), "{\"event\":\"connected\",\"api\":\"%s\"}", api);
    send(buf);
}

// Send an input event (key or mouse) to Electron for forwarding to the offscreen window
void sendKeyEvent(const char* key, bool down, bool ctrl, bool shift, bool alt) {
    char buf[512];
    snprintf(buf, sizeof(buf),
        "{\"event\":\"input_key\",\"key\":\"%s\",\"down\":%s,\"ctrl\":%s,\"shift\":%s,\"alt\":%s}",
        key, down ? "true" : "false", ctrl ? "true" : "false",
        shift ? "true" : "false", alt ? "true" : "false");
    send(buf);
}

void sendMouseEvent(int x, int y, const char* button, bool down) {
    char buf[256];
    snprintf(buf, sizeof(buf),
        "{\"event\":\"input_mouse\",\"x\":%d,\"y\":%d,\"button\":\"%s\",\"down\":%s}",
        x, y, button, down ? "true" : "false");
    send(buf);
}

void sendMouseMove(int x, int y) {
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"event\":\"input_mousemove\",\"x\":%d,\"y\":%d}", x, y);
    send(buf);
}

// Process incoming messages from Electron (non-blocking)
void pumpMessages() {
    if (g_pipe == INVALID_HANDLE_VALUE) return;

    DWORD available = 0;
    if (!PeekNamedPipe(g_pipe, nullptr, 0, nullptr, &available, nullptr) || available == 0)
        return;

    DWORD bytesRead = 0;
    int space = (int)sizeof(g_readBuf) - g_readPos - 1;
    if (space <= 0) { g_readPos = 0; return; } // overflow guard

    if (!ReadFile(g_pipe, g_readBuf + g_readPos, (DWORD)space, &bytesRead, nullptr) || bytesRead == 0)
        return;

    g_readPos += (int)bytesRead;
    g_readBuf[g_readPos] = '\0';

    // Process complete lines
    char* start = g_readBuf;
    while (char* nl = strchr(start, '\n')) {
        *nl = '\0';
        // Parse command (simple string matching - no JSON lib needed for our tiny protocol)
        if (strstr(start, "\"cmd\":\"shutdown\"")) {
            ::g_running = false;
        }
        // "show" and "hide" are handled via shared memory visibility flag (more responsive)
        start = nl + 1;
    }

    // Move remaining partial data to front
    int remaining = g_readPos - (int)(start - g_readBuf);
    if (remaining > 0) {
        memmove(g_readBuf, start, remaining);
    }
    g_readPos = remaining;
}

} // namespace uc_ipc
