---
id: BD-DOCS-049
docType: process
title: "PWA Loading States — Cloud Design Contract"
owner: docs-contract-agent
status: draft
revision: 2026-08-09
effectiveFrom: 2026-08-09
reviewAfter: 2026-11-09
visibleFor: [developer, designer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes:
    - /feed
    - /profile
    - /receipt
    - /order/<id>
    - /responses
    - /driver-map
    - /chat
    - /active-ride
  files:
    - docs/screen-contracts.md
    - public/src/screens/feed.js
    - public/src/screens/profile.js
    - public/src/screens/trip_receipt.js
    - public/src/screens/order_detail.js
    - public/src/screens/respond.js
    - public/src/screens/order_map_draft.js
    - docs-site/docs/processes/backend-spine-inspector.md
  issues: ["#864"]
  prs: []
tags: [design, pwa, loading, accessibility, backend-cutover]
slug: /design/pwa-loading-state-contract
---

# PWA Loading States — Cloud Design Contract

> **Contract proposal / documentation only.** This record defines the shared
> loading-state rule at the Passenger App / Driver App UI ↔ Backend API boundary.
> It changes no runtime JavaScript or CSS, activates no API, and does not change
> backend, store, database, Mapbox, service-worker, or ride-state behaviour.

## Why this contract exists

Most BazarDriveCloud screens still settle synchronously from `localStorage` or a
mock adapter, while the server already exposes guarded order-read, matching-read,
ride-state, history, realtime-poll, and chat seams. A server route marked `LIVE`
does **not** mean its PWA consumer is activated or pilot-ready; the governed
status remains in
[BD-DOCS-042 — Backend Spine Inspector](../processes/backend-spine-inspector.md).

When a screen crosses that asynchronous boundary, it must not invent a fifth
loading convention or briefly render an empty/error state before the request has
settled. This contract provides one four-state model, one pattern-selection rule,
one accessibility boundary, and one reproducible preview convention.

Audit baseline: `main` at `b89219c93c6508abd4c45a66f957a595bc2929de`
(2026-08-09).

## Current implementation inventory

These are existing implementations, not yet a shared component or API.

| Surface | Current implementation | Current accessibility / preview | Contract classification |
|---|---|---|---|
| `feed.js` (`renderLoading`) | Four structural feed-card skeletons before the first `loadResource` result | `.feed-list` toggles `aria-busy` true → false; bones are `aria-hidden` | Structural skeleton precedent |
| `profile.js` (`renderDriverSkeleton`) | Driver-profile chrome plus structural bones | `/profile?role=driver&state=loading`; content region has `aria-busy="true"`; one `role="status"` message | Structural skeleton precedent |
| `trip_receipt.js` (`receiptSkeletonHtml`) | Document-shaped receipt placeholder while the receipt resolves | `/receipt?state=loading`; document owns `role="status"`, `aria-live="polite"`, and `aria-busy="true"` | Document skeleton precedent |
| `order_detail.js` (`bodyS1`) | Centered `od-loading__spinner` driven by `order.__loading` | One `role="status"` / `aria-live="polite"` message; no owning-region `aria-busy` yet | Existing spinner exception to review when migrated |
| `respond.js` (`setLoading`) | Submit-button progress while publishing a response | Button is disabled and toggles `loading` plus `aria-busy` | Action-button loader; not a screen state |
| `order_map_draft.js` (publish action) | Submit-button spinner and “Публикуем…” label | Button is disabled and gains `aria-busy="true"` | Action-button loader; not a screen state |

**Baseline correction.** The initial Issue #864 inventory described two Feed
placeholder cards. Current `main` uses `Array.from({ length: 4 })`; four is the
verified fact recorded here.

Other occurrences of “loading” inside welcome transitions or ride sheets are
flow/action substates. They do not establish a screen-level initial-read
contract. Screens such as `responses.js`, `driver_map.js`, `chat.js`,
`active_ride_passenger.js`, and `active_ride.js` still lack this explicit
four-state screen/region boundary even where guarded API seams already exist.

## Canonical state model

Every new or API-migrated data region declares exactly these four primary
states:

| State | Request condition | Required render |
|---|---|---|
| `loading` | Initial read is pending and no usable content is available | Skeleton or documented spinner exception; no empty/error copy |
| `loaded` | Read settled successfully with usable content | Real content and enabled interactions permitted by the domain contract |
| `empty` | Read settled successfully and returned no entity/items | Honest empty copy and the next valid action |
| `error` | Read failed, timed out, was rejected, or returned unusable data | Error copy, safe fallback, and retry where retry is valid |

Rules:

- `empty` is a **successful settled result**, never the initial value of an
  unresolved request.
- `error` must not be silently converted to `empty`, even when a local fallback
  returns `null` or `[]`.
- `loaded` is not inferred merely because the shell mounted; usable domain
  content must be available.
- Domain states such as ride status, selected driver, canceled, or completed are
  nested inside `loaded`; they do not replace this request-state model.
- Button progress is local to the command. It must not change the owning screen
  from `loaded` back to initial `loading`.

### Background refresh is a modifier, not a fifth primary state

When usable content is already visible, a refresh keeps the region in
`loaded + refreshing`:

- preserve the current content and stable controls;
- do not replace it with an initial-load skeleton or full-screen spinner;
- use a small, non-destructive refresh indicator only when feedback is useful;
- keep polling quiet unless new information materially changes the screen;
- on refresh failure, preserve usable content and expose a non-destructive error
  / retry affordance;
- show `empty` after refresh only when a successful response authoritatively
  says the collection is now empty.

## Pattern-selection decision

| Situation | Canonical pattern | Required rationale |
|---|---|---|
| Initial read; cards, list rows, profile blocks, map panels, or ride-detail geometry is known | Structural skeleton | Default; approximate the stable final footprint |
| Receipt or other document-shaped content | Document skeleton | Preserve the document footprint and hierarchy |
| Initial read; stable structure is genuinely unknown or showing a partial shell would be unsafe/misleading | Screen or region spinner | Screen contract must state why a skeleton is not truthful |
| User command such as send, publish, confirm, select, or withdraw | Button-local loader | Keep the owning screen in its settled state |
| Background refresh with usable content | Preserve content plus optional refresh indicator | Never regress to initial-load UI |

A spinner is an exception, not the default. It is valid only when the owning
screen contract records why there is no truthful stable geometry to skeletonize
or why exposing the partial shell would mislead the user. Otherwise use a
structural skeleton. `order_detail.js` remains unchanged by this docs slice; its
current spinner is evidence to evaluate in its future runtime slice, not an
automatic precedent for new screens.

### Map-backed screens

Map-backed screens separate two regions:

1. the map shell / Mapbox fallback boundary; and
2. data panels such as nearby orders, route summary, driver card, or ride status.

Known panels use structural skeletons while the existing map shell remains
stable. This contract does not activate Mapbox or redefine its fallback,
geolocation, route, tile, or cache behaviour.

## DOM and accessibility contract

### Owning busy region

- Put `aria-busy="true"` on the **smallest persistent screen region whose
  contents will be replaced** by the settled result. Stable topbars, tabbars,
  and navigation outside that region remain available.
- The same owner becomes `aria-busy="false"` when `loaded`, `empty`, or `error`
  is rendered. Do not leave a settled region permanently busy.
- Do not mark both the whole screen and several nested children busy for the
  same request.
- During background refresh, keep already usable content available. If a user
  initiated the refresh, put progress on its control or a separate refresh
  status rather than turning the whole content region back into initial busy UI.

### Status announcement

- Provide one concise status message for initial loading using `role="status"`
  (implicit polite live region) or an equivalent `aria-live="polite"` region.
- Do not nest that message inside an `aria-hidden` skeleton tree.
- Do not announce every shimmer frame, polling interval, or unchanged refresh.
- Empty and error states carry their own accessible heading/label; an actionable
  retry is a real button with an unambiguous name.

### Skeleton and focus safety

- Skeleton shapes are decorative and excluded from the accessibility tree.
- Skeleton markup contains no fake links, buttons, inputs, prices, names, or
  other content that could be mistaken for real data.
- Focus remains on stable chrome or on the command the user invoked. Replacing
  loading markup must not auto-focus the result or drop focus into the document
  body without a documented reason.
- A button-local loader keeps the button's purpose readable, sets
  `aria-busy="true"`, and prevents duplicate submission while the command is
  pending.
- Shimmer/motion must have a non-animated presentation under
  `prefers-reduced-motion: reduce`.

## Reproducible preview fixture

The canonical target query is:

```text
?fixture=loading
?fixture=loaded
?fixture=empty
?fixture=error
```

`fixture` is chosen instead of globally overloading `state`: the current runtime
already uses `state` for unrelated domain/render variants (including Responses,
Profile, Trip Receipt, Order Detail, and Active Ride flows). The new name can
coexist with parameters such as `orderId`, `tripId`, `role`, `pane`, and existing
domain `state` values.

Fixture rules:

- Fixtures are deterministic, synthetic design/smoke inputs. They do not read or
  write production data, create network mutations, or persist a new user state.
- `fixture=loading` holds the initial pending render until the reviewer leaves
  the fixture; it must not auto-settle before a screenshot/accessibility check.
- `fixture=loaded` renders representative usable synthetic content.
- `fixture=empty` represents a successful response with zero results.
- `fixture=error` represents a settled recoverable read failure and exposes the
  intended retry/fallback.
- Unknown fixture values fall back to normal runtime behaviour.
- Existing `?state=loading` previews remain valid legacy gates until their own
  narrow runtime migrations add the shared fixture helper. This PR changes no
  existing URL or screen.

Example target URLs (not implemented by this docs-only slice):

```text
#/responses?orderId=order_demo&fixture=loading
#/driver-map?fixture=empty
#/chat?tripId=trip_demo&fixture=error
#/active-ride?role=passenger&tripId=trip_demo&fixture=loaded
```

## First API-candidate migration matrix

Backend states below are descriptive links to BD-DOCS-042, not activation
approval. Each runtime change requires its own issue/PR and must preserve the
guarded API/local fallback contract until the relevant activation gate is met.

| Priority | Screen / current source | Relevant guarded backend seam | Initial pattern | Focused future runtime slice |
|---|---|---|---|---|
| 1 | `responses.js` — mock/local response stores plus guarded adapters | Matching-offers read is `LIVE`; select is `LIVE / PILOT-BLOCKED` | Request summary remains stable; offer-card/list skeleton in the board region | `BD-CLOUD-DESIGN-LOADING-02A` — four read states + fixtures only; do not broaden into select activation |
| 2 | `driver_map.js` — `listNearbyOrders()` mock store through `loadResource` | Orders read is `LIVE`; PWA API base remains guarded/off | Stable map shell plus nearby-order panel/card skeleton | `BD-CLOUD-DESIGN-LOADING-02B` — map-panel read states; no Mapbox change |
| 3 | `chat.js` — `bazardrive.chat.v1` with guarded API seam | Chat persistence is `LIVE / PILOT-BLOCKED` until participant authorization lands | Stable header/composer boundary plus message-list skeleton; composer unavailable until initial read settles | `BD-CLOUD-DESIGN-LOADING-02C` — fixtures first; activation remains blocked by BD-CHAT-AUTH-01 |
| 4 | `active_ride_passenger.js` — local ride/handoff/history with guarded ride API/poll | Ride read/write and realtime poll are `LIVE`, authenticated participant only | Stable map shell plus ride-status, driver, and route-panel skeletons | `BD-CLOUD-DESIGN-LOADING-02D` — passenger initial-read/refresh states; no state-machine change |
| 5 | `active_ride.js` — local driver ride/receipt flow with guarded ride API/poll | Ride read/write and realtime poll are `LIVE`; receipt/history contracts are separate | Stable map shell plus driver ride panels; earnings action loaders stay separate | `BD-CLOUD-DESIGN-LOADING-02E` — driver initial-read/refresh states; no receipt or ride-transition change |
| Review | `order_detail.js` — existing `order.__loading` spinner | Order/matching reads are guarded by their current contracts | Re-evaluate whether known order-detail geometry requires a skeleton; retain spinner only with recorded rationale | A separate normalization slice after the first candidate; not part of 02A |

The identifiers above name proposed slices only; they do not imply that GitHub
issues already exist or that any backend activation gate is cleared.

## Runtime-slice acceptance template

Every future implementation slice must record:

- the exact screen/region that owns each request;
- transitions for `loading → loaded | empty | error`;
- whether background refresh preserves loaded content;
- skeleton vs spinner choice and, for a spinner, the exception rationale;
- the four deterministic `fixture` URLs;
- `aria-busy` true/false ownership, one status announcement, focus behaviour,
  and reduced-motion behaviour;
- proof that empty does not paint before successful settlement;
- a focused smoke/check that does not require a live backend;
- backend activation status copied from the current BD-DOCS-042 matrix rather
  than inferred from the presence of a server route.

Sequence for each screen remains small-slice:

1. verify the current read adapter and backend gate;
2. add four-state UI/runtime plus deterministic fixtures;
3. add focused smoke/check coverage;
4. cut over the store/backend only in a separately authorized slice;
5. synchronize the per-screen contract after runtime behaviour ships.

## Scope guard for BD-DOCS-049

This document does **not**:

- change runtime JS or CSS;
- create a shared component/helper;
- add or switch any API call;
- activate backend routes or claim pilot readiness;
- change auth, schemas, DB, cache, state machine, matching, ride history, or
  notification behaviour;
- change Mapbox, CSP, service worker, or precache;
- add skeletons to the remaining screens;
- merge action-button progress with screen-level loading.

The contract is complete when a future network-backed screen can select a
pattern, expose all four states reproducibly, and pass an accessibility review
without inventing a screen-specific convention.
