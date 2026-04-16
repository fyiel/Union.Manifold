/**
 * gcpad_bridge.cpp — N-API bridge for the GCPad controller library.
 *
 * Loads gcpad.dll at runtime via LoadLibraryExA (LOAD_WITH_ALTERED_SEARCH_PATH
 * so that SDL2.dll is resolved from the same directory as gcpad.dll) and exposes
 * its C ABI to Electron's main process.
 *
 * Exported N-API functions (registered in addon.cpp):
 *   gcpadLoad(dllPath: string): boolean
 *   gcpadUnload(): void
 *   gcpadUpdateAll(): void
 *   gcpadGetStates(): Array<ControllerState>
 *   gcpadSetRumble(slot: number, left: number, right: number): boolean
 *   gcpadSetLed(slot: number, r: number, g: number, b: number): boolean
 *   gcpadOnConnect(callback: (slot: number) => void): void
 *   gcpadOnDisconnect(callback: (slot: number) => void): void
 *
 * ControllerState shape:
 *   { slot, connected, name, battery, charging,
 *     buttons: boolean[18],   // [17] = touchpad click
 *     axes: number[6],
 *     gyro: { x, y, z },     // deg/s
 *     accel: { x, y, z },    // m/s²
 *     touchpad: [{ active, x, y }, { active, x, y }] }
 */

#include <napi.h>
#include <windows.h>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>

// ── Replicated C ABI types ────────────────────────────────────────────────────
// Mirrors gcpad_c.h without requiring that header to be present at addon build time.
// MUST be kept in sync with GCPadStateC in gcpad_c.h.

#define GCPAD_BUTTON_COUNT 18
#define GCPAD_AXIS_COUNT    6

struct GCPadStateC {
    uint8_t  buttons[GCPAD_BUTTON_COUNT]; // buttons[17] = touchpad click
    uint8_t  _pad0[2];                    // alignment padding
    float    axes[GCPAD_AXIS_COUNT];
    float    gyro_x,  gyro_y,  gyro_z;   // deg/s (physical units)
    float    accel_x, accel_y, accel_z;  // m/s²  (physical units)
    float    battery_level;
    uint8_t  is_charging;
    uint8_t  is_connected;
    uint8_t  touchpad_active[2];          // 1 = finger touching
    uint16_t touchpad_x[2];               // finger X (0..1919)
    uint16_t touchpad_y[2];               // finger Y (0..1079)
};

typedef void* GCPadManagerHandle;
typedef void (*GCPadHotplugCallback)(int slot, void* userdata);

// ── Function pointer typedefs ─────────────────────────────────────────────────

typedef GCPadManagerHandle (*Fn_create)  ();
typedef void               (*Fn_destroy) (GCPadManagerHandle);
typedef int                (*Fn_init)    (GCPadManagerHandle);
typedef void               (*Fn_shutdown)(GCPadManagerHandle);
typedef void               (*Fn_update)  (GCPadManagerHandle);
typedef int                (*Fn_maxslots)(GCPadManagerHandle);
typedef int                (*Fn_getstate)(GCPadManagerHandle, int, GCPadStateC*);
typedef int                (*Fn_getname) (GCPadManagerHandle, int, char*, int);
typedef int                (*Fn_rumble)  (GCPadManagerHandle, int, uint8_t, uint8_t);
typedef int                (*Fn_led)     (GCPadManagerHandle, int, uint8_t, uint8_t, uint8_t);
typedef void               (*Fn_setconn) (GCPadManagerHandle, GCPadHotplugCallback, void*);
typedef void               (*Fn_setdisc) (GCPadManagerHandle, GCPadHotplugCallback, void*);

// ── Module-level state ────────────────────────────────────────────────────────

static HMODULE            g_dll  = nullptr;
static GCPadManagerHandle g_mgr  = nullptr;

static Fn_create   g_fn_create   = nullptr;
static Fn_destroy  g_fn_destroy  = nullptr;
static Fn_init     g_fn_init     = nullptr;
static Fn_shutdown g_fn_shutdown = nullptr;
static Fn_update   g_fn_update   = nullptr;
static Fn_maxslots g_fn_maxslots = nullptr;
static Fn_getstate g_fn_getstate = nullptr;
static Fn_getname  g_fn_getname  = nullptr;
static Fn_rumble   g_fn_rumble   = nullptr;
static Fn_led      g_fn_led      = nullptr;
static Fn_setconn  g_fn_setconn  = nullptr;
static Fn_setdisc  g_fn_setdisc  = nullptr;

// Thread-safe callbacks: guarded by g_cb_mtx
static std::mutex              g_cb_mtx;
static Napi::ThreadSafeFunction g_conn_tsfn;
static Napi::ThreadSafeFunction g_disc_tsfn;
static bool                    g_conn_valid = false;
static bool                    g_disc_valid = false;

// ── Hotplug callbacks (called from GCPad hotplug thread) ─────────────────────

static void gcpad_on_connected(int slot, void*) {
    std::lock_guard<std::mutex> lk(g_cb_mtx);
    if (!g_conn_valid) return;
    int* data = new int(slot);
    napi_status st = g_conn_tsfn.NonBlockingCall(data,
        [](Napi::Env env, Napi::Function fn, int* p) {
            int s = *p; delete p;
            fn.Call({ Napi::Number::New(env, s) });
        });
    if (st != napi_ok) delete data;
}

static void gcpad_on_disconnected(int slot, void*) {
    std::lock_guard<std::mutex> lk(g_cb_mtx);
    if (!g_disc_valid) return;
    int* data = new int(slot);
    napi_status st = g_disc_tsfn.NonBlockingCall(data,
        [](Napi::Env env, Napi::Function fn, int* p) {
            int s = *p; delete p;
            fn.Call({ Napi::Number::New(env, s) });
        });
    if (st != napi_ok) delete data;
}

// ── Helper: load a required proc address ─────────────────────────────────────

#define LOAD_PROC(var, T, name)                                          \
    do {                                                                  \
        var = reinterpret_cast<T>(GetProcAddress(g_dll, name));           \
        if (!(var)) {                                                     \
            FreeLibrary(g_dll); g_dll = nullptr;                          \
            Napi::Error::New(env, "gcpadLoad: missing export: " name)     \
                .ThrowAsJavaScriptException();                             \
            return env.Null();                                            \
        }                                                                 \
    } while (0)

// ── N-API exports ─────────────────────────────────────────────────────────────

namespace uc_gcpad {

/**
 * gcpadLoad(dllPath: string): boolean
 *
 * Loads gcpad.dll from dllPath, resolves SDL2.dll from the same directory,
 * creates and initialises the manager.  Returns true on success.
 */
Napi::Value GCPadLoad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "gcpadLoad: expected (dllPath: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    if (g_dll) return Napi::Boolean::New(env, true); // already loaded

    std::string dll_path = info[0].As<Napi::String>().Utf8Value();

    // LOAD_WITH_ALTERED_SEARCH_PATH: resolves implicit dependencies (SDL2.dll)
    // from the directory containing gcpad.dll rather than the CWD.
    g_dll = LoadLibraryExA(dll_path.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!g_dll) {
        return Napi::Boolean::New(env, false);
    }

    LOAD_PROC(g_fn_create,   Fn_create,   "gcpad_create_manager");
    LOAD_PROC(g_fn_destroy,  Fn_destroy,  "gcpad_destroy_manager");
    LOAD_PROC(g_fn_init,     Fn_init,     "gcpad_initialize");
    LOAD_PROC(g_fn_shutdown, Fn_shutdown, "gcpad_shutdown");
    LOAD_PROC(g_fn_update,   Fn_update,   "gcpad_update_all");
    LOAD_PROC(g_fn_maxslots, Fn_maxslots, "gcpad_get_max_slots");
    LOAD_PROC(g_fn_getstate, Fn_getstate, "gcpad_get_state");
    LOAD_PROC(g_fn_getname,  Fn_getname,  "gcpad_get_name");
    LOAD_PROC(g_fn_rumble,   Fn_rumble,   "gcpad_set_rumble");
    LOAD_PROC(g_fn_led,      Fn_led,      "gcpad_set_led");
    LOAD_PROC(g_fn_setconn,  Fn_setconn,  "gcpad_set_connected_callback");
    LOAD_PROC(g_fn_setdisc,  Fn_setdisc,  "gcpad_set_disconnected_callback");

    g_mgr = g_fn_create();
    if (!g_mgr) {
        FreeLibrary(g_dll);
        g_dll = nullptr;
        return Napi::Boolean::New(env, false);
    }

    // Register hotplug callbacks before initialize so initial-connect events arrive
    g_fn_setconn(g_mgr, gcpad_on_connected,    nullptr);
    g_fn_setdisc(g_mgr, gcpad_on_disconnected, nullptr);

    if (!g_fn_init(g_mgr)) {
        g_fn_destroy(g_mgr);
        g_mgr = nullptr;
        FreeLibrary(g_dll);
        g_dll = nullptr;
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, true);
}

/**
 * gcpadUnload(): void
 *
 * Shuts down the manager, releases thread-safe callbacks, and unloads the DLL.
 */
Napi::Value GCPadUnload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Stop the hotplug thread first — no more callbacks will fire after this.
    if (g_mgr && g_fn_shutdown) {
        g_fn_shutdown(g_mgr);
    }

    // Now safe to release TSFNs; hotplug thread is dead.
    {
        std::lock_guard<std::mutex> lk(g_cb_mtx);
        if (g_conn_valid) { g_conn_tsfn.Release(); g_conn_valid = false; }
        if (g_disc_valid) { g_disc_tsfn.Release(); g_disc_valid = false; }
    }

    if (g_mgr && g_fn_destroy) {
        g_fn_destroy(g_mgr);
        g_mgr = nullptr;
    }

    if (g_dll) {
        FreeLibrary(g_dll);
        g_dll = nullptr;
    }

    g_fn_create = nullptr; g_fn_destroy = nullptr; g_fn_init    = nullptr;
    g_fn_shutdown = nullptr; g_fn_update = nullptr; g_fn_maxslots = nullptr;
    g_fn_getstate = nullptr; g_fn_getname = nullptr; g_fn_rumble = nullptr;
    g_fn_led      = nullptr; g_fn_setconn = nullptr; g_fn_setdisc = nullptr;

    return env.Undefined();
}

/**
 * gcpadUpdateAll(): void
 * Poll all controllers.  Call once per frame before gcpadGetStates.
 */
Napi::Value GCPadUpdateAll(const Napi::CallbackInfo& info) {
    if (g_mgr && g_fn_update) g_fn_update(g_mgr);
    return info.Env().Undefined();
}

/**
 * gcpadGetStates(): Array<ControllerState>
 * Returns one entry per connected slot (disconnected slots are omitted).
 */
Napi::Value GCPadGetStates(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto result = Napi::Array::New(env);

    if (!g_mgr || !g_fn_getstate || !g_fn_getname || !g_fn_maxslots) return result;

    int max = g_fn_maxslots(g_mgr);
    uint32_t out_idx = 0;

    for (int slot = 0; slot < max; ++slot) {
        GCPadStateC st{};
        if (!g_fn_getstate(g_mgr, slot, &st)) continue;

        char name_buf[128] = {};
        g_fn_getname(g_mgr, slot, name_buf, static_cast<int>(sizeof(name_buf)));

        auto obj = Napi::Object::New(env);
        obj.Set("slot",      Napi::Number::New(env, slot));
        obj.Set("connected", Napi::Boolean::New(env, true));
        obj.Set("name",      Napi::String::New(env, name_buf));
        obj.Set("battery",   Napi::Number::New(env, st.battery_level));
        obj.Set("charging",  Napi::Boolean::New(env, st.is_charging != 0));

        auto btns = Napi::Array::New(env, GCPAD_BUTTON_COUNT);
        for (uint32_t i = 0; i < GCPAD_BUTTON_COUNT; ++i)
            btns.Set(i, Napi::Boolean::New(env, st.buttons[i] != 0));
        obj.Set("buttons", btns);

        auto axes = Napi::Array::New(env, GCPAD_AXIS_COUNT);
        for (uint32_t i = 0; i < GCPAD_AXIS_COUNT; ++i)
            axes.Set(i, Napi::Number::New(env, st.axes[i]));
        obj.Set("axes", axes);

        // Motion sensors (in physical units: deg/s and m/s²)
        auto gyro = Napi::Object::New(env);
        gyro.Set("x", Napi::Number::New(env, st.gyro_x));
        gyro.Set("y", Napi::Number::New(env, st.gyro_y));
        gyro.Set("z", Napi::Number::New(env, st.gyro_z));
        obj.Set("gyro", gyro);

        auto accel = Napi::Object::New(env);
        accel.Set("x", Napi::Number::New(env, st.accel_x));
        accel.Set("y", Napi::Number::New(env, st.accel_y));
        accel.Set("z", Napi::Number::New(env, st.accel_z));
        obj.Set("accel", accel);

        // Touchpad contacts (up to 2 fingers)
        auto touchpad = Napi::Array::New(env, 2);
        for (uint32_t t = 0; t < 2; ++t) {
            auto touch = Napi::Object::New(env);
            touch.Set("active", Napi::Boolean::New(env, st.touchpad_active[t] != 0));
            touch.Set("x",      Napi::Number::New(env, st.touchpad_x[t]));
            touch.Set("y",      Napi::Number::New(env, st.touchpad_y[t]));
            touchpad.Set(t, touch);
        }
        obj.Set("touchpad", touchpad);

        result.Set(out_idx++, obj);
    }

    return result;
}

/**
 * gcpadSetRumble(slot: number, left: number, right: number): boolean
 */
Napi::Value GCPadSetRumble(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || !g_fn_rumble ||
        info.Length() < 3 ||
        !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber())
        return Napi::Boolean::New(env, false);

    int slot  = info[0].As<Napi::Number>().Int32Value();
    int left  = info[1].As<Napi::Number>().Int32Value();
    int right = info[2].As<Napi::Number>().Int32Value();

    auto clamp = [](int v) -> uint8_t {
        return static_cast<uint8_t>(v < 0 ? 0 : v > 255 ? 255 : v);
    };

    return Napi::Boolean::New(env,
        g_fn_rumble(g_mgr, slot, clamp(left), clamp(right)) != 0);
}

/**
 * gcpadSetLed(slot: number, r: number, g: number, b: number): boolean
 */
Napi::Value GCPadSetLed(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || !g_fn_led ||
        info.Length() < 4 ||
        !info[0].IsNumber() || !info[1].IsNumber() ||
        !info[2].IsNumber() || !info[3].IsNumber())
        return Napi::Boolean::New(env, false);

    int slot = info[0].As<Napi::Number>().Int32Value();
    int r    = info[1].As<Napi::Number>().Int32Value();
    int g    = info[2].As<Napi::Number>().Int32Value();
    int b    = info[3].As<Napi::Number>().Int32Value();

    auto clamp = [](int v) -> uint8_t {
        return static_cast<uint8_t>(v < 0 ? 0 : v > 255 ? 255 : v);
    };

    return Napi::Boolean::New(env,
        g_fn_led(g_mgr, slot, clamp(r), clamp(g), clamp(b)) != 0);
}

/**
 * gcpadOnConnect(callback: (slot: number) => void): void
 * Replaces any previously registered connect callback.
 */
Napi::Value GCPadOnConnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) return env.Undefined();

    std::lock_guard<std::mutex> lk(g_cb_mtx);
    if (g_conn_valid) { g_conn_tsfn.Release(); g_conn_valid = false; }
    g_conn_tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "gcpad_connected", 0, 1);
    g_conn_valid = true;
    return env.Undefined();
}

/**
 * gcpadOnDisconnect(callback: (slot: number) => void): void
 * Replaces any previously registered disconnect callback.
 */
Napi::Value GCPadOnDisconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) return env.Undefined();

    std::lock_guard<std::mutex> lk(g_cb_mtx);
    if (g_disc_valid) { g_disc_tsfn.Release(); g_disc_valid = false; }
    g_disc_tsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(), "gcpad_disconnected", 0, 1);
    g_disc_valid = true;
    return env.Undefined();
}

// ── Input injection (SendInput wrappers for remapping) ───────────────────────

/**
 * gcpadSendKeyboard(virtualKey: number, pressed: boolean): boolean
 * Injects a keyboard event via SendInput. Uses both virtual key and scan code
 * so games using DirectInput/RawInput receive the event.
 */
Napi::Value GCPadSendKeyboard(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean())
        return Napi::Boolean::New(env, false);

    WORD vk = static_cast<WORD>(info[0].As<Napi::Number>().Uint32Value());
    bool pressed = info[1].As<Napi::Boolean>().Value();

    INPUT input = {};
    input.type = INPUT_KEYBOARD;
    input.ki.wVk   = vk;
    input.ki.wScan = static_cast<WORD>(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC));
    input.ki.dwFlags = KEYEVENTF_SCANCODE;
    if (!pressed) input.ki.dwFlags |= KEYEVENTF_KEYUP;

    // Extended keys (arrows, numpad enter, ins/del/home/end/pgup/pgdn, numlock)
    if (input.ki.wScan > 0xFF ||
        vk == VK_RIGHT || vk == VK_LEFT || vk == VK_UP || vk == VK_DOWN ||
        vk == VK_INSERT || vk == VK_DELETE || vk == VK_HOME || vk == VK_END ||
        vk == VK_PRIOR || vk == VK_NEXT || vk == VK_NUMLOCK) {
        input.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
    }

    UINT sent = SendInput(1, &input, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

/**
 * gcpadSendMouseButton(button: number, pressed: boolean): boolean
 * button: 0=left, 1=right, 2=middle
 */
Napi::Value GCPadSendMouseButton(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean())
        return Napi::Boolean::New(env, false);

    int button = info[0].As<Napi::Number>().Int32Value();
    bool pressed = info[1].As<Napi::Boolean>().Value();

    INPUT input = {};
    input.type = INPUT_MOUSE;
    switch (button) {
        case 0: input.mi.dwFlags = pressed ? MOUSEEVENTF_LEFTDOWN   : MOUSEEVENTF_LEFTUP;   break;
        case 1: input.mi.dwFlags = pressed ? MOUSEEVENTF_RIGHTDOWN  : MOUSEEVENTF_RIGHTUP;  break;
        case 2: input.mi.dwFlags = pressed ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP; break;
        default: return Napi::Boolean::New(env, false);
    }

    UINT sent = SendInput(1, &input, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

/**
 * gcpadSendMouseMove(dx: number, dy: number): boolean
 * Relative mouse movement in pixels.
 */
Napi::Value GCPadSendMouseMove(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
        return Napi::Boolean::New(env, false);

    INPUT input = {};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_MOVE;
    input.mi.dx = info[0].As<Napi::Number>().Int32Value();
    input.mi.dy = info[1].As<Napi::Number>().Int32Value();

    UINT sent = SendInput(1, &input, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

/**
 * gcpadSendMouseWheel(delta: number): boolean
 * delta: positive = scroll up, negative = scroll down. Typically 120 per notch.
 */
Napi::Value GCPadSendMouseWheel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return Napi::Boolean::New(env, false);

    INPUT input = {};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_WHEEL;
    input.mi.mouseData = static_cast<DWORD>(info[0].As<Napi::Number>().Int32Value());

    UINT sent = SendInput(1, &input, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

/**
 * gcpadSetTriggerEffect(slot, rightTrigger, mode, start, end, force, p1, p2): boolean
 * DualSense adaptive trigger effect.
 */
Napi::Value GCPadSetTriggerEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || info.Length() < 8) return Napi::Boolean::New(env, false);

    // Resolve the function pointer lazily (only DualSense builds export this)
    typedef int (*Fn_trigger)(GCPadManagerHandle, int, int, uint8_t, uint8_t, uint8_t, uint8_t, uint8_t, uint8_t);
    static Fn_trigger fn = nullptr;
    if (!fn && g_dll) fn = reinterpret_cast<Fn_trigger>(GetProcAddress(g_dll, "gcpad_set_trigger_effect"));
    if (!fn) return Napi::Boolean::New(env, false);

    int slot  = info[0].As<Napi::Number>().Int32Value();
    int right = info[1].As<Napi::Boolean>().Value() ? 1 : 0;
    uint8_t mode  = static_cast<uint8_t>(info[2].As<Napi::Number>().Uint32Value());
    uint8_t start = static_cast<uint8_t>(info[3].As<Napi::Number>().Uint32Value());
    uint8_t end   = static_cast<uint8_t>(info[4].As<Napi::Number>().Uint32Value());
    uint8_t force = static_cast<uint8_t>(info[5].As<Napi::Number>().Uint32Value());
    uint8_t p1    = static_cast<uint8_t>(info[6].As<Napi::Number>().Uint32Value());
    uint8_t p2    = static_cast<uint8_t>(info[7].As<Napi::Number>().Uint32Value());

    return Napi::Boolean::New(env, fn(g_mgr, slot, right, mode, start, end, force, p1, p2) != 0);
}

/**
 * gcpadSetPlayerLeds(slot, ledMask): boolean
 * DualSense player indicator LEDs (5-bit mask).
 */
Napi::Value GCPadSetPlayerLeds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || info.Length() < 2) return Napi::Boolean::New(env, false);

    typedef int (*Fn_pleds)(GCPadManagerHandle, int, uint8_t);
    static Fn_pleds fn = nullptr;
    if (!fn && g_dll) fn = reinterpret_cast<Fn_pleds>(GetProcAddress(g_dll, "gcpad_set_player_leds"));
    if (!fn) return Napi::Boolean::New(env, false);

    int slot = info[0].As<Napi::Number>().Int32Value();
    uint8_t mask = static_cast<uint8_t>(info[1].As<Napi::Number>().Uint32Value());

    return Napi::Boolean::New(env, fn(g_mgr, slot, mask) != 0);
}

// ── Remapper functions ─────────────────────────────────────────────────────────

static void* g_remapper = nullptr;

typedef void* (*Fn_remapper_create)();
typedef void (*Fn_remapper_destroy)(void*);
typedef void (*Fn_remapper_map_btn_key)(void*, int, uint16_t);
typedef void (*Fn_remapper_map_btn_mouse)(void*, int, int);
typedef void (*Fn_remapper_map_axis_mouse)(void*, int, float, float, int, float);
typedef void (*Fn_remapper_map_axis_key)(void*, int, uint16_t, float, int);
typedef void (*Fn_remapper_map_axis_mouse_btn)(void*, int, int, float);
typedef void (*Fn_remapper_map_axis_wheel)(void*, int, int, float, int, float);
typedef void (*Fn_remapper_clear_all)(void*);
typedef int (*Fn_remapper_send_input)(void*, void*, void*);
typedef void (*Fn_remapper_reset_state)(void*);

static Fn_remapper_create   g_fn_remapper_create   = nullptr;
static Fn_remapper_destroy  g_fn_remapper_destroy  = nullptr;
static Fn_remapper_map_btn_key g_fn_remapper_map_btn_key = nullptr;
static Fn_remapper_map_btn_mouse g_fn_remapper_map_btn_mouse = nullptr;
static Fn_remapper_map_axis_mouse g_fn_remapper_map_axis_mouse = nullptr;
static Fn_remapper_map_axis_key g_fn_remapper_map_axis_key = nullptr;
static Fn_remapper_map_axis_mouse_btn g_fn_remapper_map_axis_mouse_btn = nullptr;
static Fn_remapper_map_axis_wheel g_fn_remapper_map_axis_wheel = nullptr;
static Fn_remapper_clear_all g_fn_remapper_clear_all = nullptr;
static Fn_remapper_send_input g_fn_remapper_send_input = nullptr;
static Fn_remapper_reset_state g_fn_remapper_reset_state = nullptr;

Napi::Value GCPadRemapperCreate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_dll) return env.Null();
    
    if (!g_fn_remapper_create) {
        g_fn_remapper_create = reinterpret_cast<Fn_remapper_create>(GetProcAddress(g_dll, "gcpad_remapper_create"));
        g_fn_remapper_destroy = reinterpret_cast<Fn_remapper_destroy>(GetProcAddress(g_dll, "gcpad_remapper_destroy"));
        g_fn_remapper_map_btn_key = reinterpret_cast<Fn_remapper_map_btn_key>(GetProcAddress(g_dll, "gcpad_remapper_map_button_to_key"));
        g_fn_remapper_map_btn_mouse = reinterpret_cast<Fn_remapper_map_btn_mouse>(GetProcAddress(g_dll, "gcpad_remapper_map_button_to_mouse"));
        g_fn_remapper_map_axis_mouse = reinterpret_cast<Fn_remapper_map_axis_mouse>(GetProcAddress(g_dll, "gcpad_remapper_map_axis_to_mouse"));
        g_fn_remapper_map_axis_key = reinterpret_cast<Fn_remapper_map_axis_key>(GetProcAddress(g_dll, "gcpad_remapper_map_axis_to_key"));
        g_fn_remapper_map_axis_mouse_btn = reinterpret_cast<Fn_remapper_map_axis_mouse_btn>(GetProcAddress(g_dll, "gcpad_remapper_map_axis_to_mouse_button"));
        g_fn_remapper_map_axis_wheel = reinterpret_cast<Fn_remapper_map_axis_wheel>(GetProcAddress(g_dll, "gcpad_remapper_map_axis_to_wheel"));
        g_fn_remapper_clear_all = reinterpret_cast<Fn_remapper_clear_all>(GetProcAddress(g_dll, "gcpad_remapper_clear_all"));
        g_fn_remapper_send_input = reinterpret_cast<Fn_remapper_send_input>(GetProcAddress(g_dll, "gcpad_remapper_send_input"));
        g_fn_remapper_reset_state = reinterpret_cast<Fn_remapper_reset_state>(GetProcAddress(g_dll, "gcpad_remapper_reset_state"));
    }
    
    if (!g_fn_remapper_create) return env.Null();
    
    g_remapper = g_fn_remapper_create();
    return Napi::Boolean::New(env, g_remapper != nullptr);
}

Napi::Value GCPadRemapperDestroy(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_remapper && g_fn_remapper_destroy) {
        g_fn_remapper_destroy(g_remapper);
        g_remapper = nullptr;
    }
    return env.Undefined();
}

Napi::Value GCPadRemapperMapButtonToKey(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_btn_key || info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        return env.Undefined();
    }
    int button = info[0].As<Napi::Number>().Int32Value();
    uint16_t vk = static_cast<uint16_t>(info[1].As<Napi::Number>().Uint32Value());
    g_fn_remapper_map_btn_key(g_remapper, button, vk);
    return env.Undefined();
}

Napi::Value GCPadRemapperMapButtonToMouse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_btn_mouse || info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        return env.Undefined();
    }
    int button = info[0].As<Napi::Number>().Int32Value();
    int mouse_btn = info[1].As<Napi::Number>().Int32Value();
    g_fn_remapper_map_btn_mouse(g_remapper, button, mouse_btn);
    return env.Undefined();
}

Napi::Value GCPadRemapperMapAxisToMouse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_axis_mouse || info.Length() < 5 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsBoolean() || !info[4].IsNumber()) {
        return env.Undefined();
    }
    int axis = info[0].As<Napi::Number>().Int32Value();
    float sensitivity = static_cast<float>(info[1].As<Napi::Number>().DoubleValue());
    float deadzone = static_cast<float>(info[2].As<Napi::Number>().DoubleValue());
    int invert = info[3].As<Napi::Boolean>().Value() ? 1 : 0;
    float curve = static_cast<float>(info[4].As<Napi::Number>().DoubleValue());
    g_fn_remapper_map_axis_mouse(g_remapper, axis, sensitivity, deadzone, invert, curve);
    return env.Undefined();
}

Napi::Value GCPadRemapperMapAxisToKey(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_axis_key || info.Length() < 4 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsBoolean()) {
        return env.Undefined();
    }
    int axis = info[0].As<Napi::Number>().Int32Value();
    uint16_t vk = static_cast<uint16_t>(info[1].As<Napi::Number>().Uint32Value());
    float threshold = static_cast<float>(info[2].As<Napi::Number>().DoubleValue());
    int neg_dir = info[3].As<Napi::Boolean>().Value() ? 1 : 0;
    g_fn_remapper_map_axis_key(g_remapper, axis, vk, threshold, neg_dir);
    return env.Undefined();
}

Napi::Value GCPadRemapperClearAll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_remapper && g_fn_remapper_clear_all) {
        g_fn_remapper_clear_all(g_remapper);
    }
    return env.Undefined();
}

Napi::Value GCPadRemapperSendInput(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_send_input) {
        return Napi::Boolean::New(env, false);
    }
    int result = g_fn_remapper_send_input(g_remapper, nullptr, nullptr);
    return Napi::Boolean::New(env, result != 0);
}

Napi::Value GCPadRemapperResetState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_remapper && g_fn_remapper_reset_state) {
        g_fn_remapper_reset_state(g_remapper);
    }
    return env.Undefined();
}

} // namespace uc_gcpad
