# SME Cloud contributor instructions

- Phase 1 foundations through Phase 4 HR and the Phase 5 Restaurant first version are approved and implemented. Phase 5 was approved by the user on 2026-10-30; details are in `docs/architecture/restaurant-phase5.md`.
- Monorepo: `apps/backend` (Django/DRF), `apps/frontend` (Angular/TypeScript). Existing root `app`, `tests`, `main.py` are legacy Mini WMS; do not migrate or modify them implicitly.
- Modular monolith: modules `wms`, `ecommerce`, `crm`, `hr`, `restaurant`. Restaurant owns both QR ordering and staff POS.
- Each module owns its future tables and writes. Cross-module use goes through public services/contracts; no direct writes to another module's tables. Shared code contains technical primitives only.
- PostgreSQL is the integration/production database. Never silently substitute SQLite.
- No credentials, customer data or `.env` files in Git. Fail closed on missing configuration. Public APIs are limited to health and session bootstrap/login; enforce CSRF on login and all session mutations.
- Tests: backend `python manage.py check`, `python manage.py makemigrations --check --dry-run`, `python manage.py test`; frontend `npm ci`, `npm run typecheck`, `npm run build`; Compose config and integration smoke test per README.
- Update docs when changing boundaries, security or commands. Report skipped checks and environmental limitations honestly.
- Current approved boundary: CRM member/consent, authenticated E-Commerce listing/order sandbox integrated with WMS, HR employee attendance/corrections, and Restaurant QR ordering/POS. The Restaurant public API exception is limited to scoped QR menu lookup, order submission and QR image retrieval, protected by unguessable revocable table tokens, CSRF on writes and anonymous rate limits. No other business APIs are public.
- Phase 6 operational hardening was approved on 2026-10-30. Do not deploy externally or modify production data without separate explicit instruction. Keep dev Compose and production overlay distinct; production requires a trusted TLS edge proxy, real secret values supplied outside Git, encrypted offsite backups, and an operator-reviewed migration window. Stop after Phase 6 validation and summarize remaining launch decisions.
