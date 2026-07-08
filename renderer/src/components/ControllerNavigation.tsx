import { useController } from '../hooks/use-controller'
import { useControllerNavigation } from '../hooks/use-controller-navigation'

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
