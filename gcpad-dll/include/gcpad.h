#pragma once

#include <cstdint>
#include <array>
#include <chrono>

#ifdef GCPAD_API_EXPORTS
#define GCPAD_API __declspec(dllexport)
#else
#define GCPAD_API __declspec(dllimport)
#endif

namespace gcpad {

// Gamepad button enumeration
enum class Button {
    A, B, X, Y,
    Start, Select, Guide,
    L1, R1, L2, R2, L3, R3,
    DPad_Up, DPad_Down, DPad_Left, DPad_Right,
    Touchpad,
    COUNT
};

// Gamepad axis enumeration
enum class Axis {
    LeftX, LeftY, RightX, RightY,
    LeftTrigger, RightTrigger,
    COUNT
};

// Single touchpad finger contact
struct TouchPoint {
    bool     active = false;
    uint16_t x      = 0;    // 0..1919 (DS4/DualSense touchpad width)
    uint16_t y      = 0;    // 0..941 (DS4) / 0..1079 (DualSense touchpad height)
};

// Sensor calibration scale factors (multiply raw int16 by these to get physical units)
namespace calibration {
    // Sony DS4 / DualSense: gyro ±2000 deg/s, accel ±4g
    constexpr float SONY_GYRO_SCALE  = 2000.0f / 32768.0f;   // deg/s per LSB
    constexpr float SONY_ACCEL_SCALE = 9.80665f / 8192.0f;   // m/s² per LSB
    // Nintendo Pro Controller / Joy-Con: gyro ±2000 deg/s, accel ±8g
    constexpr float NINTENDO_GYRO_SCALE  = 2000.0f / 32768.0f;   // deg/s per LSB
    constexpr float NINTENDO_ACCEL_SCALE = 9.80665f / 4096.0f;   // m/s² per LSB
} // namespace calibration

// Gamepad state structure
struct GCPAD_API GamepadState {
    // Digital buttons (true = pressed)
    std::array<bool, static_cast<size_t>(Button::COUNT)> buttons = {};

    // Analog axes (-1.0 to 1.0, centered at 0.0)
    std::array<float, static_cast<size_t>(Axis::COUNT)> axes = {};

    // Motion sensors (if available)
    struct {
        float x = 0.0f, y = 0.0f, z = 0.0f;
    } gyro, accel;

    // Touchpad finger contacts (index 0 = first finger, 1 = second finger)
    std::array<TouchPoint, 2> touchpad = {};

    // Battery level (0.0 = empty, 1.0 = full)
    float battery_level = 0.0f;
    bool is_charging = false;

    // Connection status
    bool is_connected = false;

    // Timestamp of last update (stored as nanoseconds to avoid DLL interface warning)
private:
    uint64_t timestamp_nanoseconds_ = 0;

public:
    // Helper functions
    bool isButtonPressed(Button btn) const {
        return buttons[static_cast<size_t>(btn)];
    }

    float getAxis(Axis axis) const {
        return axes[static_cast<size_t>(axis)];
    }

    std::chrono::steady_clock::time_point getTimestamp() const {
        return std::chrono::steady_clock::time_point(std::chrono::nanoseconds(timestamp_nanoseconds_));
    }

    void setTimestamp(std::chrono::steady_clock::time_point ts) {
        timestamp_nanoseconds_ = ts.time_since_epoch().count();
    }

    void reset() {
        buttons.fill(false);
        axes.fill(0.0f);
        gyro = {0.0f, 0.0f, 0.0f};
        accel = {0.0f, 0.0f, 0.0f};
        touchpad = {};
        battery_level = 0.0f;
        is_charging = false;
        is_connected = false;
        timestamp_nanoseconds_ = std::chrono::steady_clock::now().time_since_epoch().count();
    }

    // Constructor to initialize timestamp
    GamepadState() {
        reset();
    }
};

// Gamepad LED color
struct GCPAD_API Color {
    uint8_t r = 0, g = 0, b = 0;

    Color() = default;
    Color(uint8_t red, uint8_t green, uint8_t blue) : r(red), g(green), b(blue) {}
};

// Gamepad rumble motors
struct GCPAD_API Rumble {
    uint8_t left_motor = 0;   // Low-frequency motor (0-255)
    uint8_t right_motor = 0;  // High-frequency motor (0-255)

    Rumble() = default;
    Rumble(uint8_t left, uint8_t right) : left_motor(left), right_motor(right) {}
};

// Remapper rules and API
struct GCPAD_API Remapper {
    std::array<Button, static_cast<size_t>(Button::COUNT)> button_map;
    std::array<Axis, static_cast<size_t>(Axis::COUNT)> axis_map;

    Remapper() {
        for (size_t i = 0; i < button_map.size(); ++i) {
            button_map[i] = static_cast<Button>(i);
        }
        for (size_t i = 0; i < axis_map.size(); ++i) {
            axis_map[i] = static_cast<Axis>(i);
        }
    }

    void mapButton(Button source, Button target) {
        button_map[static_cast<size_t>(source)] = target;
    }

    void mapAxis(Axis source, Axis target) {
        axis_map[static_cast<size_t>(source)] = target;
    }

    void reset() {
        for (size_t i = 0; i < button_map.size(); ++i) {
            button_map[i] = static_cast<Button>(i);
        }
        for (size_t i = 0; i < axis_map.size(); ++i) {
            axis_map[i] = static_cast<Axis>(i);
        }
    }

    GamepadState apply(const GamepadState& state) const {
        GamepadState out = state;

        std::array<bool, static_cast<size_t>(Button::COUNT)> remapped_buttons{};
        for (size_t i = 0; i < button_map.size(); ++i) {
            if (state.buttons[i]) {
                remapped_buttons[static_cast<size_t>(button_map[i])] = true;
            }
        }
        out.buttons = remapped_buttons;

        std::array<float, static_cast<size_t>(Axis::COUNT)> remapped_axes{};
        for (size_t i = 0; i < axis_map.size(); ++i) {
            remapped_axes[static_cast<size_t>(axis_map[i])] = state.axes[i];
        }
        out.axes = remapped_axes;

        return out;
    }
};

struct GCPAD_API BuildMetadata {
    const char* package_version;
    const char* git_commit;
    const char* build_timestamp;
    const char* build_generator;
};

GCPAD_API BuildMetadata getBuildMetadata();

} // namespace gcpad