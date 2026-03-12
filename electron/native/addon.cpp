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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("injectDll", Napi::Function::New(env, uc_injector::InjectDll));
    exports.Set("ejectDll", Napi::Function::New(env, uc_injector::EjectDll));
    exports.Set("createSharedFrame", Napi::Function::New(env, uc_shmem::CreateSharedFrame));
    exports.Set("writeSharedFrame", Napi::Function::New(env, uc_shmem::WriteSharedFrame));
    exports.Set("destroySharedFrame", Napi::Function::New(env, uc_shmem::DestroySharedFrame));
    exports.Set("createPipeServer", Napi::Function::New(env, uc_pipe::CreatePipeServer));
    exports.Set("sendPipeMessage", Napi::Function::New(env, uc_pipe::SendPipeMessage));
    exports.Set("destroyPipeServer", Napi::Function::New(env, uc_pipe::DestroyPipeServer));
    return exports;
}

NODE_API_MODULE(uc_overlay_native, Init)
