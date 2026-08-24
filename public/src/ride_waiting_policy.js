// BD-RIDE-WAITING-POLICY-01A (#912) — shared waiting-policy constants.
// Pure leaf module: zero imports, no localStorage, no backend, no DOM/window/
// navigation, no timers, no Ride mutation, no state transition. Every real
// Ride-construction site and every screen-level fallback chain that assumed
// these same literal values independently now imports them from here instead,
// so there is exactly one place to change the free-wait duration or the
// per-minute paid rate. Purely mechanical — no behavior change.

export const DEFAULT_FREE_WAIT_LIMIT = '3:00';
export const DEFAULT_PAID_RATE_LABEL = '8 ₽ за каждую минуту';
