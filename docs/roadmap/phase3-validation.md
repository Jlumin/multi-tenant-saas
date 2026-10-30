# Phase 3 CRM／E-Commerce validation report

Date: 2026-10-29 (Asia/Taipei). Scope: tenant-authenticated CRM profiles and append-only consent; tenant-authenticated E-Commerce listings tied to one WMS warehouse, order creation with inventory reservation, cancellation/release and internal sandbox capture with WMS issue movements.

## Results

| Check | Result |
|---|---|
| `python manage.py check` | Passed; 0 issues |
| `python manage.py makemigrations --check --dry-run` | Passed; no changes detected |
| PostgreSQL 17 migrations | Passed on isolated database: platform, WMS 0001–0003, CRM 0001–0002, E-Commerce 0001–0002 |
| `python manage.py test` | Passed; 56/56 across Phase 1, WMS, CRM, E-Commerce |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; Angular initial bundle 317.64 kB, initial total 319.94 kB |
| Docker image build | Backend and frontend images built successfully |

End-to-end tests verify WMS inbound stock → E-Commerce listing → order reservation → sandbox capture → WMS issue movement; retry does not duplicate movement; cancellation restores available stock; separate warehouse listing consumes only its own stock; WMS issue cannot deplete reserved units; oversell and cross-tenant access are rejected; customer consent withdrawal appends a new event; database guards prevent hard deletion and inconsistent order/payment state.

Validation ran against the isolated Compose project `sme-cloud-phase3-validate` and synthetic PostgreSQL data. No production payment provider, external email, anonymous browser checkout, real customer data, or production deployment was used. The local `sme-cloud` dev database migration is additive; manual browser acceptance remains outstanding.

The existing `sme-cloud` development database had one local user, one tenant, and no WMS products or inventory documents before Phase 3 migrations. CRM/E-Commerce tables and reservation guards were applied additively; existing tenant/user data and PostgreSQL volume were preserved. The backend/frontend services were rebuilt and remain local-only. The dev tenant is `dev-test-company`; it has no CRM customers, sales listings, or orders until manually created.

## Deferred product decisions

- Whether public storefront and checkout should be enabled, and what customer identity/login model it should use.
- Payment provider, real callbacks/signature verification, refunds, and order expiry/reservation duration.
- Email/restock notification delivery, shipment provider, invoice integration and address collection.
- CRM consent wording/policy version governance and customer PII retention/export/deletion policy.
- Which membership roles may manage CRM or E-Commerce; current implementation limits writes to Owner.
