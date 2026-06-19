// BD-OPS-03 — ScreenOps static screen registry (dev/docs tool).
//
// Plain data only. This module performs NO network calls, NO fetch, NO dynamic
// import and NO filesystem / HTTP probing of any kind. `implementationStatus`
// is declared in the data below; whether a source file truly exists on disk is
// pinned only by the Node smoke / check scripts — never by the browser at
// runtime. The UI renders the declared status string directly.
//
// Seed set = the MVP screens listed in issue #623.

const SCREENS = [
  {
    id: 'BD-FEED-01',
    title: 'Feed',
    route: '/feed',
    file: 'public/src/screens/feed.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-COMPOSER-01',
    title: 'Composer',
    route: '/new',
    file: 'public/src/screens/composer.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-PROFILE-01',
    title: 'Profile',
    route: '/profile',
    file: 'public/src/screens/profile.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-RESPOND-01',
    title: 'Respond',
    route: '/respond',
    file: 'public/src/screens/respond.js',
    role: 'driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-CHAT-01',
    title: 'Chat',
    route: '/chat',
    file: 'public/src/screens/chat.js',
    role: 'passenger / driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-RULES-01',
    title: 'Rules',
    route: '/rules',
    file: 'public/src/screens/rules.js',
    role: 'shared',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-RIDE-D-02',
    title: 'Active Ride — Driver',
    route: '/active-ride?role=driver',
    file: 'public/src/screens/active_ride.js',
    role: 'driver',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-RIDE-P-01',
    title: 'Active Ride — Passenger',
    route: '/active-ride?role=passenger',
    file: 'public/src/screens/active_ride_passenger.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
  {
    id: 'BD-MAP-01',
    title: 'Map',
    route: '/map',
    file: 'public/src/screens/map.js',
    role: 'passenger',
    contractStatus: 'exists',
    designStatus: 'current',
    melStatus: 'OK',
    implementationStatus: 'implemented',
  },
];

export const IMPLEMENTATION_STATUSES = ['implemented', 'waiting', 'missing'];

export function getScreens() {
  return SCREENS.map((s) => ({ ...s }));
}

export function getScreen(id) {
  const found = SCREENS.find((s) => s.id === id);
  return found ? { ...found } : null;
}
