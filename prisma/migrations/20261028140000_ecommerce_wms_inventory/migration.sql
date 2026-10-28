ALTER TABLE "ecom_stores" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "ecom_products" ADD COLUMN "wms_product_id" UUID;
ALTER TABLE "ecom_order_lines" ADD COLUMN "wms_product_id" UUID;
CREATE UNIQUE INDEX "ecom_products_tenant_id_store_id_wms_product_id_key" ON "ecom_products"("tenant_id", "store_id", "wms_product_id");

CREATE TABLE "wms_tenant_settings" (
  "tenant_id" UUID NOT NULL,
  "allow_inter_warehouse_transfers" BOOLEAN NOT NULL DEFAULT FALSE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_tenant_settings_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "wms_tenant_settings_version_check" CHECK ("version" > 0),
  CONSTRAINT "wms_tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "wms_tenant_settings" ("tenant_id") SELECT "id" FROM "tenants";

CREATE TYPE "WmsStockReservationStatus" AS ENUM ('active', 'fulfilled', 'released');

CREATE TABLE "wms_stock_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "source_order_id" UUID NOT NULL,
  "status" "WmsStockReservationStatus" NOT NULL DEFAULT 'active',
  "idempotency_key_hash" CHAR(64) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_stock_reservations_key_check" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "wms_stock_reservations_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "wms_stock_reservations_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "wms_stock_reservations_tenant_id_idempotency_key_hash_key" UNIQUE ("tenant_id", "idempotency_key_hash"),
  CONSTRAINT "wms_stock_reservations_tenant_id_source_order_id_key" UNIQUE ("tenant_id", "source_order_id"),
  CONSTRAINT "wms_stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_reservations_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "wms_stock_reservations_tenant_id_warehouse_id_status_idx" ON "wms_stock_reservations"("tenant_id", "warehouse_id", "status");

CREATE TABLE "wms_stock_reservation_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "wms_stock_reservation_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_stock_reservation_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "wms_stock_reservation_lines_tenant_id_reservation_id_produc_key" UNIQUE ("tenant_id", "reservation_id", "product_id", "location_id"),
  CONSTRAINT "wms_stock_reservation_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_reservation_lines_tenant_id_reservation_id_fkey" FOREIGN KEY ("tenant_id", "reservation_id") REFERENCES "wms_stock_reservations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_reservation_lines_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_reservation_lines_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_reservation_lines_tenant_id_warehouse_id_locatio_fkey" FOREIGN KEY ("tenant_id", "warehouse_id", "location_id") REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "wms_stock_reservation_lines_tenant_id_warehouse_id_product__idx" ON "wms_stock_reservation_lines"("tenant_id", "warehouse_id", "product_id", "location_id");

CREATE FUNCTION guard_wms_stock_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS reservations must be retained' USING ERRCODE = '23514'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."warehouse_id" IS DISTINCT FROM OLD."warehouse_id" OR NEW."source_order_id" IS DISTINCT FROM OLD."source_order_id" OR NEW."idempotency_key_hash" IS DISTINCT FROM OLD."idempotency_key_hash" OR NEW."payload_hash" IS DISTINCT FROM OLD."payload_hash" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'WMS reservation identity and content are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (OLD."status" = 'active' AND NEW."status" IN ('fulfilled', 'released')) THEN
    RAISE EXCEPTION 'Invalid WMS reservation transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "wms_stock_reservations_guard" BEFORE UPDATE OR DELETE ON "wms_stock_reservations" FOR EACH ROW EXECUTE FUNCTION guard_wms_stock_reservation();

CREATE FUNCTION guard_wms_stock_reservation_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WMS reservation lines are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "wms_stock_reservation_lines_guard" BEFORE UPDATE OR DELETE ON "wms_stock_reservation_lines" FOR EACH ROW EXECUTE FUNCTION guard_wms_stock_reservation_line();
