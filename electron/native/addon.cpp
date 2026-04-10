/**
 * UC Overlay Native Addon - N-API entry point.
 *
 * Exports:
 *   injectDll(pid: number, dllPath: string): boolean
 *   ejectDll(pid: number, dllPath: string): boolean
 *   createSharedFrame(pid: number, width: number, height: number): SharedFrameHandle
 *   writeSharedFrame(handle: SharedFrameHandle, buffer: Buffer, visible: boolean): void
 *   destroySharedFrame(handle: SharedFrameHandle): void
 *   createPipeServer(pid: number, callback: (msg: object) => void): PipeServerHandle
 *   sendPipeMessage(handle: PipeServerHandle, data: Buffer): void
 *   destroyPipeServer(handle: PipeServerHandle): void
 */

#include <napi.h>

// Forward declarations from other TUs
namespace uc_injector {
    Napi::Value InjectDll(const Napi::CallbackInfo& info);
    Napi::Value EjectDll(const Napi::CallbackInfo& info);
}

namespace uc_shmem {
    Napi::Value CreateSharedFrame(const Napi::CallbackInfo& info);
    Napi::Value WriteSharedFrame(const Napi::CallbackInfo& info);
    Napi::Value DestroySharedFrame(const Napi::CallbackInfo& info);
}

namespace uc_pipe {
    Napi::Value CreatePipeServer(const Napi::CallbackInfo& info);
    Napi::Value SendPipeMessage(const Napi::CallbackInfo& info);
    Napi::Value DestroyPipeServer(const Napi::CallbackInfo& info);
}

namespace uc_gcpad {
    Napi::Value GCPadLoad(const Napi::CallbackInfo& info);
    Napi::Value GCPadUnload(const Napi::CallbackInfo& info);
    Napi::Value GCPadUpdateAll(const Napi::CallbackInfo& info);
    Napi::Value GCPadGetStates(const Napi::CallbackInfo& info);
    Napi::Value GCPadSetRumble(const Napi::CallbackInfo& info);
    Napi::Value GCPadSetLed(const Napi::CallbackInfo& info);
    Napi::Value GCPadOnConnect(const Napi::CallbackInfo& info);
    Napi::Value GCPadOnDisconnect(const Napi::CallbackInfo& info);
    // Input injection (SendInput wrappers)
    Napi::Value GCPadSendKeyboard(const Napi::CallbackInfo& info);
    Napi::Value GCPadSendMouseButton(const Napi::CallbackInfo& info);
    Napi::Value GCPadSendMouseMove(const Napi::CallbackInfo& info);
    Napi::Value GCPadSendMouseWheel(const Napi::CallbackInfo& info);
    // DualSense-specific
    Napi::Value GCPadSetTriggerEffect(const Napi::CallbackInfo& info);
    Napi::Value GCPadSetPlayerLeds(const Napi::CallbackInfo& info);
    // Remapper
    Napi::Value GCPadRemapperCreate(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperDestroy(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperMapButtonToKey(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperMapButtonToMouse(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperMapAxisToMouse(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperMapAxisToKey(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperClearAll(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperSendInput(const Napi::CallbackInfo& info);
    Napi::Value GCPadRemapperResetState(const Napi::CallbackInfo& info);
}

namespace uc_volume {
    Napi::Value NativeGetVolume(const Napi::CallbackInfo& info);
    Napi::Value NativeSetVolume(const Napi::CallbackInfo& info);
    Napi::Value NativeGetMuted(const Napi::CallbackInfo& info);
    Napi::Value NativeSetMuted(const Napi::CallbackInfo& info);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Overlay / injection
    exports.Set("injectDll",         Napi::Function::New(env, uc_injector::InjectDll));
    exports.Set("ejectDll",          Napi::Function::New(env, uc_injector::EjectDll));
    exports.Set("createSharedFrame", Napi::Function::New(env, uc_shmem::CreateSharedFrame));
    exports.Set("writeSharedFrame",  Napi::Function::New(env, uc_shmem::WriteSharedFrame));
    exports.Set("destroySharedFrame",Napi::Function::New(env, uc_shmem::DestroySharedFrame));
    exports.Set("createPipeServer",  Napi::Function::New(env, uc_pipe::CreatePipeServer));
    exports.Set("sendPipeMessage",   Napi::Function::New(env, uc_pipe::SendPipeMessage));
    exports.Set("destroyPipeServer", Napi::Function::New(env, uc_pipe::DestroyPipeServer));

    // GCPad controller
    exports.Set("gcpadLoad",         Napi::Function::New(env, uc_gcpad::GCPadLoad));
    exports.Set("gcpadUnload",       Napi::Function::New(env, uc_gcpad::GCPadUnload));
    exports.Set("gcpadUpdateAll",    Napi::Function::New(env, uc_gcpad::GCPadUpdateAll));
    exports.Set("gcpadGetStates",    Napi::Function::New(env, uc_gcpad::GCPadGetStates));
    exports.Set("gcpadSetRumble",    Napi::Function::New(env, uc_gcpad::GCPadSetRumble));
    exports.Set("gcpadSetLed",       Napi::Function::New(env, uc_gcpad::GCPadSetLed));
    exports.Set("gcpadOnConnect",    Napi::Function::New(env, uc_gcpad::GCPadOnConnect));
    exports.Set("gcpadOnDisconnect", Napi::Function::New(env, uc_gcpad::GCPadOnDisconnect));

    // Input injection
    exports.Set("gcpadSendKeyboard",    Napi::Function::New(env, uc_gcpad::GCPadSendKeyboard));
    exports.Set("gcpadSendMouseButton", Napi::Function::New(env, uc_gcpad::GCPadSendMouseButton));
    exports.Set("gcpadSendMouseMove",   Napi::Function::New(env, uc_gcpad::GCPadSendMouseMove));
    exports.Set("gcpadSendMouseWheel",  Napi::Function::New(env, uc_gcpad::GCPadSendMouseWheel));

    // DualSense-specific
    exports.Set("gcpadSetTriggerEffect", Napi::Function::New(env, uc_gcpad::GCPadSetTriggerEffect));
    exports.Set("gcpadSetPlayerLeds",    Napi::Function::New(env, uc_gcpad::GCPadSetPlayerLeds));

    // Remapper
    exports.Set("gcpadRemapperCreate", Napi::Function::New(env, uc_gcpad::GCPadRemapperCreate));
    exports.Set("gcpadRemapperDestroy", Napi::Function::New(env, uc_gcpad::GCPadRemapperDestroy));
    exports.Set("gcpadRemapperMapButtonToKey", Napi::Function::New(env, uc_gcpad::GCPadRemapperMapButtonToKey));
    exports.Set("gcpadRemapperMapButtonToMouse", Napi::Function::New(env, uc_gcpad::GCPadRemapperMapButtonToMouse));
    exports.Set("gcpadRemapperMapAxisToMouse", Napi::Function::New(env, uc_gcpad::GCPadRemapperMapAxisToMouse));
    exports.Set("gcpadRemapperMapAxisToKey", Napi::Function::New(env, uc_gcpad::GCPadRemapperMapAxisToKey));
    exports.Set("gcpadRemapperClearAll", Napi::Function::New(env, uc_gcpad::GCPadRemapperClearAll));
    exports.Set("gcpadRemapperSendInput", Napi::Function::New(env, uc_gcpad::GCPadRemapperSendInput));
    exports.Set("gcpadRemapperResetState", Napi::Function::New(env, uc_gcpad::GCPadRemapperResetState));

    // Native volume control (replaces PowerShell-based approach)
    exports.Set("nativeGetVolume", Napi::Function::New(env, uc_volume::NativeGetVolume));
    exports.Set("nativeSetVolume", Napi::Function::New(env, uc_volume::NativeSetVolume));
    exports.Set("nativeGetMuted",  Napi::Function::New(env, uc_volume::NativeGetMuted));
    exports.Set("nativeSetMuted",  Napi::Function::New(env, uc_volume::NativeSetMuted));

    return exports;
}

NODE_API_MODULE(uc_overlay_native, Init)
