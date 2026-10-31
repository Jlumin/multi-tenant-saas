# Phase 5 Restaurant validation

Validation environment: dedicated Compose project `sme-cloud-phase5-validate` with a synthetic PostgreSQL volume; the existing `sme-cloud` development volume was not used for test data. Validation date: 2026-10-30.

| Check | Result |
|---|---|
| Compose config | passed |
| Clean PostgreSQL migrations, including Restaurant guards | passed |
| `python manage.py check` | passed; no issues |
| `python manage.py makemigrations --check --dry-run` | passed; no changes |
| Full Django tests | passed, 70/70 |
| Frontend Docker build (`npm ci`) | passed |
| `npm run typecheck` | passed |
| `npm run build` | passed; initial bundle 371.25 kB |
| Compose HTTP smoke | passed: isolated frontend `14201` and backend readiness `18081`, and local `localhost:4200` / `localhost:8000` all HTTP 200; served bundle includes POS and QR guest UI |

Restaurant tests cover anonymous scoped QR menu and order creation, closed-shift rejection, idempotent replay/conflict, CSRF enforcement, QR token rotation/SVG, tenant/store isolation, menu and price snapshots, POS role access, cash receipt/refund limits, append-only database guards and shift handover variance/unpaid-order blocking. The existing local PostgreSQL volume was retained; before migration it contained one tenant, one user, one membership and no stores/products/balances. Only Restaurant migrations were added to that database; no demo restaurant data was created.

Manual browser verification, shared production cache throttling, payment gateway, printing, discounts/taxes/tips, table splitting and final data retention policy are out of scope for this first pass. Phase 5 validation is complete; stop here and wait for separate Phase 6 approval.
