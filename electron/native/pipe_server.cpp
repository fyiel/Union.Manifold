/**
 * Named Pipe Server - Electron side.
 *
 * Creates a named pipe server (\\.\pipe\uc-direct-overlay-{pid}) that the
 * injected DLL connects to. Messages from the DLL are forwarded to a JS
 * callback via ThreadSafeFunction.
 *
 * Protocol (simple binary):
 *   [1 byte type] [2 byte payload length] [payload bytes]
 *
 * Message types (as defined in overlay_protocol.h):
 *   0x01 = connected       (no payload)
 *   0x02 = key event       (payload: 1b down + NUL-terminated key name)
 *   0x03 = mouse event     (payload: 1b type + 2b x + 2b y + 1b button)
 *   0x04 = mouse move      (payload: 2b x + 2b y)
 */

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <Windows.h>
#include <napi.h>
#include <string>
#include <thread>
#include <atomic>
#include <unordered_map>
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

static void pipeListenLoop(PipeServer* srv) {
    // Wait for client connection
    BOOL connected = ConnectNamedPipe(srv->hPipe, nullptr)
                         ? TRUE
                         : (GetLastError() == ERROR_PIPE_CONNECTED ? TRUE : FALSE);

    if (!connected) {
        srv->running = false;
        return;
    }

    uint8_t buf[4096];
    while (srv->running) {
        DWORD bytesRead = 0;
        BOOL ok = ReadFile(srv->hPipe, buf, sizeof(buf), &bytesRead, nullptr);

        if (!ok || bytesRead == 0) {
            DWORD err = GetLastError();
            if (err == ERROR_BROKEN_PIPE || err == ERROR_PIPE_NOT_CONNECTED) break;
            Sleep(1);
            continue;
        }

        // Parse messages from the buffer
        size_t offset = 0;
        while (offset + 3 <= bytesRead) {
            uint8_t type = buf[offset];
            uint16_t payloadLen = *(uint16_t*)(buf + offset + 1);

            if (offset + 3 + payloadLen > bytesRead) break;

            // Copy message data for the callback
            uint8_t msgType = type;
            std::vector<uint8_t> payload(buf + offset + 3, buf + offset + 3 + payloadLen);

            srv->tsfn.BlockingCall([msgType, payload = std::move(payload)](Napi::Env env, Napi::Function jsCallback) {
                Napi::Object msg = Napi::Object::New(env);

                switch (msgType) {
                case 0x01: // connected
                    msg.Set("type", Napi::String::New(env, "connected"));
                    break;

                case 0x02: { // key event
                    msg.Set("type", Napi::String::New(env, "key"));
                    if (payload.size() >= 2) {
                        msg.Set("down", Napi::Boolean::New(env, payload[0] != 0));
                        std::string keyName((char*)payload.data() + 1,
                                            strnlen((char*)payload.data() + 1, payload.size() - 1));
                        msg.Set("key", Napi::String::New(env, keyName));
                    }
                    break;
                }

                case 0x03: { // mouse click
                    msg.Set("type", Napi::String::New(env, "mouseClick"));
                    if (payload.size() >= 6) {
                        msg.Set("clickType", Napi::Number::New(env, payload[0])); // 0=down, 1=up
                        int16_t x = *(int16_t*)(payload.data() + 1);
                        int16_t y = *(int16_t*)(payload.data() + 3);
                        msg.Set("x", Napi::Number::New(env, x));
                        msg.Set("y", Napi::Number::New(env, y));
                        msg.Set("button", Napi::Number::New(env, payload[5]));
                    }
                    break;
                }

                case 0x04: { // mouse move
                    msg.Set("type", Napi::String::New(env, "mouseMove"));
                    if (payload.size() >= 4) {
                        int16_t x = *(int16_t*)(payload.data());
                        int16_t y = *(int16_t*)(payload.data() + 2);
                        msg.Set("x", Napi::Number::New(env, x));
                        msg.Set("y", Napi::Number::New(env, y));
                    }
                    break;
                }

                default:
                    msg.Set("type", Napi::String::New(env, "unknown"));
                    msg.Set("code", Napi::Number::New(env, msgType));
                    break;
                }

                jsCallback.Call({ msg });
            });

            offset += 3 + payloadLen;
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
        1,        // max instances
        4096,     // out buffer
        4096,     // in buffer
        0,        // default timeout
        nullptr   // default security
    );

    if (hPipe == INVALID_HANDLE_VALUE) {
        Napi::Error::New(env, "CreateNamedPipe failed: " + std::to_string(GetLastError())).ThrowAsJavaScriptException();
        return env.Null();
    }

    auto* srv = new PipeServer();
    srv->hPipe = hPipe;
    srv->running = true;
    srv->pid = pid;
    srv->tsfn = Napi::ThreadSafeFunction::New(env, callback, "UCOverlayPipe", 0, 1);

    srv->listenThread = std::thread(pipeListenLoop, srv);

    uint32_t handleId = g_nextHandle++;
    g_servers[handleId] = srv;

    return Napi::Number::New(env, handleId);
}

/**
 * sendPipeMessage(handle: number, data: Buffer): void
 *
 * Sends raw bytes to the connected DLL client.
 */
Napi::Value SendPipeMessage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBuffer()) {
        Napi::TypeError::New(env, "Expected (handle: number, data: Buffer)").ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t handleId = info[0].As<Napi::Number>().Uint32Value();
    auto buffer = info[1].As<Napi::Buffer<uint8_t>>();

    auto it = g_servers.find(handleId);
    if (it == g_servers.end() || !it->second->running) {
        return env.Undefined();
    }

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

        // Disconnect pipe to unblock ReadFile
        DisconnectNamedPipe(srv->hPipe);
        CloseHandle(srv->hPipe);

        if (srv->listenThread.joinable()) {
            srv->listenThread.join();
        }
        srv->tsfn.Release();

        delete srv;
        g_servers.erase(it);
    }

    return env.Undefined();
}

} // namespace uc_pipe
