---
id: BD-DOCS-002
docType: project-overview
title: Project Overview
owner: docs-contract-agent
status: current
revision: 2026-06-15
effectiveFrom: 2026-06-15
reviewAfter: 2026-12-16
visibleFor: [developer, designer, dispatcher, product, qa]
sourceOfTruth: public/src/app.js
related:
  routes: []
  files: ["public/src/app.js", "public/src/router.js"]
  issues: []
  prs: []
tags: [project, overview]
slug: /project/overview
---

# Project Overview

**BazarDriveCloud** is a vanilla PWA and Cloud Design repository.

It is **not** an Android app, a backend repository, or a React/Vite runtime app. The shipped app is a static PWA:

- `public/index.html`
- `public/src/*.js` — ES modules
- `public/styles/cloud.css`
- localStorage + mock API data
- strict CSP, a service worker, GitHub Pages.

## Source of truth

Routes, screens, and flow behaviour are governed by the runtime plus the contracts:

- `public/src/app.js`, `public/src/router.js`
- `docs/screen-contracts.md`, `docs/flow-contracts.md`, `docs/screen-map.md`

This docs site mirrors those as a navigable layer; the **repo files remain authoritative**. When this site and the repo disagree, the repo wins.
