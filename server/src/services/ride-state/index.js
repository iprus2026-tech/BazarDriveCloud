// #5 Ride State Machine — RIDE_STATUS authority (domain/ride-status.js + the DB
// terminal-freeze trigger). Skeleton until the rides cutover (ADR BD-DOCS-041 step 5),
// when PATCH /api/v1/rides/:id/status becomes the single terminal-freeze chokepoint.
import { darkService } from '../_skeleton.js';

export default darkService('ride-state', '#5 Ride State Machine — dark in scaffold');
