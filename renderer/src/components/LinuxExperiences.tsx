// Backwards-compatible re-export. The old "Linux Experiences" accordion has
// been folded into the general per-game rating panel — see GameExperience.tsx.
// Existing imports of `LinuxExperiences` continue to resolve to the new panel.
export { GameExperience as LinuxExperiences, GameExperience as default } from "./GameExperience"
