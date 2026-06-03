/**
 * gcpad_bridge_linux.cpp — N-API bridge for the GCPad controller library on Linux.
 *
 * Loads libgcpad.so at runtime via dlopen and exposes its C ABI to Electron's main process.
 */

#ifndef NAPI_HAS_THREADS
#define NAPI_HAS_THREADS 1
#endif

#include <napi.h>
/* if you are on windows, get used to this thing bitching at ya. ~vee */
#include <dlfcn.h>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>

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

static void*               g_dll  = nullptr;
static GCPadManagerHandle  g_mgr  = nullptr;

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

static std::mutex              g_cb_mtx;
static Napi::ThreadSafeFunction g_conn_tsfn;
static Napi::ThreadSafeFunction g_disc_tsfn;
static bool                    g_conn_valid = false;
static bool                    g_disc_valid = false;

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

#define LOAD_PROC(var, T, name)                                          \
    do {                                                                  \
        var = reinterpret_cast<T>(dlsym(g_dll, name));                    \
        if (!(var)) {                                                     \
            dlclose(g_dll); g_dll = nullptr;                              \
            Napi::Error::New(env, std::string("gcpadLoad: missing export: ") + name) \
                .ThrowAsJavaScriptException();                              \
            return env.Null();                                             \
        }                                                                 \
    } while (0)

namespace uc_gcpad {

Napi::Value GCPadLoad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "gcpadLoad: expected (libPath: string)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    if (g_dll) return Napi::Boolean::New(env, true);

    std::string lib_path = info[0].As<Napi::String>().Utf8Value();

    g_dll = dlopen(lib_path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!g_dll) {
        Napi::Error::New(env, std::string("gcpadLoad: ") + dlerror()).ThrowAsJavaScriptException();
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
        dlclose(g_dll);
        g_dll = nullptr;
        return Napi::Boolean::New(env, false);
    }

    g_fn_setconn(g_mgr, gcpad_on_connected, nullptr);
    g_fn_setdisc(g_mgr, gcpad_on_disconnected, nullptr);

    if (!g_fn_init(g_mgr)) {
        g_fn_destroy(g_mgr);
        g_mgr = nullptr;
        dlclose(g_dll);
        g_dll = nullptr;
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value GCPadUnload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (g_mgr && g_fn_shutdown) {
        g_fn_shutdown(g_mgr);
    }

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
        dlclose(g_dll);
        g_dll = nullptr;
    }

    g_fn_create = nullptr; g_fn_destroy = nullptr; g_fn_init = nullptr;
    g_fn_shutdown = nullptr; g_fn_update = nullptr; g_fn_maxslots = nullptr;
    g_fn_getstate = nullptr; g_fn_getname = nullptr; g_fn_rumble = nullptr;
    g_fn_led = nullptr; g_fn_setconn = nullptr; g_fn_setdisc = nullptr;

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

Napi::Value GCPadRemapperCreate(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value GCPadRemapperDestroy(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperMapButtonToKey(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperMapButtonToMouse(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperMapAxisToMouse(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperMapAxisToKey(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperClearAll(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value GCPadRemapperSendInput(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value GCPadRemapperResetState(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

} // namespace uc_gcpad