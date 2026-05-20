import { AuraBackground } from "@/components/aura-background"
import { useHoveredCardAura } from "@/hooks/use-hovered-card-aura"
import { useMotionPreferences } from "@/hooks/use-motion-preferences"

/**
 * Drop-in full-page aura background that reacts to game card hovers.
 * Renders an `AuraBackground` whose colors follow whichever `GameArtAura`-wrapped
 * card the user is currently hovering. Fades fully out when no card is hovered.
 */
export function PageAura() {
  const { opacity, colors } = useHoveredCardAura()
  const { colorAuraEffective, reducedMotionEffective } = useMotionPreferences()

  return (
    <div
      className="pointer-events-none"
      style={{
        opacity,
        // ease-in-out so brightness builds and decays gradually — ease-in
        // front-loaded the change at the end and felt like a flash when
        // stacked over an existing aura layer.
        transition: opacity === 1
          ? "opacity 1.6s cubic-bezier(0.4, 0, 0.2, 1)"
          : "opacity 1.1s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <AuraBackground
        colors={colors}
        show={colorAuraEffective}
        reducedMotion={reducedMotionEffective}
      />
    </div>
  )
}
