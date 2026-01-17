export const STAFF_ROLES: Record<string, string> = {
  "1344736198438158407": "Head UC Team",
  "1327385775381418094": "Head UC Team, Developer",
  "1387386507853172746": "Sup-Head UC Team",
}

export function isStaff(discordId?: string | null): boolean {
  if (!discordId) return false
  return Boolean(STAFF_ROLES[discordId])
}
