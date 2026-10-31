# Phase 8 database change

`platform_core.0004_public_storefront` adds `TenantBranding.storefront_enabled BOOLEAN NOT NULL DEFAULT FALSE`.

Existing tenants remain private after migration. Branding row creation does not change this default. Enabling a storefront is an explicit tenant-admin setting, audited through the existing branding update path. No product, customer, order, inventory, payment, or media schema is added in Phase 8.
