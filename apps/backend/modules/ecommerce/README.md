# E-Commerce Phase 3 foundation

Phase 3 provides tenant-authenticated product listings, order creation with WMS stock reservation, cancellation/release, and an internal sandbox payment capture that consumes reserved stock through the public WMS application contract. Phase 8 adds an administrator-opt-in, anonymous read-only storefront for active listings, public prices, branded images and boolean stock status. Its browser cart is not an order and cannot check out.

Listings are bound to a single warehouse. A checkout does not transfer stock between warehouses. All customer and WMS IDs are validated through their owning module's application contract; E-Commerce persists order snapshots and never writes another module's tables.

The storefront uses `/shop/{tenant_slug}/` and `/api/v1/storefronts/{tenant_slug}/`. It returns only active sellable listings for an active tenant whose `TenantBranding.storefront_enabled` switch is on. Phase 10 adds an optional listing category (80 characters) for customer-side filtering. Public output deliberately omits exact stock quantities and customer data; public checkout, customer accounts, delivery, email notifications and real payment remain out of scope. See `docs/architecture/ecommerce-storefront-phase8.md` and `docs/security/ecommerce-storefront-phase8.md`.
