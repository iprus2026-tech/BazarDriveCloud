// /server/src/services/index.js — the Mini-Yonder service registry (ADR BD-DOCS-041).
// One folder per service; the diagram is "wired but dark". auth carries a live session
// read + dark OTP writes (Phase 1); #1-#8 are skeleton plugins that register their prefix
// and return 501 until their own phase fills the folder. Promoting a service is "implement
// a folder", never "re-architect" — this list does not change shape, only its imports do.
import authService from './auth/index.js';
import ordersService from './orders/index.js';
import availabilityService from './availability/index.js';
import matchingService from './matching/index.js';
import routePriceService from './route-price/index.js';
import rideStateService from './ride-state/index.js';
import notificationsService from './notifications/index.js';
import safetyService from './safety/index.js';
import historyService from './history/index.js';

export const SERVICES = [
  { name: 'auth', plugin: authService },             // BD-DOCS-032 phone+OTP, session
  { name: 'orders', plugin: ordersService },         // #1 Order Dispatcher
  { name: 'availability', plugin: availabilityService }, // #2 Presence
  { name: 'matching', plugin: matchingService },     // #3 Matching
  { name: 'route-price', plugin: routePriceService },// #4 Route & Price (Mapbox)
  { name: 'ride-state', plugin: rideStateService },  // #5 Ride State Machine
  { name: 'notifications', plugin: notificationsService }, // #6 Notification fan-out
  { name: 'safety', plugin: safetyService },         // #7 Safety & Compliance
  { name: 'history', plugin: historyService },       // #8 History & Receipt
];
