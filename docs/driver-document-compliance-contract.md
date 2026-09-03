# BD-DRIVER-DOCUMENT-COMPLIANCE-01A

Status: contract-first / docs-only

Issue: #953

Architecture: Driver App / Safety & Compliance / Backend API / DB / Object Storage / Monitoring

## Existing UI anchor

This slice reuses the existing driver documents pane:

- route: `/profile?role=driver&pane=documents`
- runtime: `public/src/screens/profile.js`
- current local readiness seam: `public/src/state.js`
- existing gate: `isDriverLineReady()`

No new route is introduced by 01A.

## Problem

Today driver document state is client-owned. `driverLicense`, `taxiOsago`, `taxiRegistry`, `waybill`, and `medicalCheck` are local status records, and `documentsReady`, `waybillOpen`, and `medicalCheckPassed` are client-derived booleans.

That is acceptable only as prototype state. It cannot be the production authority for whether a driver may go online.

## Source of truth

Backend Safety & Compliance becomes the authority for driver document verification and the compliance verdict that feeds line eligibility. It does not own the full go-online decision — `canGoOnline` remains a separate Driver Availability responsibility that consumes this contract's verdict as one input (see Invariant, below).

The client may upload evidence and display server projections. It may not promote a document to verified/valid and may not assert line readiness.

## Data contract

### Subject-scoped ownership

Driver documents are not uniformly driver-owned. Each document type has an explicit subject scope, and a submission's identity is the combination of subjects it applies to — not a bare `driver_id`:

| Document type | Subject scope |
| --- | --- |
| `DRIVER_LICENSE` | `DRIVER` |
| `TAXI_OSAGO` | `VEHICLE` |
| `TAXI_REGISTRY` | `VEHICLE` |
| `WAYBILL` | `DRIVER` + `VEHICLE` + `SHIFT` |
| `MEDICAL_CHECK` | `DRIVER` + `SHIFT` |

A submission carries exactly the subject ids its type's scope requires (e.g. a `WAYBILL` submission carries `driver_id` + `vehicle_id` + `shift_id`; a `TAXI_OSAGO` submission carries `vehicle_id` only). Subjects not required by a document type are absent, not null-filled placeholders.

### `driver_documents`

Server-owned, versioned submission record — not a single mutable (driver, document_type) row. Each row is one submission version; `lineage_id` (below) is what actually threads every submission for the same (subject, document_type) into one history — see Submission lineage and renewal handling.

A row's fields split into two groups. Only the second group is ever written after row creation:

**Immutable at creation, never rewritten:**

- `id`
- `lineage_id` — server-generated on the lineage's first submission; every later submission for the same `document_type` + exact subject tuple carries the same value. Never client-chosen or client-supplied. Internal only — never returned in the public projection.
- `document_type`
- `driver_id` — present when the type's subject scope includes `DRIVER`
- `vehicle_id` — present when the type's subject scope includes `VEHICLE`
- `shift_id` — present when the type's subject scope includes `SHIFT`
- `object_key` or external reference where applicable
- `issued_at`
- `created_at`

**Server-mutable lifecycle fields (updated in place on this same row as verification proceeds):**

- `status`
- `supersedes_id` — `null` at creation; write-once `null -> priorEffective.id`, set only when this row is atomically *activated* as the lineage's new effective version and there was a prior effective version to replace (see Submission lineage and renewal handling). Stays `null` for `UPLOADED`, `VERIFYING`, `APPROVED`, and `REJECTED`, and stays `null` even after activating to `VALID` if the lineage had no prior effective version. Internal only — never returned in the public projection.
- `valid_from`
- `valid_until`
- `verified_at`
- `verification_source`
- `verification_reason`
- `updated_at`

A change to the document itself (a new photo, a corrected date, a renewal) never rewrites `object_key`, `lineage_id`, or the subject tuple on an existing row — it is always a new row in the same lineage (see Submission lineage and renewal handling).

### Submission lineage and renewal handling

A **lineage** is every submission ever made for one exact `document_type` + exact subject tuple — e.g. `DRIVER_LICENSE` + `driver_id`; `TAXI_OSAGO` + `vehicle_id`; `WAYBILL` + `driver_id` + `vehicle_id` + `shift_id`. The server assigns `lineage_id` on the first submission, and every later submission for that same document_type + subject tuple carries it unchanged — that is what keeps the full history (successful, rejected, and pending attempts alike) together. `lineage_id` is never client-chosen and never appears in the public projection.

**Exactly one lineage exists per `document_type` + exact subject tuple.** Creating a lineage's first row is itself atomic and serialized against concurrent first uploads for the same document_type + subject tuple — at the future database layer this is a uniqueness constraint (or an equivalent serializing lock) on `(document_type, driver_id, vehicle_id, shift_id)`, so two simultaneous first-time uploads for the same vehicle's `TAXI_OSAGO` can never mint two different `lineage_id`s. A losing concurrent request attaches to the lineage the winner created; it never starts a second one.

Every upload — first-ever, a re-upload after rejection/expiry, or a renewal of a still-valid document — creates a **new** submission row in the lineage. No row is ever reused across an upload; see Verification state machine, below, for why `REJECTED -> UPLOADED` and `EXPIRED -> UPLOADED` are not valid in-place transitions.

**At most one open submission per lineage** — an initial hard invariant. `open` = `UPLOADED`, `VERIFYING`, or `APPROVED` (a future-dated `APPROVED` renewal waiting to activate counts as open; an already-`effective` `VALID`/`EXPIRING` row does not). A new upload is accepted into a lineage only when that lineage currently has no open submission; a second upload for the same `document_type` + subject tuple while one attempt is still in flight is rejected, not queued. At the future database layer this is a partial uniqueness constraint over `open` rows per `lineage_id`. One consequence: a stale `APPROVED` row can never be activated behind a newer attempt, because no newer open attempt can be created while the stale one is still open.

`lineage_id` and `supersedes_id` answer two different questions, and must not be conflated:

- `lineage_id` answers *"which document history does this attempt belong to?"* — set once at creation, shared by every attempt in the history regardless of outcome.
- `supersedes_id` answers the narrower question *"which effective version did this attempt actually replace?"* — it starts `null` on every new row and is write-once: it flips from `null` to the prior effective row's `id` **only** at the moment this row is atomically **activated** as the lineage's new effective version (see Approval vs. activation, below).
  - a row that is `UPLOADED`, `VERIFYING`, `APPROVED`, or `REJECTED` always has `supersedes_id: null` — a pending, scheduled, or rejected attempt never "supersedes" anything.
  - if a row activating to `VALID` is its lineage's first-ever effective version (nothing was effective before it), its `supersedes_id` also stays `null` — there is nothing to replace.

#### Approval vs. activation

Verification concluding positively (`VERIFYING` resolving) is not the same moment as a document becoming effective — a document can be fully verified today and still be scheduled to start next month. The two are deliberately split:

- if `new.valid_from <= evaluatedAt` at the moment verification concludes (the document is already within its validity window), approval and activation happen together: `VERIFYING -> VALID`, immediately followed by the Atomic activation transaction below.
- if `new.valid_from > evaluatedAt` (a future-dated document — verified ahead of when it starts), verification concludes as `VERIFYING -> APPROVED` and stops there. `APPROVED` is **not** effective and gives no readiness on its own; if a prior `VALID`/`EXPIRING` row exists in the lineage, it is untouched and keeps backing the verdict undisturbed until `new.valid_from` actually arrives.
- at `valid_from`, an `APPROVED` row is activated by the same Atomic activation transaction below, triggered by the clock — a background worker, or read-path reconciliation (see Temporal validity) — rather than by verification concluding.
- if an `APPROVED` row's entire validity window elapses before it is ever activated (`evaluatedAt >= valid_until` at the first activation attempt), it does not activate: `APPROVED -> EXPIRED`, and any prior effective row is left untouched — `supersedes_id` stays `null` and nothing is superseded.
- an `APPROVED` row can also be invalidated before it ever activates (a revoked license, a fraud finding discovered before the start date): `APPROVED -> REVOKED`. Once `EXPIRED` or `REVOKED`, the row is terminal — it can never be the target of an activation transaction.

The **effective** version of a lineage is its current server-approved submission for which `effectiveAt(evaluatedAt)` holds (see Temporal validity, below) — there is at most one at a time. The **latest submission** is the newest row in the lineage, ordered by `(created_at, id)` for a deterministic tie-break, regardless of status — or `null` if the lineage has no rows at all (see Compliance projection for how an empty lineage is represented). These are usually the same row, but diverge exactly while a renewal is pending, scheduled, or was rejected:

- while a new submission sits in `UPLOADED`, `VERIFYING`, `APPROVED`, or `REJECTED`, the lineage's existing effective row (if any) is untouched and keeps backing readiness — the pending/scheduled/rejected attempt is surfaced separately (see Compliance projection, below) but never removes existing readiness, and is never itself described as superseding anything;
- a lineage has no effective row (reads as `MISSING` for readiness) when no row in it currently satisfies `effectiveAt(evaluatedAt)` — including the case of an `APPROVED` row with no prior effective version, which stays blocking until it activates.

Atomic activation transaction — used for an immediate `VERIFYING -> VALID`, and for resolving an `APPROVED` row once the clock reaches it: `APPROVED -> VALID`, or `APPROVED -> EXPIRED` if the whole window has already closed. One server transaction, never observably partial:

```text
lock lineage / current effective record

assert:
  new.status in { VERIFYING, APPROVED }
  new is not REVOKED
  no other open submission exists in the lineage   (guaranteed by the one-open
                                                    invariant; re-checked here)
  new.valid_from <= evaluatedAt                     (lower bound: the window has opened)

  if the lineage has an existing effective version, also assert:
    new.lineage_id     == prior.lineage_id
    new.document_type  == prior.document_type
    new subject tuple  == prior subject tuple
    prior.status in { VALID, EXPIRING }
    prior is still the current effective version

branch on the upper bound (valid_until) of new's validity window:

  new.valid_until is null OR evaluatedAt < new.valid_until   -- window still open:
    write atomically:
      new.status: VERIFYING/APPROVED -> VALID
      new.supersedes_id: null -> prior.id           (only if a prior effective version existed)
      prior.status: VALID/EXPIRING -> SUPERSEDED    (only if a prior effective version existed)

  else   -- evaluatedAt >= new.valid_until: the window closed before the row ever took
         -- effect. Only an APPROVED row reaches this branch; the immediate
         -- VERIFYING -> VALID path requires the document to still be within its window.
    write atomically:
      new.status: APPROVED -> EXPIRED
    no prior effective row is touched; new.supersedes_id stays null; nothing is superseded
```

If any assertion fails: rollback — no partial status change, no `supersedes_id` write, any prior effective row is unaffected, and `new` stays at its pre-transaction status (`VERIFYING` or `APPROVED`).

Invariant: one prior record can have at most one successful successor — at most one other row may ever carry that row's `id` as its (non-null) `supersedes_id`. At the future database layer this is ordinarily a foreign key plus a uniqueness constraint on non-null `supersedes_id` values.

A valid document can also be invalidated outside the renewal flow entirely, after it is already effective (a revoked license, a fraud finding, an expiring document pulled before it lapses): that is `VALID/EXPIRING -> REVOKED` on the effective row itself, with no new submission involved and no `supersedes_id` write on any row. `SUPERSEDED` means "replaced by a newer valid submission"; `REVOKED` means "invalidated with no replacement in hand," whether that happens before or after the row was ever effective.

### Initial document types

- `DRIVER_LICENSE`
- `TAXI_OSAGO`
- `TAXI_REGISTRY`
- `WAYBILL`
- `MEDICAL_CHECK`

`WAYBILL` and `MEDICAL_CHECK` are shift-scoped evidence (their subject scope includes `SHIFT`, per the table above) and must not be treated as evergreen permanent documents.

## Verification state machine

Canonical states:

- `MISSING`
- `UPLOADED`
- `VERIFYING`
- `APPROVED`
- `VALID`
- `EXPIRING`
- `REJECTED`
- `EXPIRED`
- `SUPERSEDED`
- `REVOKED`

`MISSING` is not a row state — it is what the projection synthesizes when a lineage has no effective row (see Compliance projection). Every other state is a real value of a submission row's `status` field.

`APPROVED` means verification concluded positively but the document's `valid_from` is still in the future (see Submission lineage and renewal handling, Approval vs. activation). It is a real row status, but it is **never** an `effective` status and never gives readiness on its own.

Allowed transitions (`MISSING -> UPLOADED` creates a lineage's first row; every other line is an in-place update to one existing submission row):

```text
MISSING -> UPLOADED
UPLOADED -> VERIFYING
VERIFYING -> VALID
VERIFYING -> APPROVED
VERIFYING -> REJECTED
APPROVED -> VALID
APPROVED -> EXPIRED
APPROVED -> REVOKED
VALID -> EXPIRING
VALID -> EXPIRED
VALID -> SUPERSEDED
VALID -> REVOKED
EXPIRING -> EXPIRED
EXPIRING -> SUPERSEDED
EXPIRING -> REVOKED
```

`REJECTED`, `EXPIRED`, `SUPERSEDED`, and `REVOKED` are terminal **for that submission row** — none of them ever transitions back to `UPLOADED` or anywhere else. There is deliberately no `REJECTED -> UPLOADED` or `EXPIRED -> UPLOADED`: a re-upload after rejection or expiry never reuses the old row, it always creates a brand-new submission row in the same lineage (see Submission lineage and renewal handling). `APPROVED` is not terminal — it always eventually resolves to `VALID` (activated once `valid_from` arrives), `EXPIRED` (its whole validity window elapsed before it ever activated), or `REVOKED` (invalidated before it ever activates); once `EXPIRED` or `REVOKED`, it can never reach `VALID`.

The client cannot set `VALID`, `REJECTED`, `EXPIRING`, `EXPIRED`, `SUPERSEDED`, `REVOKED`, or `APPROVED`.

## Temporal validity

A stored `status` of `VALID`/`EXPIRING` is not sufficient on its own for readiness — activation and expiry are moments in time, and correctness cannot depend on a background worker having already run by the time a verdict is read. The projection recomputes temporal validity live, at evaluation time:

```text
effectiveAt(t) =
  status in { VALID, EXPIRING }
  AND (valid_from is null OR valid_from <= t)
  AND (valid_until is null OR t < valid_until)
  AND not revoked
  AND not superseded
```

- `t` is `evaluatedAt`, server time — never client-supplied.
- A row whose stored `status` is still `VALID` but whose `valid_until` has already passed never yields `ready: true`, even if an expiry worker hasn't yet flipped it to `EXPIRED`/`EXPIRING`.
- A row whose `valid_from` is still in the future never yields `ready: true`, regardless of stored `status` — this is exactly why a future-dated approval uses `APPROVED`, not `VALID` (see Submission lineage and renewal handling, Approval vs. activation).
- Expiry and activation workers exist to materialize `status` for storage, audit, and query efficiency — a performance and bookkeeping detail. The projection's correctness never depends on their timeliness: `effectiveAt(t)` is the source of truth for what counts as `effective` at read time, not the stored `status` alone.

### Read-path activation reconciliation

`effectiveAt(t)` requires a stored `status` of `VALID`/`EXPIRING`, so a **due** `APPROVED` row — one whose `valid_from` has already passed — is not yet `effective` on its stored status alone. To keep the projection independent of whether the activation worker has run, building the projection first reconciles the lineage, in one idempotent step per request:

```text
GET compliance projection
  1. read server evaluatedAt (server time; never client-supplied)
  2. under the lineage lock, find any due APPROVED candidate
     (status == APPROVED AND valid_from <= evaluatedAt)
  3. run the same Atomic activation transaction
     (APPROVED -> VALID, or APPROVED -> EXPIRED if evaluatedAt >= valid_until)
  4. only then build the effective / latestSubmission projection for the response
```

The background activation worker runs the **same** idempotent transaction ahead of read time; it is an optimization, never the only mechanism that makes a due `APPROVED` row take effect. When the worker has already activated the row, step 2 finds no due `APPROVED` candidate and step 3 is a no-op. After step 3, every lineage's `effective` is once again exactly `VALID`, `EXPIRING`, or `MISSING` (per `effectiveAt(evaluatedAt)`), and `ready` is computed from that reconciled state.

## Compliance evaluation context

The compliance verdict is never computed from a driver id alone. It is always evaluated for an explicit context, and every part of that context is server-authoritative — none of it is an accepted client parameter:

```text
context = { driverId, activeVehicleId, shiftId }
```

- `driverId` — taken only from the authenticated session. Never a request parameter.
- `activeVehicleId` — taken only from the driver's server-owned active assignment (Availability/garage). If a vehicle id is ever accepted as input for any other purpose, the server must verify it is currently assigned to this exact `driverId` before using it; an unassigned or someone-else's vehicle id is rejected outright, not silently treated as absent.
- `shiftId` — must identify a shift that is (a) currently `OPEN` and (b) linked to this exact `driverId` **and** this exact `activeVehicleId`. A well-formed shift id open for a different driver or a different vehicle is not a valid context.

The client cannot select which vehicle or shift the verdict is evaluated against beyond what the server has already assigned to it. An authenticated driver's own session is never authority to request a compliance verdict for another driver, an unassigned vehicle, or an unrelated shift.

Fail-closed rule: if the context is missing `activeVehicleId` or `shiftId` and the document set being evaluated includes a type scoped to that missing subject, the verdict for that type — and therefore the overall verdict — resolves to non-compliant, never to a default pass. In particular, evaluating with no server-authoritative OPEN shift can never yield `complianceReady: true`; it is treated the same as a `MISSING` shift-scoped document, not skipped.

## Compliance projection

The backend exposes a derived readiness projection rather than asking the PWA to reconstruct authority from individual records. The projection is a public API shape: it carries subject identity and status, not internal storage fields.

`documents[]` always contains **exactly five entries**, one per Initial document type, in this fixed order: `DRIVER_LICENSE`, `TAXI_OSAGO`, `TAXI_REGISTRY`, `WAYBILL`, `MEDICAL_CHECK`. A type with no effective row is always present in the array — `effective.status` is synthesized as `"MISSING"` rather than the entry being omitted.

Each entry separates the **effective** document (what currently backs readiness, per `effectiveAt(evaluatedAt)` — see Temporal validity) from the **latest submission** (the newest real row in the lineage, or `null` if the lineage has no rows at all):

```text
effective.status        ∈ { VALID, EXPIRING, MISSING }
latestSubmission.status ∈ { UPLOADED, VERIFYING, APPROVED, VALID, EXPIRING,
                             REJECTED, EXPIRED, SUPERSEDED, REVOKED }   (or latestSubmission is null)
```

`MISSING` is never a `latestSubmission` status — it isn't a real row status (see Verification state machine) — and it is never a `latestSubmission` value either: an empty lineage is represented as `latestSubmission: null`, not as a synthetic `MISSING` submission.

Example shape:

```json
{
  "driverId": "...",
  "activeVehicleId": "...",
  "shiftId": "...",
  "documents": [
    {
      "documentType": "DRIVER_LICENSE",
      "subject": { "driverId": "..." },
      "effective": { "status": "VALID", "validFrom": "2026-01-10", "validUntil": "2031-01-10" },
      "latestSubmission": { "status": "VALID", "reasonCode": null },
      "ready": true,
      "reasonCode": null
    },
    {
      "documentType": "TAXI_OSAGO",
      "subject": { "vehicleId": "..." },
      "effective": { "status": "VALID", "validFrom": "2026-02-01", "validUntil": "2026-12-31" },
      "latestSubmission": { "status": "APPROVED", "reasonCode": null },
      "ready": true,
      "reasonCode": null
    },
    {
      "documentType": "TAXI_REGISTRY",
      "subject": { "vehicleId": "..." },
      "effective": { "status": "MISSING", "validFrom": null, "validUntil": null },
      "latestSubmission": null,
      "ready": false,
      "reasonCode": "TAXI_REGISTRY_MISSING"
    },
    {
      "documentType": "WAYBILL",
      "subject": { "driverId": "...", "vehicleId": "...", "shiftId": "..." },
      "effective": { "status": "MISSING", "validFrom": null, "validUntil": null },
      "latestSubmission": null,
      "ready": false,
      "reasonCode": "WAYBILL_MISSING"
    },
    {
      "documentType": "MEDICAL_CHECK",
      "subject": { "driverId": "...", "shiftId": "..." },
      "effective": { "status": "MISSING", "validFrom": null, "validUntil": null },
      "latestSubmission": { "status": "APPROVED", "reasonCode": null },
      "ready": false,
      "reasonCode": "MEDICAL_CHECK_APPROVED_NOT_YET_ACTIVE"
    }
  ],
  "documentsReady": false,
  "shiftReady": false,
  "complianceReady": false,
  "blockingReasons": [
    "TAXI_REGISTRY_MISSING",
    "WAYBILL_MISSING",
    "MEDICAL_CHECK_APPROVED_NOT_YET_ACTIVE"
  ],
  "warnings": [
    "TAXI_OSAGO_RENEWAL_APPROVED_SCHEDULED"
  ],
  "evaluatedAt": "2026-12-01T00:00:00Z"
}
```

`TAXI_OSAGO` above is exactly the scenario that motivated the approval/activation split: the effective policy is valid through `2026-12-31`, a renewal has already been verified and is `APPROVED` for `2027-01-01`, and the slot stays `ready: true` off the still-current `effective` document — the scheduled renewal is visible only as a `warnings` entry. `MEDICAL_CHECK` shows the opposite case: an `APPROVED` submission with **no** prior effective version stays blocking (`ready: false`) until it activates at its own `valid_from`.

Per entry:

- `effective` — the lineage's current submission for which `effectiveAt(evaluatedAt)` holds (see Temporal validity), or `MISSING` if none exists. Its `status` is only ever `VALID`, `EXPIRING`, or `MISSING`. `ready` is computed **only** from `effective`, never from `latestSubmission`.
- `latestSubmission` — the newest row in the lineage, ordered by `(created_at, id)`, regardless of status; `null` if the lineage has no rows at all. Carries its own safe `reasonCode` (e.g. a rejection reason). While a renewal is pending, scheduled, or was rejected, `latestSubmission` differs from `effective` — that difference is exactly what surfaces the attempt to the driver without touching the readiness the still-valid `effective` document provides. A `latestSubmission` in `UPLOADED`/`VERIFYING`/`APPROVED`/`REJECTED` is never itself described as superseding the effective document.
- `ready` — `true` only when `effective.status` is `VALID` or `EXPIRING`; `false` otherwise (including when the only submission in the lineage is `APPROVED` but not yet active).
- `reasonCode` (top-level, per entry) — the safe blocking reason for this slot when `ready` is `false`; `null` when `ready` is `true`.

`documents[]` entries never include `lineageId`, `objectKey`, `verificationSource`, `verifiedAt`, `supersedesId`, or any other internal storage field — those stay server-internal.

Readiness rolls up from `ready`, never from raw `latestSubmission` status:

```text
documentsReady  = ready(DRIVER_LICENSE) && ready(TAXI_OSAGO) && ready(TAXI_REGISTRY)
shiftReady      = ready(WAYBILL) && ready(MEDICAL_CHECK)
complianceReady = documentsReady && shiftReady
```

A pending, scheduled, or rejected renewal (`latestSubmission` in `UPLOADED`/`VERIFYING`/`APPROVED`/`REJECTED` while `effective` is still `VALID`/`EXPIRING`) never appears in `blockingReasons` and never flips `ready` to `false` — it may appear in `warnings` (e.g. `TAXI_OSAGO_RENEWAL_APPROVED_SCHEDULED`) as a non-blocking, informational signal only. An `APPROVED` submission with no effective document to back it *does* block (`ready: false`) — it is not yet active, and pending-renewal leniency only ever applies on top of an existing effective document, never in place of one.

### Invariant

```text
driver ONLINE => server complianceReady == true
```

This is a one-way implication only: `complianceReady == true` does not by itself imply the driver may go online. The full go-online decision (`canGoOnline`) belongs to Driver Availability and may combine `complianceReady` with other factors (presence, dispatch/shift state, etc.) that this contract does not define.

`complianceReady` (renamed from the earlier `lineReady`) is the future server-authoritative successor to client self-asserted `documentsReady + waybillOpen + medicalCheckPassed`.

## Read/write ownership

| Data | Stored where | Written by | Read by |
| --- | --- | --- | --- |
| Document metadata/status | PostgreSQL | Safety & Compliance backend/verifier | Driver App, Availability, Ops |
| Document binary/media | Object Storage | authorized upload service | verifier / authorized ops |
| Compliance verdict | derived server projection | Safety & Compliance | Driver App, Availability, Dispatcher |
| Audit event | DB/audit ledger | backend services | Monitoring/Ops |

No document binary or sensitive PII is stored in `localStorage`.

## Driver App rendering contract

`effective` and `latestSubmission` drive two different, non-overlapping parts of the pane:

**`effective` decides readiness only** — it only ever takes one of three values, and each renders as:

- `VALID` — accepted and non-blocking
- `EXPIRING` — warning, with expiry date
- `MISSING` — blocking

**`latestSubmission` decides the attempt-status presentation** — `UPLOADED`, `VERIFYING`, `APPROVED`, `REJECTED`, `EXPIRED`, and `REVOKED` are never `effective` values, and are rendered only through `latestSubmission`:

- `UPLOADED` / `VERIFYING` — pending verification; never rendered as ready on their own
- `APPROVED` — verified, scheduled to activate on its `validFrom`; never rendered as ready on its own
- `REJECTED` — blocking with reason, if it is also the whole readiness story (no effective document behind it)
- `EXPIRED` — blocking, if it is also the whole readiness story
- `REVOKED` — blocking with reason, if it is also the whole readiness story
- `SUPERSEDED` — never rendered; it only ever describes a row that is no longer anyone's `latestSubmission`, so the pane never surfaces it

When `latestSubmission` differs from `effective` and `effective` is `VALID`/`EXPIRING` (a renewal in flight or scheduled), the pane keeps the `effective` state above as the sole blocking/non-blocking signal, and separately surfaces `latestSubmission` as a non-blocking indicator ("проверяется продление" / "одобрено, начнёт действовать с …" / "продление отклонено") — it never overrides `effective`.

When `effective` is `MISSING`, the blocking copy is **not** a single generic "документ отсутствует" — it is determined by `latestSubmission`:

- `latestSubmission: null` (nothing ever submitted) — "Документ не загружен"
- `VERIFYING` / `UPLOADED` — "Документ проверяется"
- `APPROVED` (not yet active) — "Одобрен, начнёт действовать с `validFrom`"
- `REJECTED` — "Документ отклонён"
- `EXPIRED` — "Срок действия истёк"
- `REVOKED` — "Документ отозван"

Readiness itself is unaffected by which copy is shown — it is still derived only from `effective`.

Warnings and hard blockers are separate UI concepts.

The screen may show regulatory guidance or links, but legal text is informational content and is not itself the readiness source of truth.

## Audit events

At minimum:

- `DRIVER_DOCUMENT_UPLOADED`
- `DRIVER_DOCUMENT_VERIFICATION_STARTED`
- `DRIVER_DOCUMENT_VERIFIED`
- `DRIVER_DOCUMENT_REJECTED`
- `DRIVER_DOCUMENT_EXPIRED`
- `DRIVER_DOCUMENT_SUPERSEDED`
- `DRIVER_DOCUMENT_REVOKED`
- `DRIVER_COMPLIANCE_VERDICT_CHANGED`

Each event records actor/source, subject identity (driver/vehicle/shift as applicable), document identity, timestamp, and previous/new state where applicable.

## 01A non-goals

This slice does not add:

- DB migration
- backend route/runtime
- object-storage wiring
- KYC/provider integration
- verification worker
- Presence/Dispatcher enforcement
- PWA upload runtime
- Service Worker changes
- backend activation
- a replacement `/profile` route

## Follow-up slices

1. `01B` — PostgreSQL/API schema, dark runtime
2. `01C` — authorized object upload/storage
3. `01D` — verification lifecycle and server projection
4. `01E` — Driver App consumes server projection
5. `01F` — Availability/ONLINE enforcement
6. `01G` — audit/monitoring and expiry notifications

## Figma boundary

The design reference belongs under `BD-PROFILE-D-03` as the existing Documents pane. Figma owns visual and interaction intent only. Backend contracts own document state and readiness authority.
