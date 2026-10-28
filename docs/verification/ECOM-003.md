# ECOM-003 WMS inventory integration verification

Date: 2026-10-28. Issue #30. Branch: `feat/ecommerce-003-inventory`, based on `docs/ecommerce-wms-discovery-001`. Draft PR and GitHub Actions are pending publication.

## Delivered

- Each E-Commerce product maps to one active WMS SKU in the same tenant; each store selects one active WMS shipping warehouse. Other warehouse balances are not aggregated. WMS inter-warehouse transfers default to disabled and can be enabled by an Owner.
- Public catalog reads on-hand less active reservations from the store's designated warehouse. Out-of-stock items show `缺貨`, cannot be added to cart, and checkout rejects stale/insufficient availability.
- Checkout locks the tenant and commits the immutable order, order lines, WMS reservation, and audit in one PostgreSQL transaction. Reservation lines allocate positive integer quantities to WMS locations. Integration tests race two checkouts for one unit; only one reserves it.
- Owner fulfillment requires an explicit shipment confirmation and posts WMS outbound movement with the reservation transition atomically. Pre-shipment release requires explicit confirmation that stock remains physically in the warehouse and does not add stock. Goods already shipped must return through WMS inbound/return posting before becoming available.
- Public restock registration requires an explicit opt-in. WMS inbound posting triggers the existing SMTP adapter; notification failures restore a retryable subscription state, and a later inbound event retries it. The email links to a confirmation page that posts an unsubscribe request. No email address or token is written to application logs.
- E-Commerce/WMS communication uses the WMS-owned service contract; there are no cross-module foreign keys. Order snapshots remain immutable; reservation lifecycle and actions have tenant audit records.

## Local validation

| Check | Result |
| --- | --- |
| `prisma format`, `prisma validate`, `prisma generate` | PASS |
| `tsc --noEmit` | PASS |
| ESLint (`eslint . --max-warnings 0`) | PASS |
| Unit tests | PASS: 10 tests |
| PostgreSQL integration (`vitest.auth.config.ts`) | PASS: 6 files, 79 tests; covers tenant isolation, warehouse scope, transfer switch, last-unit checkout race, fulfillment/release, restock retry and unsubscribe |
| `scripts/db-smoke.mjs` | PASS: 15 migrations, repeat deploy unchanged, schema drift empty; disposable DB dropped |
| Next.js type generation and production build | PASS |
| Production HTTP smoke | PASS: homepage, GET health and POST 405 |
| Existing dev server HTTP check | PASS: `http://127.0.0.1:3001/` and `/api/health` returned 200; POST health returned 405 |
| Auth HTTP smoke with PostgreSQL and Mailpit | PASS: signup, verification, invitations, tenant/project flows, E-Commerce checkout, WMS receipt and real restock email/unsubscribe |
| Docker Compose | PASS: `docker compose config --quiet`; PostgreSQL 17.11 and Mailpit 1.32.0 containers healthy |
| GitHub Actions | Pending: feature branch has not yet been pushed |

The standalone dev HTTP smoke could not start a second Next dev server because this workspace already has the user's development server running at port 3001 (Next.js refused a second process using the same `.next/dev` output). The existing server's equivalent homepage and health checks passed above; it was left running.

## Known limits

- There is no payment flow, automatic reservation expiry, partial fulfillment, or shipped-return workflow UI. A shipped return must be posted as WMS inbound/return before it is available again. Owner release is only for an unshipped order whose stock is still physically present.
- Restock retry is event-driven by a later WMS inbound/opening post; there is no scheduled worker. SMTP was exercised through local Mailpit, not a production mail provider.
- Subscription email is retained in PostgreSQL to deliver the notice. Retention/deletion policy and production customer-data use remain outside this issue.
- npm is unavailable in this local shell, so `npm ci` was not rerun. Existing `node_modules` and lockfile were used for all direct CLI checks; GitHub Actions will validate the clean install.
- Manual browser acceptance remains available for the user before merge. No merge or deployment was performed.
