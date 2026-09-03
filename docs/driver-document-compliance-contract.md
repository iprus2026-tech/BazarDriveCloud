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
- `supersedes_id` — `null` at creation; write-once `null -> priorEffective.id`, set only when this row is atomically approved as the lineage's new effective version and there was a prior effective version to replace (see Submission lineage and renewal handling). Stays `null` for `UPLOADED`, `VERIFYING`, and `REJECTED`, and stays `null` even after reaching `VALID` if the lineage had no prior effective version. Internal only — never returned in the public projection.
- `valid_from`
- `valid_until`
- `verified_at`
- `verification_source`
- `verification_reason`
- `updated_at`

A change to the document itself (a new photo, a corrected date, a renewal) never rewrites `object_key`, `lineage_id`, or the subject tuple on an existing row — it is always a new row in the same lineage (see Submission lineage and renewal handling).

### Submission lineage and renewal handling

A **lineage** is every submission ever made for one exact `document_type` + exact subject tuple — e.g. `DRIVER_LICENSE` + `driver_id`; `TAXI_OSAGO` + `vehicle_id`; `WAYBILL` + `driver_id` + `vehicle_id` + `shift_id`. The server assigns `lineage_id` on the first submission, and every later submission for that same document_type + subject tuple carries it unchanged — that is what keeps the full history (successful, rejected, and pending attempts alike) together. `lineage_id` is never client-chosen and never appears in the public projection.

Every upload — first-ever, a re-upload after rejection/expiry, or a renewal of a still-valid document — creates a **new** submission row in the lineage. No row is ever reused across an upload; see Verification state machine, below, for why `REJECTED -> UPLOADED` and `EXPIRED -> UPLOADED` are not valid in-place transitions.

`lineage_id` and `supersedes_id` answer two different questions, and must not be conflated:

- `lineage_id` answers *"which document history does this attempt belong to?"* — set once at creation, shared by every attempt in the history regardless of outcome.
- `supersedes_id` answers the narrower question *"which effective version did this approved attempt actually replace?"* — it starts `null` on every new row and is write-once: it flips from `null` to the prior effective row's `id` **only** at the moment this row is atomically approved as the lineage's new effective version (see the atomic transition below).
  - a row that is `UPLOADED`, `VERIFYING`, or `REJECTED` always has `supersedes_id: null` — a pending or rejected attempt never "supersedes" anything.
  - if a `VALID` row is its lineage's first-ever approved version (nothing was effective before it), its `supersedes_id` also stays `null` — there is nothing to replace.

The **effective** version of a lineage is its current server-approved submission that is `VALID` or `EXPIRING` and not expired, revoked, or superseded — there is at most one at a time. The **latest submission** is simply the newest row in the lineage by `created_at`, regardless of status. These are usually the same row, but diverge exactly while a renewal is pending or was rejected:

- while a new submission sits in `UPLOADED`, `VERIFYING`, or `REJECTED`, the lineage's existing `VALID`/`EXPIRING` row remains effective and keeps backing readiness — the pending/rejected attempt is surfaced separately (see Compliance projection, below) but never removes existing readiness, and is never itself described as superseding anything;
- a lineage has no effective row (reads as `MISSING` for readiness) only when no row in it is currently `VALID` or `EXPIRING`.

Atomic successful replacement — one server transaction, never observably partial:

```text
lock lineage / current effective record

assert:
  new.lineage_id == prior.lineage_id
  new.document_type == prior.document_type
  new subject tuple == prior subject tuple
  prior.status in { VALID, EXPIRING }
  prior is still the current effective version
  new is still eligible for approval

write atomically:
  new.status: VERIFYING -> VALID
  new.supersedes_id: null -> prior.id
  prior.status: VALID/EXPIRING -> SUPERSEDED
```

If any assertion fails: rollback — no partial status change, no `supersedes_id` write, prior remains effective.

Invariant: one prior record can have at most one successful successor — at most one other row may ever carry that row's `id` as its (non-null) `supersedes_id`. At the future database layer this is ordinarily a foreign key plus a uniqueness constraint on non-null `supersedes_id` values.

If the lineage has no prior effective version at all, a new submission may still reach `VALID` — its `supersedes_id` simply remains `null`, per the write-once rule above.

A valid document can also be invalidated outside the renewal flow entirely (a revoked license, a fraud finding, an expiring document pulled before it lapses): that is `VALID/EXPIRING -> REVOKED` on the effective row itself, with no new submission involved and no `supersedes_id` write on any row. `SUPERSEDED` means "replaced by a newer valid submission"; `REVOKED` means "invalidated with no replacement in hand."

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
- `VALID`
- `EXPIRING`
- `REJECTED`
- `EXPIRED`
- `SUPERSEDED`
- `REVOKED`

`MISSING` is not a row state — it is what the projection synthesizes when a lineage has no row at all, or no row currently `VALID`/`EXPIRING` (see Compliance projection). Every other state is a real value of a submission row's `status` field.

Allowed transitions (`MISSING -> UPLOADED` creates a lineage's first row; every other line is an in-place update to one existing submission row):

```text
MISSING -> UPLOADED
UPLOADED -> VERIFYING
VERIFYING -> VALID
VERIFYING -> REJECTED
VALID -> EXPIRING
VALID -> EXPIRED
VALID -> SUPERSEDED
VALID -> REVOKED
EXPIRING -> EXPIRED
EXPIRING -> SUPERSEDED
EXPIRING -> REVOKED
```

`REJECTED`, `EXPIRED`, `SUPERSEDED`, and `REVOKED` are terminal **for that submission row** — none of them ever transitions back to `UPLOADED` or anywhere else. There is deliberately no `REJECTED -> UPLOADED` or `EXPIRED -> UPLOADED`: a re-upload after rejection or expiry never reuses the old row, it always creates a brand-new submission row in the same lineage (see Submission lineage and renewal handling).

The client cannot set `VALID`, `REJECTED`, `EXPIRING`, `EXPIRED`, `SUPERSEDED`, or `REVOKED`.

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

`documents[]` always contains **exactly five entries**, one per Initial document type, in this fixed order: `DRIVER_LICENSE`, `TAXI_OSAGO`, `TAXI_REGISTRY`, `WAYBILL`, `MEDICAL_CHECK`. A type with no row at all in its lineage is synthesized as an entry with `effective.status: "MISSING"` — it is never omitted from the array.

Each entry separates the **effective** document (what currently backs readiness) from the **latest submission** (the newest row in the lineage, which may be a pending or rejected renewal that has not displaced the effective document):

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
      "latestSubmission": { "status": "VERIFYING", "reasonCode": null },
      "ready": true,
      "reasonCode": null
    },
    {
      "documentType": "TAXI_REGISTRY",
      "subject": { "vehicleId": "..." },
      "effective": { "status": "MISSING", "validFrom": null, "validUntil": null },
      "latestSubmission": { "status": "MISSING", "reasonCode": null },
      "ready": false,
      "reasonCode": "TAXI_REGISTRY_MISSING"
    },
    {
      "documentType": "WAYBILL",
      "subject": { "driverId": "...", "vehicleId": "...", "shiftId": "..." },
      "effective": { "status": "MISSING", "validFrom": null, "validUntil": null },
      "latestSubmission": { "status": "MISSING", "reasonCode": null },
      "ready": false,
      "reasonCode": "WAYBILL_MISSING"
    },
    {
      "documentType": "MEDICAL_CHECK",
      "subject": { "driverId": "...", "shiftId": "..." },
      "effective": { "status": "MISSING", "validFrom": null, "validUntil": null },
      "latestSubmission": { "status": "MISSING", "reasonCode": null },
      "ready": false,
      "reasonCode": "MEDICAL_CHECK_MISSING"
    }
  ],
  "documentsReady": false,
  "shiftReady": false,
  "complianceReady": false,
  "blockingReasons": [
    "TAXI_REGISTRY_MISSING",
    "WAYBILL_MISSING",
    "MEDICAL_CHECK_MISSING"
  ],
  "warnings": [
    "TAXI_OSAGO_RENEWAL_VERIFYING"
  ],
  "evaluatedAt": "2026-09-03T00:00:00Z"
}
```

Per entry:

- `effective` — the lineage's current server-approved submission that is `VALID` or `EXPIRING` and not expired, revoked, or superseded, or `MISSING` if none exists. `ready` is computed **only** from `effective.status`, never from `latestSubmission.status`.
- `latestSubmission` — the newest row in the lineage by `created_at`, regardless of status (`UPLOADED`, `VERIFYING`, `VALID`, `REJECTED`, `EXPIRING`, `EXPIRED`, `SUPERSEDED`, or `REVOKED`), with its own safe `reasonCode` (e.g. a rejection reason). While a renewal is pending or was rejected, `latestSubmission` differs from `effective` — that difference is exactly what surfaces the pending/rejected attempt to the driver without touching the readiness the still-valid `effective` document provides. A `latestSubmission` in `UPLOADED`/`VERIFYING`/`REJECTED` is never itself described as superseding the effective document.
- `ready` — `true` only when `effective.status` is `VALID` or `EXPIRING`; `false` otherwise.
- `reasonCode` (top-level, per entry) — the safe blocking reason for this slot when `ready` is `false`; `null` when `ready` is `true`.

`documents[]` entries never include `lineageId`, `objectKey`, `verificationSource`, `verifiedAt`, `supersedesId`, or any other internal storage field — those stay server-internal.

Readiness rolls up from `ready`, never from raw `latestSubmission` status:

```text
documentsReady  = ready(DRIVER_LICENSE) && ready(TAXI_OSAGO) && ready(TAXI_REGISTRY)
shiftReady      = ready(WAYBILL) && ready(MEDICAL_CHECK)
complianceReady = documentsReady && shiftReady
```

A pending or rejected renewal (`latestSubmission` in `UPLOADED`/`VERIFYING`/`REJECTED` while `effective` is still `VALID`/`EXPIRING`) never appears in `blockingReasons` and never flips `ready` to `false` — it may appear in `warnings` (e.g. `TAXI_OSAGO_RENEWAL_VERIFYING`) as a non-blocking, informational signal only.

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

The existing Documents pane renders each slot's `effective` status for blocking/warning purposes, using the canonical states:

- `VALID` — accepted and non-blocking
- `EXPIRING` — warning, with expiry date
- `VERIFYING` — pending verification; never rendered as ready
- `REJECTED` — blocking with reason
- `EXPIRED` — blocking
- `MISSING` — blocking
- `SUPERSEDED` — not rendered directly; the pane always shows the current lineage version, so a superseded row is invisible to the driver once its replacement resolves
- `REVOKED` — blocking with reason, rendered the same as `REJECTED`

When `latestSubmission` differs from `effective` (a renewal in flight), the pane keeps the `effective` state above as the blocking/non-blocking signal and separately surfaces the pending `latestSubmission` (e.g. "проверяется продление" / "продление отклонено") as a non-blocking indicator — it never overrides the `effective` state.

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
