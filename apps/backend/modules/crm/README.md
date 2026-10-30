# CRM Phase 3 foundation

Tenant-scoped customer profiles and append-only consent history. All endpoints require an authenticated tenant member; tenant managers and administrators can read/write, viewers cannot access customer PII. No public registration, email delivery, marketing automation, points ledger, or ecommerce workflow is included in the CRM slice.

Customer fields are limited to code, display name, email, and phone. Deactivation is soft; records and consent history are retained. Consent changes append a new event with purpose, grant/withdrawal state, and policy version. See `docs/architecture/crm-phase3.md` for API and security boundaries.
