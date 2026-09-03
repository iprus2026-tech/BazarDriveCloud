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

Server-owned, versioned submission record — not a single mutable (driver, document_type) row. Each row is one immutable submission version; the current version of a lineage is the row with no later submission superseding it (see Renewal handling, below).

Minimum fields:

- `id`
- `document_type`
- `driver_id` — present when the type's subject scope includes `DRIVER`
- `vehicle_id` — present when the type's subject scope includes `VEHICLE`
- `shift_id` — present when the type's subject scope includes `SHIFT`
- `supersedes_id` — the prior submission version this one replaces, or `null` for the first submission in a lineage
- `status`
- `valid_from`
- `valid_until`
- `issued_at`
- `verified_at`
- `verification_source`
- `verification_reason`
- `object_key` or external reference where applicable
- `created_at`
- `updated_at`

### Renewal handling

When a new submission is uploaded for an already-`VALID` lineage (a renewal), the existing `VALID` row is retained and keeps backing the compliance verdict while the new submission runs `UPLOADED -> VERIFYING`:

- new submission reaches `VALID` → the prior version transitions `VALID -> SUPERSEDED`, and the new row's `supersedes_id` points at it;
- new submission reaches `REJECTED` → the prior version stays `VALID` (no supersession) and keeps backing the verdict.

A valid document can also be invalidated outside the renewal flow (a revoked license, a fraud finding): that is `VALID -> REVOKED`, distinct from `SUPERSEDED`. `SUPERSEDED` means "replaced by a newer valid submission"; `REVOKED` means "invalidated with no replacement in hand."

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

Allowed transitions:

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
REJECTED -> UPLOADED
EXPIRED -> UPLOADED
```

`SUPERSEDED` and `REVOKED` are terminal for that submission version; a subsequent document is a new submission in the lineage (see Renewal handling), not a reuse of the same row.

The client cannot set `VALID`, `REJECTED`, `EXPIRING`, `EXPIRED`, `SUPERSEDED`, or `REVOKED`.

## Compliance evaluation context

The compliance verdict is never computed from a driver id alone. It is always evaluated for an explicit context:

```text
context = { driverId, activeVehicleId, shiftId }
```

- `driverId` — always required.
- `activeVehicleId` — the vehicle the driver is currently assigned/declared against; required to evaluate any `VEHICLE`-scoped document (`TAXI_OSAGO`, `TAXI_REGISTRY`) and the `VEHICLE` component of `WAYBILL`.
- `shiftId` — a server-authoritative open shift id; required to evaluate any `SHIFT`-scoped document (`WAYBILL`, `MEDICAL_CHECK`).

Fail-closed rule: if the context is missing `activeVehicleId` or `shiftId` and the document set being evaluated includes a type scoped to that missing subject, the verdict for that type — and therefore the overall verdict — resolves to non-compliant, never to a default pass. In particular, evaluating with no server-authoritative shift can never yield `complianceReady: true`; it is treated the same as a `MISSING` shift-scoped document, not skipped.

## Compliance projection

The backend exposes a derived readiness projection rather than asking the PWA to reconstruct authority from individual records. The projection is a public API shape: it carries subject identity and status, not internal storage fields.

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
      "status": "VALID",
      "validFrom": "2026-01-10",
      "validUntil": "2031-01-10",
      "reasonCode": null
    },
    {
      "documentType": "TAXI_OSAGO",
      "subject": { "vehicleId": "..." },
      "status": "VERIFYING",
      "validFrom": null,
      "validUntil": null,
      "reasonCode": "TAXI_OSAGO_VERIFYING"
    },
    {
      "documentType": "MEDICAL_CHECK",
      "subject": { "driverId": "...", "shiftId": "..." },
      "status": "MISSING",
      "validFrom": null,
      "validUntil": null,
      "reasonCode": "MEDICAL_CHECK_MISSING"
    }
  ],
  "documentsReady": false,
  "shiftReady": false,
  "complianceReady": false,
  "blockingReasons": [
    "TAXI_OSAGO_VERIFYING",
    "MEDICAL_CHECK_MISSING"
  ],
  "warnings": [
    "DRIVER_LICENSE_EXPIRING_SOON"
  ],
  "evaluatedAt": "2026-09-03T00:00:00Z"
}
```

`documents[]` entries never include `objectKey`, `verificationSource`, `verifiedAt`, `supersedesId`, or any other internal storage field — those stay server-internal. Each entry exposes only `documentType`, `subject` (the subject ids relevant to that type, per the scope table above), `status`, `validFrom`/`validUntil`, and a safe `reasonCode` (or `null` when not blocking/warning).

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

The existing Documents pane renders server state using the canonical states:

- `VALID` — accepted and non-blocking
- `EXPIRING` — warning, with expiry date
- `VERIFYING` — pending verification; never rendered as ready
- `REJECTED` — blocking with reason
- `EXPIRED` — blocking
- `MISSING` — blocking
- `SUPERSEDED` — not rendered directly; the pane always shows the current lineage version, so a superseded row is invisible to the driver once its replacement resolves
- `REVOKED` — blocking with reason, rendered the same as `REJECTED`

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
