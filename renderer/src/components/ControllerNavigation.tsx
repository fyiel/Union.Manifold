import { useController } from '../hooks/use-controller'
import { useControllerNavigation } from '../hooks/use-controller-navigation'

/**
 * Headless component: wires the user's controller settings into the global
 * gamepad navigation + haptics engine. Mounted once inside the app shell (not
 * on the in-game overlay window). Renders nothing.
 */
export function ControllerNavigation() {
  const { settings } = useController()

  useControllerNavigation({
    enabled: settings.enabled,
    hapticsEnabled: settings.vibrationEnabled,
    deadzone: settings.deadzone,
  })

  return null
}

export default ControllerNavigation
