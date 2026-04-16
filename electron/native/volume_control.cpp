/**
 * volume_control.cpp — Native Windows Core Audio volume control via N-API.
 *
 * Replaces the PowerShell-based volume control with direct COM API calls.
 * Works immediately on any Windows installation without additional dependencies.
 *
 * Exported N-API functions (registered in addon.cpp):
 *   nativeGetVolume(): number         (0-100)
 *   nativeSetVolume(level: number): void
 *   nativeGetMuted(): boolean
 *   nativeSetMuted(muted: boolean): void
 */

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#include <mmdeviceapi.h>
#include <endpointvolume.h>
#include <functiondiscoverykeys_devpkey.h>

// COM smart pointer helper
struct ComInit {
    ComInit()  { CoInitializeEx(nullptr, COINIT_MULTITHREADED); }
    ~ComInit() { CoUninitialize(); }
};

// Get the default audio endpoint volume interface.
// Caller must Release() the returned pointer.
static IAudioEndpointVolume* getEndpointVolume() {
    IMMDeviceEnumerator* enumerator = nullptr;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_INPROC_SERVER,
        __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr) || !enumerator) return nullptr;

    IMMDevice* device = nullptr;
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    enumerator->Release();
    if (FAILED(hr) || !device) return nullptr;

    IAudioEndpointVolume* volume = nullptr;
    hr = device->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_INPROC_SERVER,
                          nullptr, reinterpret_cast<void**>(&volume));
    device->Release();
    if (FAILED(hr)) return nullptr;

    return volume;
}
#endif

namespace uc_volume {

Napi::Value NativeGetVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    ComInit com;
    IAudioEndpointVolume* vol = getEndpointVolume();
    if (!vol) return Napi::Number::New(env, -1);

    float level = 0.0f;
    vol->GetMasterVolumeLevelScalar(&level);
    vol->Release();
    return Napi::Number::New(env, static_cast<int>(level * 100.0f + 0.5f));
#else
    return Napi::Number::New(env, -1);
#endif
}

Napi::Value NativeSetVolume(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();

    int level = info[0].As<Napi::Number>().Int32Value();
    if (level < 0) level = 0;
    if (level > 100) level = 100;

    ComInit com;
    IAudioEndpointVolume* vol = getEndpointVolume();
    if (vol) {
        vol->SetMasterVolumeLevelScalar(level / 100.0f, nullptr);
        vol->Release();
    }
#endif
    return env.Undefined();
}

Napi::Value NativeGetMuted(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    ComInit com;
    IAudioEndpointVolume* vol = getEndpointVolume();
    if (!vol) return Napi::Boolean::New(env, false);

    BOOL muted = FALSE;
    vol->GetMute(&muted);
    vol->Release();
    return Napi::Boolean::New(env, muted != FALSE);
#else
    return Napi::Boolean::New(env, false);
#endif
}

Napi::Value NativeSetMuted(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() < 1 || !info[0].IsBoolean()) return env.Undefined();

    bool muted = info[0].As<Napi::Boolean>().Value();

    ComInit com;
    IAudioEndpointVolume* vol = getEndpointVolume();
    if (vol) {
        vol->SetMute(muted ? TRUE : FALSE, nullptr);
        vol->Release();
    }
#endif
    return env.Undefined();
}

} // namespace uc_volume
