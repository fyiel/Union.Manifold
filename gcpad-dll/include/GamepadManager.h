#pragma once

#include "gcpad.h"
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace gcpad {

// Forward declarations
class GamepadManager;
class GamepadDevice;

// Gamepad device interface
class GCPAD_API GamepadDevice {
public:
    virtual ~GamepadDevice() = default;

    // Device information
    virtual int getIndex() const = 0;
    virtual std::string getName() const = 0;
    virtual std::string getSerialNumber() const = 0;

    // State access
    virtual const GamepadState& getState() const = 0;
    virtual bool updateState() = 0;

    // Control functions
    virtual bool setLED(const Color& color) = 0;
    virtual bool setRumble(const Rumble& rumble) = 0;

    // Remapping support
    virtual void setRemapper(std::shared_ptr<Remapper> remapper) = 0;
    virtual GamepadState getRemappedState() const = 0;

    // Connection status
    virtual bool isConnected() const = 0;
};

// Gamepad manager - main API interface
class GCPAD_API GamepadManager {
public:
    static std::unique_ptr<GamepadManager> create();
    virtual ~GamepadManager() = default;

    // Initialization and cleanup
    virtual bool initialize() = 0;
    virtual void shutdown() = 0;

    // Device enumeration
    virtual int getMaxGamepads() const = 0;
    virtual int getConnectedGamepadCount() const = 0;
    virtual std::vector<int> getConnectedGamepadIndices() const = 0;

    // Device access
    virtual GamepadDevice* getGamepad(int index) = 0;
    virtual const GamepadDevice* getGamepad(int index) const = 0;

    // Hotplug callbacks
    using GamepadConnectedCallback = std::function<void(int index)>;
    using GamepadDisconnectedCallback = std::function<void(int index)>;

    virtual void setGamepadConnectedCallback(GamepadConnectedCallback callback) = 0;
    virtual void setGamepadDisconnectedCallback(GamepadDisconnectedCallback callback) = 0;

    // Update all devices
    virtual void updateAll() = 0;

    // Remapper control
    virtual void setRemapper(std::shared_ptr<Remapper> remapper) = 0;
    virtual std::shared_ptr<Remapper> getRemapper() const = 0;

    // Utility functions
    virtual std::string getLastError() const = 0;
};

// HID device info for debugging
struct GCPAD_API HidDeviceInfo {
    uint16_t vendor_id;
    uint16_t product_id;
    std::string product_string;
    std::string device_path;
};

// Convenience functions for easy access
GCPAD_API std::unique_ptr<GamepadManager> createGamepadManager();
GCPAD_API std::vector<HidDeviceInfo> getAllHidDevices();
GCPAD_API bool initializeGamepadManager(GamepadManager* manager);
GCPAD_API void shutdownGamepadManager(GamepadManager* manager);
GCPAD_API int getConnectedGamepadCount(GamepadManager* manager);
GCPAD_API GamepadDevice* getGamepad(GamepadManager* manager, int index);
GCPAD_API bool updateGamepad(GamepadDevice* gamepad);
GCPAD_API const GamepadState& getGamepadState(GamepadDevice* gamepad);

GCPAD_API void setGlobalRemapper(GamepadManager* manager, std::shared_ptr<Remapper> remapper);
GCPAD_API std::shared_ptr<Remapper> getGlobalRemapper(GamepadManager* manager);

} // namespace gcpad