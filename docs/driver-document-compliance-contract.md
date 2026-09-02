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

Backend Safety & Compliance becomes the authority for driver document verification and line eligibility.

The client may upload evidence and display server projections. It may not promote a document to verified/valid and may not assert line readiness.

## Data contract

### `driver_documents`

Server-owned record keyed by driver and document type.

Minimum fields:

- `id`
- `driver_id`
- `document_type`
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

### Initial document types

- `DRIVER_LICENSE`
- `TAXI_OSAGO`
- `TAXI_REGISTRY`
- `WAYBILL`
- `MEDICAL_CHECK`

`WAYBILL` and `MEDICAL_CHECK` are shift-scoped evidence and must not be treated as evergreen permanent documents.

## Verification state machine

Canonical states:

- `MISSING`
- `UPLOADED`
- `VERIFYING`
- `VALID`
- `EXPIRING`
- `REJECTED`
- `EXPIRED`

Allowed transitions:

```text
MISSING -> UPLOADED
UPLOADED -> VERIFYING
VERIFYING -> VALID
VERIFYING -> REJECTED
VALID -> EXPIRING
VALID -> EXPIRED
EXPIRING -> EXPIRED
REJECTED -> UPLOADED
EXPIRED -> UPLOADED
```

The client cannot set `VALID`, `REJECTED`, `EXPIRING`, or `EXPIRED`.

## Compliance projection

The backend exposes a derived readiness projection rather than asking the PWA to reconstruct authority from individual records.

Example shape:

```json
{
  "driverId": "...",
  "documentsReady": false,
  "shiftReady": false,
  "lineReady": false,
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

### Invariant

```text
driver ONLINE => server compliance verdict lineReady == true
```

`lineReady` is the future server-authoritative successor to client self-asserted `documentsReady + waybillOpen + medicalCheckPassed`.

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

Warnings and hard blockers are separate UI concepts.

The screen may show regulatory guidance or links, but legal text is informational content and is not itself the readiness source of truth.

## Audit events

At minimum:

- `DRIVER_DOCUMENT_UPLOADED`
- `DRIVER_DOCUMENT_VERIFICATION_STARTED`
- `DRIVER_DOCUMENT_VERIFIED`
- `DRIVER_DOCUMENT_REJECTED`
- `DRIVER_DOCUMENT_EXPIRED`
- `DRIVER_COMPLIANCE_VERDICT_CHANGED`

Each event records actor/source, driver/document identity, timestamp, and previous/new state where applicable.

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
