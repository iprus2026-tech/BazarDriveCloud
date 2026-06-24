// BD-OPS / #684 #9 — ScreenOps blast-radius / shared-state map (pure, no I/O).
//
// A MEL repair that writes a SHARED store or a SHARED id does not stay on its own
// screen — other screens read the same data. The smoke cross-check (#685) tells you
// a behavior is SAFE to change (not pinned); it does NOT tell you what ELSE a write
// touches. This module maps the runtime's shared write-surfaces to their downstream
// CONSUMER surfaces, so the MEL card and the repair prompt remind the developer to
// verify them BEFORE writing. Curated knowledge, not a live trace: read it as
// "verify these", not "these are guaranteed".
//
// Every entry was a real BD-RESPONSES-01 (PR #688) blast-radius miss:
//   ride_orders -> Feed + DriverMap   (a CREATED demo order leaked into both)
//   tripId      -> chat + ride history + driver receipts + active-ride store
//                  (all keyed by tripId; a reused id inherited a finished trip)

export const SHARED_SURFACE_MAP = [
  {
    key: 'ride_orders',
    label: 'the shared ride-order store',
    // Tokens whose presence in a MEL's text/file flags this store as in play. The
    // scan is deliberately generous — over-surfacing a reminder is cheap; missing
    // one is the bug this exists to prevent.
    triggers: ['ride_orders', 'rideorder', 'ride-order', 'ride order', 'createrideorder',
      'listnearbyorders', 'rideordertofeedpost', 'getorderbyid', 'persistrideorders',
      // canonical ride-order mutation APIs (called from /responses + active-ride flows)
      'acceptnearbyorder', 'acceptorder', 'updatetripstatus'],
    surfaces: [
      'Feed — listRideOrdersAsFeedPosts() / rideOrderToFeedPost() project orders into the feed',
      'DriverMap — listNearbyOrders() surfaces CREATED orders to drivers',
      'Responses — getOrderById() / resolveCanonicalOrder() resolve the order for the offers board (/responses)',
    ],
  },
  {
    key: 'tripId',
    label: 'a shared trip id (trip_<orderId>)',
    triggers: ['tripid', 'trip id', 'trip-id', 'trip_', 'active_ride', 'activeride', 'findactiveride', 'buildpassengeractiveride'],
    surfaces: [
      'Chat — the chat thread store is keyed by tripId',
      'Ride history — the ride-history store is keyed by tripId',
      'Driver receipts — the receipts store is keyed by tripId',
      'Active-ride store — the canonical active-ride record is keyed by tripId',
    ],
  },
];

// #684 R8 — the single highest-leverage blind spot of the #732 chain was the STACKED / TRANSIENT
// overlay surface: 5 of 11 Codex catches were overlay timing / ownership (#738 / #739 stacked-modal
// Escape/Tab ownership, #734 trap-not-released on a no-close route change). SHARED_SURFACE_MAP
// models shared-STORE reach; an aria-modal overlay has a DIFFERENT blast radius — the KEYBOARD /
// FOCUS surface it shares with whatever overlay sits above or below it, plus the route teardown
// that must release its trap. Curated like the store map: read it as "verify these".
export const OVERLAY_SURFACE = {
  triggers: ['aria-modal', 'trapfocus', 'focus-trap', 'focus trap', 'overlay', 'bottom-sheet',
    'bottomsheet', 'alertdialog', 'role="dialog"', 'role=dialog', 'modal', 'sheet'],
  questions: [
    'STACKING — can another overlay open ON TOP of / UNDER this one? The topmost trap must own Escape/Tab (consume the handled key, e.g. stopImmediatePropagation) so the one beneath does not also act (#738 / #739).',
    'TEARDOWN — what releases this overlay\'s focus-trap / key listener when the route changes WITHOUT a close tap? A no-close navigation that leaves the trap installed leaks it onto the next screen (#734).',
    'RESTORE — on close, does focus return to the element that opened the overlay (not <body>)?',
  ],
};

// Lowercase haystack from the MEL's text + file path + selector anchor (pure — uses the
// path/selector STRINGS, never reads the file). The selector is included because it is a
// first-class MEL field and the overlay clue is often only there (e.g. #pf2-garage-add-sheet).
function haystack(mel = {}) {
  return [mel.file, mel.selector, mel.problem, mel.requiredRepair, mel.operationalDecision]
    .filter((s) => typeof s === 'string')
    .join(' ')
    .toLowerCase();
}

// The shared-surface entries a MEL appears to touch (possibly empty).
export function computeBlastRadius(mel = {}) {
  const hay = haystack(mel);
  if (!hay.trim()) return [];
  return SHARED_SURFACE_MAP.filter((entry) => entry.triggers.some((t) => hay.includes(t)));
}

// #684 R8 — does this MEL touch an overlay (aria-modal / sheet / trap)? Same generous-token
// philosophy as the store map: over-surfacing the stacking reminder is cheap.
export function touchesOverlay(mel = {}) {
  const hay = haystack(mel);
  if (!hay.trim()) return false;
  return OVERLAY_SURFACE.triggers.some((t) => hay.includes(t));
}

// Blast-radius as text lines for the MEL card / repair prompt. With no match, a
// single generic reminder — the value of the check is to make the developer THINK
// about shared writes, so the artifact always carries the prompt.
export function blastRadiusLines(mel = {}) {
  const matched = computeBlastRadius(mel);
  const lines = [];
  if (!matched.length) {
    lines.push('- (no shared store/id detected in this MEL — if the repair writes one, list its consumer surfaces and verify them)');
  } else {
    for (const entry of matched) {
      lines.push(`- writes ${entry.label} → verify these consumer surfaces first:`);
      for (const s of entry.surfaces) lines.push(`    • ${s}`);
    }
  }
  // #684 R8 — an overlay's blast radius is the shared keyboard/focus surface, not a store. Surface
  // it whenever the MEL touches an overlay, independent of any shared-store match above.
  if (touchesOverlay(mel)) {
    lines.push('- opens an overlay → its blast radius is the shared KEYBOARD / FOCUS surface (not a store); verify:');
    for (const q of OVERLAY_SURFACE.questions) lines.push(`    • ${q}`);
  }
  return lines;
}
