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
      'listnearbyorders', 'rideordertofeedpost', 'getorderbyid', 'persistrideorders'],
    surfaces: [
      'Feed — listRideOrdersAsFeedPosts() / rideOrderToFeedPost() project orders into the feed',
      'DriverMap — listNearbyOrders() surfaces CREATED orders to drivers',
    ],
  },
  {
    key: 'tripId',
    label: 'a shared trip id (trip_<orderId>)',
    triggers: ['tripid', 'trip_', 'active_ride', 'activeride', 'findactiveride', 'buildpassengeractiveride'],
    surfaces: [
      'Chat — the chat thread store is keyed by tripId',
      'Ride history — the ride-history store is keyed by tripId',
      'Driver receipts — the receipts store is keyed by tripId',
      'Active-ride store — the canonical active-ride record is keyed by tripId',
    ],
  },
];

// Lowercase haystack from the MEL's text + file path (pure — uses the path STRING,
// never reads the file).
function haystack(mel = {}) {
  return [mel.file, mel.problem, mel.requiredRepair, mel.operationalDecision]
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

// Blast-radius as text lines for the MEL card / repair prompt. With no match, a
// single generic reminder — the value of the check is to make the developer THINK
// about shared writes, so the artifact always carries the prompt.
export function blastRadiusLines(mel = {}) {
  const matched = computeBlastRadius(mel);
  if (!matched.length) {
    return ['- (no shared store/id detected in this MEL — if the repair writes one, list its consumer surfaces and verify them)'];
  }
  const lines = [];
  for (const entry of matched) {
    lines.push(`- writes ${entry.label} → verify these consumer surfaces first:`);
    for (const s of entry.surfaces) lines.push(`    • ${s}`);
  }
  return lines;
}
