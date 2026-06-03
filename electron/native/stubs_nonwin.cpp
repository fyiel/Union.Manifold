#include <napi.h>

#ifndef NAPI_HAS_THREADS
#define NAPI_HAS_THREADS 1
#endif

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

// Note: GCPad functions are implemented in gcpad_bridge_linux.cpp for Linux
