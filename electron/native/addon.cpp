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

    return exports;
}

NODE_API_MODULE(uc_overlay_native, Init)
