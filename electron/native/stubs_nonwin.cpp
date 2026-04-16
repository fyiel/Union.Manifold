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

namespace uc_gcpad {
Napi::Value GCPadLoad(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadLoad");
}

Napi::Value GCPadUnload(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadUnload");
}

Napi::Value GCPadUpdateAll(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadUpdateAll");
}

Napi::Value GCPadGetStates(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadGetStates");
}

Napi::Value GCPadSetRumble(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSetRumble");
}

Napi::Value GCPadSetLed(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSetLed");
}

Napi::Value GCPadOnConnect(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadOnConnect");
}

Napi::Value GCPadOnDisconnect(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadOnDisconnect");
}

Napi::Value GCPadSendKeyboard(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSendKeyboard");
}

Napi::Value GCPadSendMouseButton(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSendMouseButton");
}

Napi::Value GCPadSendMouseMove(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSendMouseMove");
}

Napi::Value GCPadSendMouseWheel(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSendMouseWheel");
}

Napi::Value GCPadSetTriggerEffect(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSetTriggerEffect");
}

Napi::Value GCPadSetPlayerLeds(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadSetPlayerLeds");
}

Napi::Value GCPadRemapperCreate(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperCreate");
}

Napi::Value GCPadRemapperDestroy(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperDestroy");
}

Napi::Value GCPadRemapperMapButtonToKey(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperMapButtonToKey");
}

Napi::Value GCPadRemapperMapButtonToMouse(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperMapButtonToMouse");
}

Napi::Value GCPadRemapperMapAxisToMouse(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperMapAxisToMouse");
}

Napi::Value GCPadRemapperMapAxisToKey(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperMapAxisToKey");
}

Napi::Value GCPadRemapperClearAll(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperClearAll");
}

Napi::Value GCPadRemapperSendInput(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperSendInput");
}

Napi::Value GCPadRemapperResetState(const Napi::CallbackInfo& info) {
    return Unsupported(info.Env(), "gcpadRemapperResetState");
}
} // namespace uc_gcpad
