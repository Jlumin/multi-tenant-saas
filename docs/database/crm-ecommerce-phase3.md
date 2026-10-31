# Phase 3 CRM／E-Commerce schema

PostgreSQL 17 shared database/shared schema。每張模組業務表均包含 `tenant_id`；租戶 ID 由已驗證 membership 推導。

| Table | Ownership / key rules |
|---|---|
| `crm_customer` | CRM owns customer code/name/email/phone and soft-active state; UUID; unique `(tenant_id, code)`; tenant and code immutable; hard delete rejected |
| `crm_consentevent` | CRM owns append-only purpose/grant/policy version/actor/time history; customer and recording membership must share tenant |
| `ecommerce_listing` | E-Commerce owns title, TWD-default price/currency, active state and WMS product/warehouse UUID references; no cross-module FK; unique `(tenant_id, product_id, warehouse_id)` |
| `ecommerce_order` | E-Commerce owns status, idempotency digest, member identity snapshot, currency/total, actor; unique `(tenant_id, order_code)` and `(tenant_id, idempotency_key)` |
| `ecommerce_orderline` | E-Commerce owns immutable title, product code, warehouse, quantity, unit-price and line-total snapshots |
| `ecommerce_payment` | Sandbox-only provider; one payment per order; amount/currency match order; pending may transition to captured once |
| `wms_stockreservation` | WMS owns active/consumed/released state, reference UUID, idempotency and payload digest; a tenant lock serializes reservation commands |
| `wms_stockreservationline` | WMS owns immutable per-location allocations; tenant/product/warehouse/location references validated; effective active allocations reduce sellable stock |

E-Commerce order `customer_id`, listing `product_id`/`warehouse_id` and order-line product/warehouse IDs are stable cross-module references without foreign keys. Creation validates them through CRM/WMS public application services and saves only the snapshot/reference in E-Commerce. No E-Commerce SQL path writes CRM or WMS tables directly.

Migrations add PostgreSQL triggers for CRM consent immutability and tenant relation validation, E-Commerce listing/order/payment snapshots and terminal states, deferred order/payment consistency, and WMS reservation state/tenant/allocation guards. A WMS outbound document is created per warehouse on successful sandbox capture so the existing single-warehouse inventory document invariant remains intact.
