/**
 * gcpad_c.h — Plain C ABI for the GCPad library.
 *
 * Provides a stable, name-mangling-free interface that can be consumed by
 * any language capable of calling a Windows DLL via LoadLibrary/GetProcAddress,
 * including N-API native addons, Python ctypes, and Rust FFI.
 *
 * All types are POD / C-compatible.  No C++ STL types cross the boundary.
 */

#pragma once

#ifdef __cplusplus
extern "C" {
#endif

#ifdef _WIN32
#  ifdef GCPAD_API_EXPORTS
#    define GCPAD_C_API __declspec(dllexport)
#  else
#    define GCPAD_C_API __declspec(dllimport)
#  endif
#else
#  define GCPAD_C_API
#endif

#include <stdint.h>

/* Button indices — match gcpad::Button enum order */
#define GCPAD_BUTTON_A           0
#define GCPAD_BUTTON_B           1
#define GCPAD_BUTTON_X           2
#define GCPAD_BUTTON_Y           3
#define GCPAD_BUTTON_START       4
#define GCPAD_BUTTON_SELECT      5
#define GCPAD_BUTTON_GUIDE       6
#define GCPAD_BUTTON_L1          7
#define GCPAD_BUTTON_R1          8
#define GCPAD_BUTTON_L2          9
#define GCPAD_BUTTON_R2          10
#define GCPAD_BUTTON_L3          11
#define GCPAD_BUTTON_R3          12
#define GCPAD_BUTTON_DPAD_UP     13
#define GCPAD_BUTTON_DPAD_DOWN   14
#define GCPAD_BUTTON_DPAD_LEFT   15
#define GCPAD_BUTTON_DPAD_RIGHT  16
#define GCPAD_BUTTON_TOUCHPAD    17
#define GCPAD_BUTTON_COUNT       18

/* Axis indices — match gcpad::Axis enum order */
#define GCPAD_AXIS_LEFT_X        0
#define GCPAD_AXIS_LEFT_Y        1
#define GCPAD_AXIS_RIGHT_X       2
#define GCPAD_AXIS_RIGHT_Y       3
#define GCPAD_AXIS_LEFT_TRIGGER  4
#define GCPAD_AXIS_RIGHT_TRIGGER 5
#define GCPAD_AXIS_COUNT         6

#define GCPAD_MAX_SLOTS          4

/**
 * Snapshot of a single controller's state.
 * All fields are zeroed / false when the slot is empty.
 * buttons[GCPAD_BUTTON_TOUCHPAD] is the touchpad click button.
 * gyro_x/y/z and accel_x/y/z are in physical units (deg/s and m/s^2).
 */
typedef struct GCPadStateC {
    uint8_t  buttons[GCPAD_BUTTON_COUNT]; /* 1 = pressed, 0 = released */
    uint8_t  _pad0[2];                    /* alignment padding before float */
    float    axes[GCPAD_AXIS_COUNT];      /* -1.0 .. +1.0 (triggers 0.0 .. 1.0) */
    float   gyro_x,  gyro_y,  gyro_z;   /* degrees/s, 0 if unavailable */
    float   accel_x, accel_y, accel_z;  /* m/s², 0 if unavailable */
    float    battery_level;              /* 0.0 = empty, 1.0 = full */
    uint8_t  is_charging;
    uint8_t  is_connected;
    uint8_t  touchpad_active[2];         /* 1 = finger touching, index 0/1 */
    uint16_t touchpad_x[2];              /* finger X coordinate, 0..1919 */
    uint16_t touchpad_y[2];              /* finger Y coordinate, 0..941 (DS4) / 0..1079 (DualSense) */
} GCPadStateC;

/** Opaque manager handle — never dereference from caller code. */
typedef void* GCPadManagerHandle;

/** Hotplug callback fired from the GCPad hotplug thread. */
typedef void (*GCPadHotplugCallback)(int slot, void* userdata);

/* ── Lifecycle ──────────────────────────────────────────────────────────────── */

/** Allocate a new manager.  Must be freed with gcpad_destroy_manager. */
GCPAD_C_API GCPadManagerHandle gcpad_create_manager(void);

/** Destroy the manager (shuts down subsystems if still running). */
GCPAD_C_API void gcpad_destroy_manager(GCPadManagerHandle mgr);

/**
 * Initialise the manager: enumerate devices, start hotplug thread.
 * Set callbacks BEFORE calling this so initial-connect events are delivered.
 * Returns 1 on success, 0 on failure.
 */
GCPAD_C_API int gcpad_initialize(GCPadManagerHandle mgr);

/** Stop the hotplug thread and release device resources. */
GCPAD_C_API void gcpad_shutdown(GCPadManagerHandle mgr);

/* ── Per-frame update ───────────────────────────────────────────────────────── */

/** Poll and update state for every connected controller. Call once per frame. */
GCPAD_C_API void gcpad_update_all(GCPadManagerHandle mgr);

/* ── Device queries ─────────────────────────────────────────────────────────── */

/** Maximum number of simultaneous controller slots. */
GCPAD_C_API int gcpad_get_max_slots(GCPadManagerHandle mgr);

/**
 * Fill *out with the current state of the controller in the given slot.
 * Returns 1 if the slot is occupied and connected, 0 if empty/disconnected
 * (in which case *out is zeroed).
 */
GCPAD_C_API int gcpad_get_state(GCPadManagerHandle mgr, int slot, GCPadStateC* out);

/**
 * Copy the device name (UTF-8) into buf (null-terminated, up to buf_len-1 chars).
 * Returns 1 on success, 0 if slot is empty.
 */
GCPAD_C_API int gcpad_get_name(GCPadManagerHandle mgr, int slot, char* buf, int buf_len);

/* ── Output ─────────────────────────────────────────────────────────────────── */

/**
 * Send a rumble command to the controller in the given slot.
 * left/right are motor intensities in [0, 255].
 * Returns 1 on success, 0 if the controller doesn't support rumble or isn't connected.
 */
GCPAD_C_API int gcpad_set_rumble(GCPadManagerHandle mgr, int slot,
                                  uint8_t left_motor, uint8_t right_motor);

/**
 * Set the LED colour of the controller in the given slot (r, g, b each in [0, 255]).
 * Returns 1 on success, 0 if the controller doesn't have an LED or isn't connected.
 */
GCPAD_C_API int gcpad_set_led(GCPadManagerHandle mgr, int slot,
                               uint8_t r, uint8_t g, uint8_t b);

/* ── Hotplug callbacks ──────────────────────────────────────────────────────── */

/**
 * Register a callback fired (from the hotplug thread) when a controller connects.
 * Set before gcpad_initialize to receive initial-connect events.
 * Pass NULL to clear.
 */
GCPAD_C_API void gcpad_set_connected_callback(GCPadManagerHandle mgr,
                                               GCPadHotplugCallback cb,
                                               void* userdata);

/**
 * Register a callback fired (from the hotplug thread) when a controller disconnects.
 * Pass NULL to clear.
 */
GCPAD_C_API void gcpad_set_disconnected_callback(GCPadManagerHandle mgr,
                                                  GCPadHotplugCallback cb,
                                                  void* userdata);

#ifdef __cplusplus
} /* extern "C" */
#endif
