# Restaurant Phase 5：QR 點餐與店員 POS

Phase 5 is approved as of 2026-10-30. Restaurant owns its categories, menu items, tables, orders, snapshots, POS shifts and payment events. QR guest ordering and authenticated staff POS use the same menu and order service. The Restaurant module references platform stores by UUID and validates them through `platform_core.application`; it does not write WMS, CRM, or platform store tables.

## Agreed first version

- A tenant has a shared menu; each table belongs to one active platform store.
- A table QR token is 256-bit random material. Only its SHA-256 digest is stored. The raw token appears once when a table is created or the token is rotated; rotation immediately invalidates the old link.
- QR guest links open `/?qr=<token>`. They expose only that active table's active menu and order submission. A guest order is not required to have a CRM account.
- POS uses the same menu and restaurant order lines. Menu item name, code and price are snapshotted in each order line.
- Cash is the only payment method. No payment gateway, card data, tip, discount, tax calculation, receipt, invoice, inventory recipe deduction or WMS integration is included.
- There is at most one open POS shift per store. Opening float and closing cash are recorded; the system records the cash variance instead of blocking handover on a mismatch. Unpaid POS orders prevent shift closure.
- Staff progress placed → accepted → preparing → ready → served. Unpaid orders can be cancelled while placed or accepted. Paid orders must be refunded before cancellation; a refund itself is an append-only event.

## Roles

Tenant admin can manage the shared menu and access all tenant stores. A manager can manage tables and POS shifts in assigned stores, operate orders, collect cash and refund. An assigned viewer/cashier can create POS orders, progress orders and collect cash, but cannot manage menu/tables/shifts or refund. Cross-store access is denied by the backend.

## API

Authenticated tenant APIs live under `/api/v1/tenants/{tenant_id}/restaurant/` and `/api/v1/tenants/{tenant_id}/stores/{store_id}/restaurant/`. They use the existing session, membership, store access and CSRF rules.

| API | Purpose |
|---|---|
| `GET/POST categories/`, `GET/POST items/`, `PATCH items/{id}/` | shared menu and availability |
| `GET/POST stores/{store_id}/restaurant/tables/` | table registry and one-time QR credentials |
| `POST restaurant/tables/{id}/rotate-qr/`, `PATCH restaurant/tables/{id}/` | revoke/rotate QR or disable the table |
| `GET/POST stores/{store_id}/restaurant/orders/` | POS order queue and creation |
| `POST restaurant/orders/{id}/{accept,prepare,ready,serve,cancel}/` | order status transition |
| `POST restaurant/orders/{id}/pay-cash/`, `refund-cash/` | idempotent cash receipt and refund |
| `GET/POST stores/{store_id}/restaurant/pos-shift/` (`open`, `close`) | shift opening, cash count and handover |
| `GET /api/v1/restaurant/qr/{token}/menu/`, `POST .../orders/` | sole anonymous guest menu/order API exception |
| `GET /api/v1/restaurant/qr/{token}/code.svg` | render a local SVG QR code for the scoped guest link |

The public QR write requires CSRF and is throttled at 20 requests/minute per client IP; there is no public order listing/status lookup. Tokens are bearer credentials, so avoid sharing them outside their table. QR URLs use `FRONTEND_ORIGIN` (local default `http://localhost:4200`); set it to the actual same-origin frontend URL in each environment. Production must use a shared cache-backed throttle and configure trusted proxy/IP handling correctly.

## Validation workflow

1. Admin creates categories/items and tables in Restaurant.
2. Open a table QR link in a separate/private browser; submit a guest order.
3. Open a POS shift for the store; see and advance the same QR order, then receive cash.
4. Record a partial or full cash refund; verify the event and payment status.
5. Close the shift and compare counted cash with opening float plus receipts minus refunds; the recorded variance is retained.

Pending product policy for final review: whether to support multiple currencies, service charge/tax, tips/discounts, cash drawer integration, table merging/splitting, order status notifications, payment-at-order vs counter, receipt printing, and retention periods.
