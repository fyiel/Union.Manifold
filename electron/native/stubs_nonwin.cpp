/**
 * stubs_nonwin.cpp — Windows-only features stubbed out for macOS (and non-Windows posix).
 *
 * These APIs require Windows-specific kernel features:
 * - DLL injection / shared memory overlays (in-progress games)
 * - Named pipe server for IPC with injected payloads
 * - Inject/eject control surfaces
 *
 * GCPad functions are NOT stubbed here — they are implemented in
 * gcpad_bridge_posix.cpp for Linux. If this file is included on Linux,
 * it will cause duplicate symbol errors (addon.cpp expects exactly one
 * implementation per namespace).
 */

#include <napi.h>

namespace {
Napi::Value Unsupported(const Napi::Env& env, const char* feature) {
    Napi::Error::New(env, std::string(feature) + " is only supported on Windows").ThrowAsJavaScriptException();
    return env.Null();
}
} // namespace

namespace uc_injector {
Napi::Value InjectDll(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "injectDll");
}

Napi::Value EjectDll(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "ejectDll");
}
} // namespace uc_injector

namespace uc_shmem {
Napi::Value CreateSharedFrame(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "createSharedFrame");
}

Napi::Value WriteSharedFrame(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "writeSharedFrame");
}

Napi::Value DestroySharedFrame(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "destroySharedFrame");
}
} // namespace uc_shmem

namespace uc_pipe {
Napi::Value CreatePipeServer(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "createPipeServer");
}

Napi::Value SendPipeMessage(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "sendPipeMessage");
}

Napi::Value DestroyPipeServer(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "destroyPipeServer");
}
} // namespace uc_pipe

// NOTE: GCPad functions are NOT provided here for Linux (they are in gcpad_bridge_posix.cpp).
// If this file IS included on Linux, we'd get duplicate symbols. The binding.gyp ensures
// that for OS=='linux', only gcpad_bridge_posix.cpp is compiled (not this file).