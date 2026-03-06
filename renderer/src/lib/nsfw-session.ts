/**
 * In-memory set of appids the user has manually revealed this page session.
 *
 * Intentionally NOT stored in sessionStorage or localStorage — it resets on
 * every hard refresh/reload, so reveals are truly ephemeral (gone when the
 * page is reloaded). Persists only during client-side navigation within the
 * same SPA session, which is the expected UX.
 */
export const nsfwRevealedAppids = new Set<string>()
