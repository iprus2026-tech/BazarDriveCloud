---
id: BD-DOCS-040
docType: process
title: Mini Yonder Backend Spine docs build integration
owner: docs-contract-agent
status: current
revision: 2026-06-19
effectiveFrom: 2026-06-19
reviewAfter: 2026-12-19
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - "docs-site/docs/processes/backend-spine-inspector.md"
    - "docs-site/static/img/mini-yonder-backend-spine.svg"
    - "docs-site/sidebars.js"
    - "docs-site/package.json"
    - "docs/screen-contracts.md"
  issues: []
  prs: []
tags: [process, mini-yonder, backend, database, docs-site]
slug: /processes/mini-yonder-backend-spine
---

# Mini Yonder Backend Spine docs build integration

This page integrates the **Mini Yonder Backend Spine & DB Inspector** feature into the governed docs build. It is a docs-only contract: it describes the feature, its screens, the build touchpoints, and the future implementation slices without changing the runtime PWA.

![Mini Yonder Backend Spine and DB Inspector](/img/mini-yonder-backend-spine.svg)

## Purpose

Mini Yonder Backend Spine answers one question:

```text
Where is a feature broken across the data chain?

screen → frontend state → API contract → service rule → database table → migration → check → issue
```

It should make backend and database gaps visible before a UI screen grows into a beautiful but unsafe mock.

## Feature screens

| Screen | Purpose | First data source |
|---|---|---|
| Backend Spine | Module map for Auth, Profiles, Orders, Responses, Rides, Chat, Media, Notifications and Reports. | Static catalog |
| Data Trace | One selected screen traced through state, API, database, smoke and issue. | Screen contract + catalog |
| API Contracts | Endpoint cards with auth, role guard, transaction and DB writes. | API catalog |
| DB Schema | Tables, relations, migrations and missing constraints. | DB catalog |
| Contract Diff | Frontend/API/DB mismatch detector. | Contract catalogs |
| Issue Generator | Generates a scoped backend prompt/issue from detected gaps. | Diff findings |

## Build integration

This slice adds the feature to the docs build, not to runtime:

```text
docs-site/docs/processes/backend-spine-inspector.md
docs-site/static/img/mini-yonder-backend-spine.svg
docs-site/sidebars.js
```

The page must remain governed by the Mini Yonder frontmatter passport and must stay visible from `sidebars.js`. The docs-site build gate is:

```bash
cd docs-site
npm run check
```

That command runs frontmatter validation, the legacy document registry validation, Mini Yonder self-inventory validation, navigation validation and the Docusaurus build.

## Runtime boundaries

This docs integration must not touch:

- `public/` runtime PWA files;
- `public/sw.js` or service worker cache lists;
- CSP in `public/index.html`;
- Mapbox loaders, adapters or token policy;
- backend server code;
- database migrations.

The first implementation remains a **docs/catalog foundation**, not a live backend console.

## Future catalog shape

The future runtime/catalog slice should introduce machine-readable files such as:

```text
public/src/yonder/backend_catalog.js
public/src/yonder/api_catalog.js
public/src/yonder/db_catalog.js
public/src/yonder/contract_diff.js
```

The docs-site equivalent can later mirror those catalogs under `docs-site/governance/` if Mini Yonder needs to validate them as governed docs data.

## Backend contract fields for screen contracts

When the feature moves beyond docs, each critical screen contract should gain a backend section:

```text
Backend contract:
- API endpoints
- DB tables
- DTO input
- DTO output
- auth guard
- role guard
- status authority
- transaction required
- migration needed
- smoke needed
```

Example:

```text
Screen: BD-ORDER-DETAIL-01
Route: /order/:id
Backend:
  GET /orders/:id
  POST /orders/:id/responses
  POST /orders/:id/accept
DB:
  orders
  responses
  rides
  ride_events
Authority:
  Backend owns order.status.
Acceptance:
  Passenger cannot accept a canceled order.
  Driver cannot accept their own passenger order.
  Competing offers are rejected in one transaction.
```

## Detection rules

Mini Yonder Backend Spine should eventually flag:

1. screen status is missing from backend enum;
2. critical status can be changed from frontend only;
3. endpoint is planned but has no role guard;
4. endpoint writes several tables but has no transaction requirement;
5. route coordinates exist in UI but have no DB fields;
6. passenger and driver snapshots share a mutable object;
7. ride history mirrors between roles;
8. chat is not linked to order or ride;
9. migration exists without smoke coverage;
10. smoke exists but does not pin the authority boundary.

## First implementation issue

Recommended issue title:

```text
BD-YONDER-BACKEND-01 Backend Spine Inspector foundation
```

Scope:

```text
- Add static backend/api/db catalogs.
- Render docs-backed Mini Yonder screens.
- Add contract-diff findings as mock data.
- Add issue generator prompt output.
- Add docs/smoke contract notes.
```

Out of scope:

```text
- real backend server
- real database migrations
- auth implementation
- Mapbox integration
- APK/TWA
- payments
```

## Acceptance checklist

- [ ] Docs page has valid frontmatter and clean slug.
- [ ] Page is present in `docs-site/sidebars.js`.
- [ ] Visual reference is stored under `docs-site/static/img/`.
- [ ] Runtime PWA files are unchanged.
- [ ] `cd docs-site && npm run check` passes.
- [ ] Follow-up implementation issue references this page.
