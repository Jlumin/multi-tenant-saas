# WMS

Phase 2 initial scope is implemented in `models.py`, `services.py`, `serializers.py`, and `api.py`; versioned PostgreSQL schema/guards are in `migrations/`. The module owns tenant-scoped products, integer package conversions, warehouses/locations, receipt/issue drafts, stock balances and append-only movements. Only tenant admins post; managers handle drafts and viewers are read-only. See `docs/architecture/wms-phase2.md` and `docs/database/wms-phase2.md`.

Do not place WMS writes in platform_core or other business modules. E-Commerce consumes WMS only through `modules.wms.application`; WMS owns reservations and emits ordinary issue documents/movements on capture. Active reservations reduce available stock and are protected from manual issue posting. Transfers, opening inventory, counts, adjustments and reversals are outside the approved slices.
