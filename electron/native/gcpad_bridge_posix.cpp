/**
 * gcpad_bridge_posix.cpp — POSIX (Linux) version of the GCPad N-API bridge.
 *
 * Mirrors the surface of the Windows gcpad_bridge.cpp but uses dlopen/dlsym
 * to load libgcpad.so at runtime, and skips/no-ops the SendInput-based
 * helpers (SendKeyboard / SendMouseButton / SendMouseMove / SendMouseWheel)
 * because on Linux GCPad's own GamepadInputRemapper (linked into
 * libgcpad.so) does the X11/XTest injection itself.
 *
 * The injection / shared-memory / pipe overlay surface is NOT implemented
 * on Linux — those features live in stubs_nonwin.cpp and throw "Windows
 * only" errors when called.
 *
 * Exported (registered in addon.cpp):
 *   gcpadLoad(libPath: string): boolean
 *   gcpadUnload(): void
 *   gcpadUpdateAll(): void
 *   gcpadGetStates(): Array<ControllerState>
 *   gcpadSetRumble(slot, l, r): boolean
 *   gcpadSetLed(slot, r, g, b): boolean
 *   gcpadOnConnect(cb): void
 *   gcpadOnDisconnect(cb): void
 *   gcpadSetTriggerEffect(...): boolean      // DualSense-only, no-op if not supported
 *   gcpadSetPlayerLeds(slot, mask): boolean  // DualSense-only
 *   gcpadRemapper{Create,Destroy,MapButtonToKey,MapButtonToMouse,
 *                 MapAxisToMouse,MapAxisToKey,ClearAll,SendInput,ResetState}
 *
 * The remapper exports drive libgcpad's own input translation, which on
 * Linux speaks X11 (XTest). That keeps remapping working without us
 * shipping a separate Linux SendInput shim.
 */

#include <napi.h>
#include <dlfcn.h>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>

// ── Replicated C ABI types (must match gcpad_c.h) ─────────────────────────────

#define GCPAD_BUTTON_COUNT 18
#define GCPAD_AXIS_COUNT    6

struct GCPadStateC {
    uint8_t  buttons[GCPAD_BUTTON_COUNT];
    uint8_t  _pad0[2];
    float    axes[GCPAD_AXIS_COUNT];
    float    gyro_x,  gyro_y,  gyro_z;
    float    accel_x, accel_y, accel_z;
    float    battery_level;
    uint8_t  is_charging;
    uint8_t  is_connected;
    uint8_t  touchpad_active[2];
    uint16_t touchpad_x[2];
    uint16_t touchpad_y[2];
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

// ── Module state ──────────────────────────────────────────────────────────────

static void*              g_lib  = nullptr;
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

static std::mutex               g_cb_mtx;
static Napi::ThreadSafeFunction g_conn_tsfn;
static Napi::ThreadSafeFunction g_disc_tsfn;
static bool                     g_conn_valid = false;
static bool                     g_disc_valid = false;

// ── Hotplug callbacks (called from libgcpad's hotplug thread) ────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

#define LOAD_SYM(var, T, name)                                            \
    do {                                                                   \
        var = reinterpret_cast<T>(dlsym(g_lib, name));                     \
        if (!(var)) {                                                      \
            const char* dl_err = dlerror();                                \
            dlclose(g_lib); g_lib = nullptr;                               \
            std::string msg = std::string("gcpadLoad: missing export: ")   \
                            + name + " (" + (dl_err ? dl_err : "?") + ")"; \
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();       \
            return env.Null();                                             \
        }                                                                  \
    } while (0)

namespace uc_gcpad {

Napi::Value GCPadLoad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "gcpadLoad: expected (libPath: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    if (g_lib) return Napi::Boolean::New(env, true);

    std::string lib_path = info[0].As<Napi::String>().Utf8Value();

    // RTLD_NOW: resolve all symbols up front so a broken .so fails here, not
    // mid-call. RTLD_LOCAL: don't pollute the global namespace (matters because
    // libgcpad itself dlopens X11/XTest).
    g_lib = dlopen(lib_path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!g_lib) {
        // dlerror is the only way to get a useful diagnostic
        const char* err = dlerror();
        std::string msg = std::string("gcpadLoad: dlopen failed: ")
                        + (err ? err : "unknown");
        // Throw rather than return false so the JS side gets the dl error.
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Null();
    }

    LOAD_SYM(g_fn_create,   Fn_create,   "gcpad_create_manager");
    LOAD_SYM(g_fn_destroy,  Fn_destroy,  "gcpad_destroy_manager");
    LOAD_SYM(g_fn_init,     Fn_init,     "gcpad_initialize");
    LOAD_SYM(g_fn_shutdown, Fn_shutdown, "gcpad_shutdown");
    LOAD_SYM(g_fn_update,   Fn_update,   "gcpad_update_all");
    LOAD_SYM(g_fn_maxslots, Fn_maxslots, "gcpad_get_max_slots");
    LOAD_SYM(g_fn_getstate, Fn_getstate, "gcpad_get_state");
    LOAD_SYM(g_fn_getname,  Fn_getname,  "gcpad_get_name");
    LOAD_SYM(g_fn_rumble,   Fn_rumble,   "gcpad_set_rumble");
    LOAD_SYM(g_fn_led,      Fn_led,      "gcpad_set_led");
    LOAD_SYM(g_fn_setconn,  Fn_setconn,  "gcpad_set_connected_callback");
    LOAD_SYM(g_fn_setdisc,  Fn_setdisc,  "gcpad_set_disconnected_callback");

    g_mgr = g_fn_create();
    if (!g_mgr) {
        dlclose(g_lib); g_lib = nullptr;
        return env.Undefined();
    }

    g_fn_setconn(g_mgr, gcpad_on_connected,    nullptr);
    g_fn_setdisc(g_mgr, gcpad_on_disconnected, nullptr);

    if (!g_fn_init(g_mgr)) {
        g_fn_destroy(g_mgr); g_mgr = nullptr;
        dlclose(g_lib); g_lib = nullptr;
        return env.Undefined();
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value GCPadUnload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_mgr && g_fn_shutdown) g_fn_shutdown(g_mgr);

    {
        std::lock_guard<std::mutex> lk(g_cb_mtx);
        if (g_conn_valid) { g_conn_tsfn.Release(); g_conn_valid = false; }
        if (g_disc_valid) { g_disc_tsfn.Release(); g_disc_valid = false; }
    }

    if (g_mgr && g_fn_destroy) { g_fn_destroy(g_mgr); g_mgr = nullptr; }
    if (g_lib) { dlclose(g_lib); g_lib = nullptr; }

    g_fn_create = nullptr; g_fn_destroy = nullptr; g_fn_init    = nullptr;
    g_fn_shutdown = nullptr; g_fn_update = nullptr; g_fn_maxslots = nullptr;
    g_fn_getstate = nullptr; g_fn_getname = nullptr; g_fn_rumble = nullptr;
    g_fn_led      = nullptr; g_fn_setconn = nullptr; g_fn_setdisc = nullptr;

    return env.Undefined();
}

Napi::Value GCPadUpdateAll(const Napi::CallbackInfo& info) {
    if (g_mgr && g_fn_update) g_fn_update(g_mgr);
    return info.Env().Undefined();
}

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

Napi::Value GCPadSetRumble(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || !g_fn_rumble || info.Length() < 3 ||
        !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber())
        return env.Undefined();
    int slot  = info[0].As<Napi::Number>().Int32Value();
    int left  = info[1].As<Napi::Number>().Int32Value();
    int right = info[2].As<Napi::Number>().Int32Value();
    auto clamp = [](int v) -> uint8_t {
        return static_cast<uint8_t>(v < 0 ? 0 : v > 255 ? 255 : v);
    };
    return Napi::Boolean::New(env, g_fn_rumble(g_mgr, slot, clamp(left), clamp(right)) != 0);
}

Napi::Value GCPadSetLed(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || !g_fn_led || info.Length() < 4 ||
        !info[0].IsNumber() || !info[1].IsNumber() ||
        !info[2].IsNumber() || !info[3].IsNumber())
        return env.Undefined();
    int slot = info[0].As<Napi::Number>().Int32Value();
    int r    = info[1].As<Napi::Number>().Int32Value();
    int g    = info[2].As<Napi::Number>().Int32Value();
    int b    = info[3].As<Napi::Number>().Int32Value();
    auto clamp = [](int v) -> uint8_t {
        return static_cast<uint8_t>(v < 0 ? 0 : v > 255 ? 255 : v);
    };
    return Napi::Boolean::New(env, g_fn_led(g_mgr, slot, clamp(r), clamp(g), clamp(b)) != 0);
}

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

// ── SendInput-equivalent entry points (no-op on Linux) ──────────────────────
//
// On Linux, key/mouse injection from JS isn't supported here. Use the
// remapper API instead — it routes through GCPad's own GamepadInputRemapper,
// which speaks X11/XTest in libgcpad on this platform.

static Napi::Value PosixUnsupported(const Napi::CallbackInfo& info, const char* fn) {
    Napi::Env env = info.Env();
    Napi::Error::New(env, std::string(fn)
        + " is not implemented on Linux; use the gcpad remapper API instead.")
        .ThrowAsJavaScriptException();
    return env.Null();
}

Napi::Value GCPadSendKeyboard(const Napi::CallbackInfo& info)    { return PosixUnsupported(info, "gcpadSendKeyboard"); }
Napi::Value GCPadSendMouseButton(const Napi::CallbackInfo& info) { return PosixUnsupported(info, "gcpadSendMouseButton"); }
Napi::Value GCPadSendMouseMove(const Napi::CallbackInfo& info)   { return PosixUnsupported(info, "gcpadSendMouseMove"); }
Napi::Value GCPadSendMouseWheel(const Napi::CallbackInfo& info)  { return PosixUnsupported(info, "gcpadSendMouseWheel"); }

// DualSense trigger / player LEDs (looked up lazily; not all builds export)
Napi::Value GCPadSetTriggerEffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || !g_lib || info.Length() < 8) return env.Undefined();
    typedef int (*Fn_trigger)(GCPadManagerHandle, int, int, uint8_t, uint8_t, uint8_t, uint8_t, uint8_t, uint8_t);
    static Fn_trigger fn = nullptr;
    if (!fn) fn = reinterpret_cast<Fn_trigger>(dlsym(g_lib, "gcpad_set_trigger_effect"));
    if (!fn) return env.Undefined();
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

Napi::Value GCPadSetPlayerLeds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_mgr || !g_lib || info.Length() < 2) return env.Undefined();
    typedef int (*Fn_pleds)(GCPadManagerHandle, int, uint8_t);
    static Fn_pleds fn = nullptr;
    if (!fn) fn = reinterpret_cast<Fn_pleds>(dlsym(g_lib, "gcpad_set_player_leds"));
    if (!fn) return env.Undefined();
    int slot = info[0].As<Napi::Number>().Int32Value();
    uint8_t mask = static_cast<uint8_t>(info[1].As<Napi::Number>().Uint32Value());
    return Napi::Boolean::New(env, fn(g_mgr, slot, mask) != 0);
}

// ── Remapper (drives libgcpad's own X11/XTest path on Linux) ────────────────

static void* g_remapper = nullptr;

typedef void* (*Fn_remapper_create)();
typedef void  (*Fn_remapper_destroy)(void*);
typedef void  (*Fn_remapper_map_btn_key)(void*, int, uint16_t);
typedef void  (*Fn_remapper_map_btn_mouse)(void*, int, int);
typedef void  (*Fn_remapper_map_axis_mouse)(void*, int, float, float, int, float);
typedef void  (*Fn_remapper_map_axis_key)(void*, int, uint16_t, float, int);
typedef void  (*Fn_remapper_map_axis_mouse_btn)(void*, int, int, float);
typedef void  (*Fn_remapper_clear_all)(void*);
typedef void  (*Fn_remapper_send_input)(void*, void*, void*);
typedef void  (*Fn_remapper_reset_state)(void*);

static Fn_remapper_create        g_fn_remapper_create        = nullptr;
static Fn_remapper_destroy       g_fn_remapper_destroy       = nullptr;
static Fn_remapper_map_btn_key   g_fn_remapper_map_btn_key   = nullptr;
static Fn_remapper_map_btn_mouse g_fn_remapper_map_btn_mouse = nullptr;
static Fn_remapper_map_axis_mouse g_fn_remapper_map_axis_mouse = nullptr;
static Fn_remapper_map_axis_key  g_fn_remapper_map_axis_key  = nullptr;
static Fn_remapper_map_axis_mouse_btn g_fn_remapper_map_axis_mouse_btn = nullptr;
static Fn_remapper_clear_all     g_fn_remapper_clear_all     = nullptr;
static Fn_remapper_send_input    g_fn_remapper_send_input    = nullptr;
static Fn_remapper_reset_state   g_fn_remapper_reset_state   = nullptr;

static void resolve_remapper_fns() {
    if (!g_lib || g_fn_remapper_create) return;
    g_fn_remapper_create        = reinterpret_cast<Fn_remapper_create>(dlsym(g_lib, "gcpad_remapper_create"));
    g_fn_remapper_destroy       = reinterpret_cast<Fn_remapper_destroy>(dlsym(g_lib, "gcpad_remapper_destroy"));
    g_fn_remapper_map_btn_key   = reinterpret_cast<Fn_remapper_map_btn_key>(dlsym(g_lib, "gcpad_remapper_map_button_to_key"));
    g_fn_remapper_map_btn_mouse = reinterpret_cast<Fn_remapper_map_btn_mouse>(dlsym(g_lib, "gcpad_remapper_map_button_to_mouse"));
    g_fn_remapper_map_axis_mouse = reinterpret_cast<Fn_remapper_map_axis_mouse>(dlsym(g_lib, "gcpad_remapper_map_axis_to_mouse"));
    g_fn_remapper_map_axis_key  = reinterpret_cast<Fn_remapper_map_axis_key>(dlsym(g_lib, "gcpad_remapper_map_axis_to_key"));
    g_fn_remapper_map_axis_mouse_btn = reinterpret_cast<Fn_remapper_map_axis_mouse_btn>(dlsym(g_lib, "gcpad_remapper_map_axis_to_mouse_button"));
    g_fn_remapper_clear_all     = reinterpret_cast<Fn_remapper_clear_all>(dlsym(g_lib, "gcpad_remapper_clear_all"));
    g_fn_remapper_send_input    = reinterpret_cast<Fn_remapper_send_input>(dlsym(g_lib, "gcpad_remapper_send_input"));
    g_fn_remapper_reset_state   = reinterpret_cast<Fn_remapper_reset_state>(dlsym(g_lib, "gcpad_remapper_reset_state"));
}

Napi::Value GCPadRemapperCreate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_lib) return env.Null();
    resolve_remapper_fns();
    if (!g_fn_remapper_create) return env.Null();
    g_remapper = g_fn_remapper_create();
    return Napi::Boolean::New(env, g_remapper != nullptr);
}

Napi::Value GCPadRemapperDestroy(const Napi::CallbackInfo& info) {
    if (g_remapper && g_fn_remapper_destroy) {
        g_fn_remapper_destroy(g_remapper);
        g_remapper = nullptr;
    }
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperMapButtonToKey(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_btn_key || info.Length() < 2 ||
        !info[0].IsNumber() || !info[1].IsNumber()) return env.Undefined();
    g_fn_remapper_map_btn_key(g_remapper,
        info[0].As<Napi::Number>().Int32Value(),
        static_cast<uint16_t>(info[1].As<Napi::Number>().Uint32Value()));
    return env.Undefined();
}

Napi::Value GCPadRemapperMapButtonToMouse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_btn_mouse || info.Length() < 2 ||
        !info[0].IsNumber() || !info[1].IsNumber()) return env.Undefined();
    g_fn_remapper_map_btn_mouse(g_remapper,
        info[0].As<Napi::Number>().Int32Value(),
        info[1].As<Napi::Number>().Int32Value());
    return env.Undefined();
}

Napi::Value GCPadRemapperMapAxisToMouse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_axis_mouse || info.Length() < 5 ||
        !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() ||
        !info[3].IsBoolean() || !info[4].IsNumber()) return env.Undefined();
    g_fn_remapper_map_axis_mouse(g_remapper,
        info[0].As<Napi::Number>().Int32Value(),
        static_cast<float>(info[1].As<Napi::Number>().DoubleValue()),
        static_cast<float>(info[2].As<Napi::Number>().DoubleValue()),
        info[3].As<Napi::Boolean>().Value() ? 1 : 0,
        static_cast<float>(info[4].As<Napi::Number>().DoubleValue()));
    return env.Undefined();
}

Napi::Value GCPadRemapperMapAxisToKey(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_axis_key || info.Length() < 4 ||
        !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() ||
        !info[3].IsBoolean()) return env.Undefined();
    g_fn_remapper_map_axis_key(g_remapper,
        info[0].As<Napi::Number>().Int32Value(),
        static_cast<uint16_t>(info[1].As<Napi::Number>().Uint32Value()),
        static_cast<float>(info[2].As<Napi::Number>().DoubleValue()),
        info[3].As<Napi::Boolean>().Value() ? 1 : 0);
    return env.Undefined();
}

Napi::Value GCPadRemapperMapAxisToMouseButton(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_map_axis_mouse_btn || info.Length() < 3 ||
        !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) return env.Undefined();
    g_fn_remapper_map_axis_mouse_btn(g_remapper,
        info[0].As<Napi::Number>().Int32Value(),
        info[1].As<Napi::Number>().Int32Value(),
        static_cast<float>(info[2].As<Napi::Number>().DoubleValue()));
    return env.Undefined();
}

Napi::Value GCPadRemapperClearAll(const Napi::CallbackInfo& info) {
    if (g_remapper && g_fn_remapper_clear_all) g_fn_remapper_clear_all(g_remapper);
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperSendInput(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_remapper || !g_fn_remapper_send_input) return env.Undefined();
    g_fn_remapper_send_input(g_remapper, nullptr, nullptr);
    return env.Undefined();
}

Napi::Value GCPadRemapperResetState(const Napi::CallbackInfo& info) {
    if (g_remapper && g_fn_remapper_reset_state) g_fn_remapper_reset_state(g_remapper);
    return info.Env().Undefined();
}

} // namespace uc_gcpad
