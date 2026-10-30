# Restaurant Phase 5 schema

`restaurant.0001_initial` creates the Restaurant-owned schema; `0002_database_guards` installs PostgreSQL triggers. PostgreSQL is required.

| Table | Purpose / key constraints |
|---|---|
| `restaurant_table` | Tenant, platform `store_id` UUID, table code/name and QR token digest; tenant/store/code unique; raw token is never stored |
| `restaurant_menucategory`, `restaurant_menuitem` | Shared tenant menu; stable unique codes, non-negative Decimal price, soft disable; item/category tenant consistency |
| `restaurant_order` | Tenant/store/table, QR or POS source, order code, state, total, idempotency key and payload digest; immutable identity/amounts |
| `restaurant_orderline` | Immutable menu item/name/code/quantity/price snapshots |
| `restaurant_orderevent` | Append-only status, cash receipt and refund history |
| `restaurant_posshift` | Store open/close cash count, opener/closer and recorded variance; one open shift per store |
| `restaurant_paymentevent` | Append-only cash received/refund amounts, idempotency key, shift and actor; tenant/idempotency unique |

Cross-module platform store IDs remain non-FK references and are validated through the platform application contract. Database triggers validate active store and tenant scope, source/table/order/line/shift/payment relationships, immutable order lines/events/payment events, valid status/payment state transitions, one-time shift close and the corresponding payment/refund totals. Application services use tenant/order/shift row locks around order and cash operations to serialize competing requests. Refunds are limited to remaining cash received; duplicate requests replay by idempotency key.

Menu edits do not mutate historical order line snapshots. Table deactivation blocks token use; QR rotation changes the stored digest. Restaurant does not decrement WMS stock or create CRM member records.
