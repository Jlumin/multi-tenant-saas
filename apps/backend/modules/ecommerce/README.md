# E-Commerce Phase 3 foundation

This slice provides tenant-authenticated product listings, order creation with WMS stock reservation, cancellation/release, and an internal sandbox payment capture that consumes reserved stock through the public WMS application contract. It does not expose public storefront or checkout APIs; current repository security instructions limit public APIs to health and authentication bootstrap/login. No external payment provider, email, shipping, invoices, refunds, or real customer checkout is implemented.

Listings are bound to a single warehouse. A checkout does not transfer stock between warehouses. All customer and WMS IDs are validated through their owning module's application contract; E-Commerce persists order snapshots and never writes another module's tables.
