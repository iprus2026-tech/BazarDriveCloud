---
id: BD-DOCS-055
docType: decision-record
title: Virtual City Simulation Architecture
owner: docs-contract-agent
status: draft
revision: 2026-11-28
effectiveFrom: 2026-11-28
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - scripts/dev-stand.mjs
    - server/test/e2e-two-session-cycle.test.mjs
    - docs-site/docs/processes/backend-spine-inspector.md
    - docs-site/docs/processes/project-tracking.md
  issues: [1235, 1236, 1237, 1233, 831, 784, 820, 826, 947, 1191]
  prs: []
tags: [decision-record, adr, virtual-city, mini-yonder, test-isolation, evidence]
slug: /decisions/virtual-city-simulation
---

# Virtual City Simulation Architecture

This draft defines test architecture for BazarDriveCloud on
`main@3d2f8a7d565003ec0afb6fba505a304ca20a71e1`. The five-section VC-00 audit
is the accepted baseline. Each later slice requires its own approved scope.
[Parent #1235](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1235) ·
[VC-00 #1236](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1236) ·
[Owner acceptance](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1236#issuecomment-7236971798) ·
[VC-01 #1237](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1237)

## 1. Architecture boundary

Use the existing Passenger and Driver PWA, Fastify services, canonical
migrations and PostgreSQL 16. Each backend-ON run has one disposable backend
and one database. Server responses and persisted facts govern orders, offers,
assignment, Ride, chat and history. The runner supplies test inputs and
observes results through existing contracts. Ride transitions retain the
product state machine. An ON screen, derived trip ID or localStorage record
alone cannot establish a successful server mutation.

Run backend-OFF prototypes in separate contexts with an empty API base and
mock/local state. Confirm zero API traffic and label results `CLIENT_ONLY`.
Treat operator and synthetic actor displays as projections of their scoped
sources. [Shared Source of Truth](shared-source-of-truth.md) ·
[Backend Spine Inspector](../processes/backend-spine-inspector.md)

| Capability label | Meaning at a recorded source SHA |
| --- | --- |
| `LIVE` | The registered path implements the relevant server behavior. |
| `DARK` | The interface returns a stub or the internal foundation lacks an active interface. |
| `CLIENT_ONLY` | Behavior is local to the PWA or its prototype. |
| `PILOT-BLOCKED` | An applicable pilot or client acceptance gate is outstanding. |
| `NOT_VERIFIED` | The evidence available for the specific claim is insufficient. |

At the baseline, participant Ride, chat, history and the select transaction
are implemented. Availability, route-price and Safety HTTP services are dark.
Ride outbox writes exist while notification delivery and server Inbox remain
dark. Marketplace publication is local. The merchant identity DB
foundation and map renderer do not establish merchant delivery or driver
telemetry. Verify details against routes, migrations and tests when the
Inspector drifts. [BD-DOCS-042](../processes/backend-spine-inspector.md) ·
[#949](https://github.com/iprus2026-tech/BazarDriveCloud/issues/949) ·
[Notification outbox ADR](notification-outbox-contract.md)

## 2. Fail-closed admission and teardown

The future run operator owns admission and teardown. The harness enforces
the boundary at process, network and database levels. An agent instruction
or environment name cannot stand in for enforcement.

1. **Before backend launch or DB writes**, confirm an owner-approved test
   scope and exact source SHA. Allocate a private run namespace and dedicated
   ports. Apply default-deny egress for the browser, backend, fixtures and
   DB, with an exact local endpoint allowlist. Bind to loopback inside the
   namespace and keep tunnels disabled. Use an allowlisted process
   environment, test-only credentials and an isolated filesystem with any
   implicit `.env` unavailable. Deny production endpoints, secrets, data and
   external providers. Provision fresh PostgreSQL 16 and its run database
   inside that enforced boundary. Use synthetic data and disabled adapters
   or scoped local fakes for money, SMS/OTP delivery, Telegram, WhatsApp, push
   and SOS. Dev OTP is confined to the isolated run.
2. **Before migrations or fixtures**, attest provisioned DB instance,
   database, principal, run ownership and expected initial schema with a
   read-only check. The migration principal is restricted to that
   disposable destination. Apply the canonical migrations and verify the
   schema required by the pinned source. Launch the backend with the same
   confirmed target and a distinct runtime principal. Read-only evidence
   access uses a separate principal.
3. **Before actor actions**, bind and verify the expected PWA/API origins,
   backend DB identity and `/api/v1/health` and `/api/v1/readyz` responses
   of `200`. Validate the identity, grant and active role of each
   authenticated product actor through the server. Attest the identity and
   scoped access of harness-only actors separately. Require observable
   enforcement of the destination and egress checks. The standard dev
   stand inherits environment, loads `server/.env` if present and opens
   PWA listeners despite failed readiness. Its `--no-server` path is usable
   only with an independently attested backend from the same run. The
   operator owns these checks around the existing tool.
4. **Abort and clean up** on unknown or mismatched destination, failed
   readiness, missing isolation evidence, unexpected egress or credential
   crossover. Stop actor actions and listeners and close browser contexts.
   Revoke sessions and remove resources only through destinations whose
   run ownership has been rechecked. The operator isolates any remaining
   resources and records skipped or failed cleanup. Independent QA verifies
   teardown. A replay uses a new run, new browser contexts and a fresh DB.

Negative admission controls must show that a mismatched DB or an unexpected
destination prevents any migration or actor action, and red readiness
prevents actor admission. Evaluate these controls with local test fixtures.
[Dev stand on baseline](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/scripts/dev-stand.mjs#L236-L308) ·
[Health and readiness](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/src/routes/health.js#L1-L31)

## 3. Actors, grants and observation

| Actor | Scoped capability |
| --- | --- |
| Passenger | Manages the actor's own order and selection. Reads and acts on the actor's side of the assigned Ride and history. |
| Driver | Uses a current server grant to offer on an eligible order. Acts on the assigned Ride and can request its completed-ride receipt. |
| Competitor | Holds a separate driver account and a separate offer. Access to the winning driver's Ride is a negative control. |
| Merchant | Uses separate synthetic tenant membership and operation-specific authorization. Until a business API is accepted, checks stay within the existing merchant DB foundation. |
| City dispatcher | Coordinates the scenario and observes the approved projection. Dispatch mutations, overrides and sanctions require separate product contracts. |
| Synthetic GPS or event source | Provides named synthetic inputs at an accepted boundary. Inputs carry provenance. They confer no role or authority to set Ride status or money. |
| Accounting and compliance observer | Reads authorized, redacted run projections. Grants, document approval, ledger writes and sanctions are outside this role. |
| Independent QA | Reviews admission, expected and negative paths, evidence and cleanup with separate read access. |

Each product user has a separate server account and session. Use one fresh
context per browser actor, with separate cookies, localStorage,
sessionStorage and service-worker cache. A new tab on the same origin can
resume the same confirmed identity. Treat role query parameters as view inputs. Keep fixture grants, privileged
cleanup and DB credentials with the separate setup operator. Product actors
cannot self-approve or acquire repository write tokens. The repository
`dispatcher-agent` coordinates development and review outside the city
scenario. [Session continuity](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/public/src/auth_token.js#L150-L195) ·
[Fixture and cleanup](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/e2e-two-session-cycle.test.mjs#L64-L97)

## 4. Scenarios and evidence

Use the #831 baseline order, offer, select, assigned Ride, active chat,
completion, history and receipt. Its existing Fastify `app.inject` test
exercises separate bearer sessions and PostgreSQL. It checks a terminal chat
thread. The active-chat DB test covers sending separately. The two-browser
composition and its acceptance remain in #831. Extend the scenario set only
under the applicable gates for cancellation, no-show, competition, interrupted
sessions, re-entry and select reconciliation.
[API composition](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/e2e-two-session-cycle.test.mjs#L1-L50) ·
[Terminal chat](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/e2e-two-session-cycle.test.mjs#L199-L211) ·
[Active chat](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/chat-flow.test.mjs#L82-L162)

| Evidence record | Required fields |
| --- | --- |
| Run manifest | Unique `runId`, full `sourceSHA`, `scenarioId`, `scenarioVersion`, seed, ON/OFF mode, start/end timestamps, applicable contracts and gates, actor pseudonyms and roles, environment ID, DB alias and PG/schema identity for ON, admission and cleanup references, verdict and reason. |
| Step | Action ID and actor, expected invariant, observed result, API response/code and correlation ID, relevant event/DB observations and UI evidence references, negative control result, verdict and reason. Inapplicable observations carry an explicit reason. |
| Retention and cleanup | Approved access and retention policy, redaction check, operator cleanup confirmation, independent QA result, and disposal status for any retained evidence. |

Illustrative step only. A separate active passenger session with a verified
phone requests an existing foreign order's offers through
`GET /api/v1/matching/offers?orderId=…`.
[Owner-only offers in #831](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/e2e-two-session-cycle.test.mjs#L124-L128)

```json
{
  "actionId": "owner-only-offers",
  "actor": {"alias": "outsider-1", "role": "passenger"},
  "expected": {"httpStatus": 403, "dbMutation": false},
  "observed": null,
  "evidenceRefs": [],
  "verdict": "NOT_RUN",
  "reason": "Illustration without an executed run"
}
```

Require negative controls for anonymous and cross-role access, stale or
revoked sessions, foreign Ride, rejected transitions, terminal freeze and
write-once receipt. For merchant scenarios, also deny foreign or revoked
membership. Where applicable, assert one winner under concurrent select
and no duplicate effect on retry. Use real PG connections and clocks for
transactions, TTL and commit order. Record an observed barrier for overlap.
A seed controls synthetic inputs and planned ordering. Virtual time is
limited to surfaces with an accepted time contract.
[Concurrent select](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/select-flow.test.mjs#L116-L154) ·
[Observed PG row-lock barrier](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/test/select-flow.test.mjs#L393-L445)

Record server mutations from correlated API and permitted DB/event evidence.
UI evidence establishes what was displayed. For uncertain select, preserve
uncertainty until the applicable server read contract resolves it. A
locally rebuilt Ride, optimistic screen, stale API response or legacy
receipt fallback cannot prove a server success. Redact bearer, OTP,
credentials, phone numbers, private coordinates, documents and chat content
before retaining or exporting evidence. Keep raw captures transient.
Before a run, confirm the owner-approved readers, storage and retention
limit. The operator deletes expired artifacts and QA verifies deletion.
[Current Passenger handoff](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/public/src/screens/responses.js#L1605-L1652) ·
[Receipt fallback](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/public/src/mock_api.js#L1633-L1675)

| Verdict | Condition |
| --- | --- |
| `PASS` | All mandatory controls and assertions ran, match the contract, and have correlated evidence and confirmed cleanup. |
| `FAIL` | A required invariant was violated and the violation has evidence. |
| `BLOCKED` | Authorization, isolation, a prerequisite, mandatory evidence or an authoritative outcome cannot be established. |
| `NOT_RUN` | A check or scenario was not executed. Record the reason. A mandatory step in this state prevents run PASS. |

## 5. Reuse and dependency gates

A hard gate applies to a specific deliverable. A conditional gate applies
only when the scenario claims the capability. Document planned edges with
their evidence and check for cycles before any separately authorized
native dependency change.

| Gate | Ownership and placement |
| --- | --- |
| VC-01 → VC-02 | Owner accepts VC-01, the applicable #831 foundation and the test-only scope. #831 owns the browser vertical. VC-02 adds disposable orchestration and run evidence. |
| Retries and identity | #826 owns mutation retry and concurrency contracts. #829 and #830 own applicable session and role/readiness guarantees. |
| Passenger outcome | Accepted #947/01B is required for new ACK consumption, uncertain outcome reconciliation, stable-negative proof and revisit of `/responses`. Existing API checks can use their current contracts. |
| Cutover and pilot | #784 owns cutover. #820/#828 own pilot and activation gates. Local tests and contract review have their own approvals. |
| VC-03 module scenarios | Use VC-02 plus accepted #586/#830 for presence and work context, #587 for ranking/broadcast, #588/#594 and BD-DOCS-053 for route/map, #975/#977/#979 for merchant, #589/#948/#1190 for notification delivery and Inbox. Map work can proceed in parallel with presence. Reuse manual matching and polling for their existing guarantees. Telemetry requires its own accepted contract. |
| VC-04–VC-08 | VC-04 and VC-05 have independently approved contracts. VC-06 uses applicable VC-04/05 decisions, VC-07 uses those and VC-06 when reporting disputes. VC-08 requires every capability it exercises. |

Historical #101 provides separate OFF coverage. #1191 owns role QA
deduplication. #949 / PR #1165 own Inspector reconciliation. The open PR
#1232 is a proposed telemetry contract.
[#101](https://github.com/iprus2026-tech/BazarDriveCloud/issues/101) ·
[#831](https://github.com/iprus2026-tech/BazarDriveCloud/issues/831) ·
[#784](https://github.com/iprus2026-tech/BazarDriveCloud/issues/784) ·
[#820](https://github.com/iprus2026-tech/BazarDriveCloud/issues/820) ·
[#826](https://github.com/iprus2026-tech/BazarDriveCloud/issues/826) ·
[#947](https://github.com/iprus2026-tech/BazarDriveCloud/issues/947) ·
[#1191](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1191) ·
[Map provider ADR](map-provider-maplibre-pmtiles-osrm.md) ·
[PR #1232](https://github.com/iprus2026-tech/BazarDriveCloud/pull/1232)

## 6. Financial, legal and operating boundaries

The current write-once receipt derives a ride calculation from the accepted
offer or order estimate. The cash/noncash marker comes from the request.
Payment confirmation, settlement, fiscal evidence, balances and payouts
require separate authority. VC-00 records a static amount-range discrepancy:
orders/offers can accept up to 9,999,999,999.99 while `receipts.fare` is
a signed `INTEGER` (max 2,147,483,647). Behavior at the boundary is
`NOT_RUN`. Reproduce in an approved future slice and triage via
#1041/#1191. [Receipt calculation](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/src/services/history/index.js#L48-L128) ·
[Offer limit](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/src/services/matching/index.js#L88-L105) ·
[Receipt schema](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/server/migrations/0001_phase1_init.sql#L777-L800) ·
[#1041](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1041)

- **VC-04** requires an approved synthetic settlement model covering
  payer/payee, currency and integer minor units, versioned pricing and
  commission, balanced atomic entries, idempotency, refunds, linked
  reversals, adjustments and reconciliation. Real payment integration
  remains with [#634](https://github.com/iprus2026-tech/BazarDriveCloud/issues/634).
- **VC-05** requires a jurisdiction, applicability, versioned effective
  rules, assent/withdrawal, document scope, retention and human review.
  Existing driver document data provides a subject scope. Public legal
  documents and consent remain with [#1154](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1154).
- **VC-06** specifies responsibility for each party, case permissions,
  evidence, human adjudication, appeal, insurance and escalation. Use
  approved rule versions and synthetic adjustments under [#590](https://github.com/iprus2026-tech/BazarDriveCloud/issues/590).
- **VC-07** specifies driver/merchant statements, period boundaries and time
  zone, gross/fees/cost/net, late adjustments, scoped export and
  reconciliation. Coordinate operating metrics and audit with
  [#1153](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1153) and
  [#827](https://github.com/iprus2026-tech/BazarDriveCloud/issues/827).

Financial outputs and cases remain synthetic. Legal or tax compliance
requires separate validation and approval.

## 7. Development feedback and Project #1

Use the existing BazarDrive — Mini-Yonder Growth Path board and #1233
governance. Reproduce a finding, capture redacted evidence, deduplicate
against #1191 and the canonical task, then route to the coordinator for
scope and explicit owner approval. Approved implementation uses its own
worktree followed by independent QA and the existing PR gate. Project
tracking records evidence and dependencies. Execution authority comes
from the scope approval.
[Project #1](https://github.com/users/iprus2026-tech/projects/1) ·
[Project Tracking](../processes/project-tracking.md) ·
[#1233](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1233)

Keep task Status and direct-subissue progress, Design State, runtime state
at a pinned SHA, and activation separate. Task progress carries a numerator,
denominator and observation date. Gate progress uses verified required
gates and stays `NOT_MEASURED` before the set is accepted. #586 is the
negative control for inferring readiness from closed issues while
availability remains `501`. A merged contract can qualify for
`Designed (ADR)` under normal governance. `Shipped` requires the actual
phase behavior and applicable checks.

Project membership and field values are `NOT_VERIFIED`. Use separately
authorized private/manual coordination. The merged #1167 exporter job is
disabled. The owner-approved future public projection covers #585–#591
and its approved fields. VC records stay outside that allowlist. Publication,
exporter activation and Project writes require separate authorization.
[PR #1167](https://github.com/iprus2026-tech/BazarDriveCloud/pull/1167) ·
[Disabled exporter](https://github.com/iprus2026-tech/BazarDriveCloud/blob/3d2f8a7d565003ec0afb6fba505a304ca20a71e1/.github/workflows/project-board.yml#L1-L19) ·
[Disclosure decision](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1233#issuecomment-7192769217)

## Open owner decisions

- Accept the exact #831 evidence and scenario subset that VC-02 may consume.
- Approve how the test namespace, DB identity, schema attestation and
  cleanup are enforced and observed. Assign the run operator and independent QA.
- Approve retained evidence fields, readers, storage location, retention
  limit and deletion responsibility before execution.
- Confirm Seagram's interface boundary and the permitted synthetic
  telemetry input when VC-03 is scoped.
- Approve the financial, jurisdictional, liability and reporting models
  in their respective later slices.
