/**
 * Named Pipe Server - Electron side.
 *
 * Creates a named pipe server (\\.\pipe\uc-direct-overlay-{pid}) that the
 * injected DLL connects to.
 *
 * Protocol: newline-delimited JSON in both directions (documented in overlay_protocol.h).
 *
 * DLL → Electron events:
 *   {"event":"connected","api":"d3d11"}
 *   {"event":"disconnected"}
 *   {"event":"input_key","key":"Escape","down":true,"ctrl":false,"shift":false,"alt":false}
 *   {"event":"input_mouse","x":123,"y":456,"button":"left","down":true}
 *   {"event":"input_mousemove","x":123,"y":456}
 *
 * Electron → DLL commands:
 *   {"cmd":"show"}\n
 *   {"cmd":"hide"}\n
 *   {"cmd":"shutdown"}\n
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <napi.h>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>
#include <vector>
#include <cstring>

namespace uc_pipe {

struct PipeServer {
    HANDLE hPipe;
    std::thread listenThread;
    std::atomic<bool> running;
    Napi::ThreadSafeFunction tsfn;
    uint32_t pid;
};

static std::unordered_map<uint32_t, PipeServer*> g_servers;
static uint32_t g_nextHandle = 1;

// ---- Minimal JSON field extractors (no dependencies) ----

static std::string extractStr(const std::string& json, const char* key) {
    std::string pat = std::string("\"") + key + "\":\"";
    size_t pos = json.find(pat);
    if (pos == std::string::npos) return {};
    pos += pat.size();
    size_t end = json.find('"', pos);
    if (end == std::string::npos) return {};
    return json.substr(pos, end - pos);
}

static bool extractBool(const std::string& json, const char* key) {
    std::string pat = std::string("\"") + key + "\":true";
    return json.find(pat) != std::string::npos;
}

static int extractInt(const std::string& json, const char* key) {
    std::string pat = std::string("\"") + key + "\":";
    size_t pos = json.find(pat);
    if (pos == std::string::npos) return 0;
    pos += pat.size();
    if (pos >= json.size()) return 0;
    try { return std::stoi(json.substr(pos)); } catch (...) { return 0; }
}

// ---- Dispatch a parsed JSON line to the JS callback ----

static void dispatchLine(const std::string& line, PipeServer* srv) {
    std::string event = extractStr(line, "event");
    if (event.empty()) return;

    // Capture values by value for the lambda
    std::string evt      = std::move(event);
    std::string keyName  = extractStr(line, "key");
    std::string button   = extractStr(line, "button");
    bool        keyDown  = extractBool(line, "down");
    int         mx       = extractInt(line, "x");
    int         my       = extractInt(line, "y");

    srv->tsfn.NonBlockingCall(
        [evt, keyName, button, keyDown, mx, my]
        (Napi::Env env, Napi::Function cb) {
            Napi::Object msg = Napi::Object::New(env);

            if (evt == "connected") {
                msg.Set("type", Napi::String::New(env, "connected"));

            } else if (evt == "disconnected") {
                msg.Set("type", Napi::String::New(env, "disconnected"));

            } else if (evt == "input_key") {
                msg.Set("type", Napi::String::New(env, "key"));
                msg.Set("down", Napi::Boolean::New(env, keyDown));
                msg.Set("key",  Napi::String::New(env, keyName));

            } else if (evt == "input_mouse") {
                // clickType: 0 = button down, 1 = button up  (matches handleDllMessage)
                int btnCode = (button == "right") ? 1 : (button == "middle") ? 2 : 0;
                msg.Set("type",      Napi::String::New(env, "mouseClick"));
                msg.Set("clickType", Napi::Number::New(env, keyDown ? 0 : 1));
                msg.Set("x",         Napi::Number::New(env, mx));
                msg.Set("y",         Napi::Number::New(env, my));
                msg.Set("button",    Napi::Number::New(env, btnCode));

            } else if (evt == "input_mousemove") {
                msg.Set("type", Napi::String::New(env, "mouseMove"));
                msg.Set("x",    Napi::Number::New(env, mx));
                msg.Set("y",    Napi::Number::New(env, my));

            } else {
                return; // unknown event, skip callback
            }

            cb.Call({ msg });
        }
    );
}

// ---- Pipe listen loop (runs on its own thread) ----

static void pipeListenLoop(PipeServer* srv) {
    BOOL connected = ConnectNamedPipe(srv->hPipe, nullptr)
                         ? TRUE
                         : (GetLastError() == ERROR_PIPE_CONNECTED ? TRUE : FALSE);
    if (!connected) {
        srv->running = false;
        return;
    }

    std::string buf;
    buf.reserve(1024);
    char chunk[4096];

    while (srv->running) {
        DWORD bytesRead = 0;
        BOOL ok = ReadFile(srv->hPipe, chunk, sizeof(chunk) - 1, &bytesRead, nullptr);

        if (!ok || bytesRead == 0) {
            DWORD err = GetLastError();
            if (err == ERROR_BROKEN_PIPE || err == ERROR_PIPE_NOT_CONNECTED) break;
            Sleep(1);
            continue;
        }

        chunk[bytesRead] = '\0';
        buf.append(chunk, bytesRead);

        // Guard against a runaway buffer with no newlines
        if (buf.size() > 16384) buf.clear();

        size_t pos;
        while ((pos = buf.find('\n')) != std::string::npos) {
            std::string line = buf.substr(0, pos);
            buf.erase(0, pos + 1);
            // Trim CR if present (Windows line endings)
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty()) dispatchLine(line, srv);
        }
    }

    srv->running = false;
}

/**
 * createPipeServer(pid: number, callback: (msg: object) => void): number
 */
Napi::Value CreatePipeServer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "Expected (pid: number, callback: Function)").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t pid = info[0].As<Napi::Number>().Uint32Value();
    Napi::Function callback = info[1].As<Napi::Function>();

    std::string pipeName = "\\\\.\\pipe\\uc-direct-overlay-" + std::to_string(pid);

    HANDLE hPipe = CreateNamedPipeA(
        pipeName.c_str(),
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        1,       // max instances
        4096,    // out buffer
        4096,    // in buffer
        0,       // default timeout
        nullptr  // default security
    );

    if (hPipe == INVALID_HANDLE_VALUE) {
        Napi::Error::New(env, "CreateNamedPipe failed: " + std::to_string(GetLastError()))
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    auto* srv = new PipeServer();
    srv->hPipe   = hPipe;
    srv->running = true;
    srv->pid     = pid;
    srv->tsfn    = Napi::ThreadSafeFunction::New(env, callback, "UCOverlayPipe", 0, 1);
    srv->listenThread = std::thread(pipeListenLoop, srv);

    uint32_t handleId = g_nextHandle++;
    g_servers[handleId] = srv;

    return Napi::Number::New(env, handleId);
}

/**
 * sendPipeMessage(handle: number, data: Buffer): void
 *
 * Writes raw bytes to the connected DLL client.
 * Callers should send newline-terminated JSON, e.g.:
 *   Buffer.from('{"cmd":"show"}\n')
 */
Napi::Value SendPipeMessage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBuffer()) {
        Napi::TypeError::New(env, "Expected (handle: number, data: Buffer)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t handleId = info[0].As<Napi::Number>().Uint32Value();
    auto buffer = info[1].As<Napi::Buffer<uint8_t>>();

    auto it = g_servers.find(handleId);
    if (it == g_servers.end() || !it->second->running) return env.Undefined();

    DWORD written = 0;
    WriteFile(it->second->hPipe, buffer.Data(), (DWORD)buffer.Length(), &written, nullptr);

    return env.Undefined();
}

/**
 * destroyPipeServer(handle: number): void
 */
Napi::Value DestroyPipeServer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected (handle: number)").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t handleId = info[0].As<Napi::Number>().Uint32Value();
    auto it = g_servers.find(handleId);
    if (it != g_servers.end()) {
        auto* srv = it->second;
        srv->running = false;
        DisconnectNamedPipe(srv->hPipe);
        CloseHandle(srv->hPipe);
        if (srv->listenThread.joinable()) srv->listenThread.join();
        srv->tsfn.Release();
        delete srv;
        g_servers.erase(it);
    }

    return env.Undefined();
}

} // namespace uc_pipe
