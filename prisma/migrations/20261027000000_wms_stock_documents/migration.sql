CREATE TYPE "WmsDocumentType" AS ENUM ('inbound', 'outbound');
CREATE TYPE "WmsDocumentStatus" AS ENUM ('draft', 'posted', 'cancelled');

CREATE TABLE "wms_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "number" VARCHAR(40) NOT NULL,
  "type" "WmsDocumentType" NOT NULL,
  "status" "WmsDocumentStatus" NOT NULL DEFAULT 'draft',
  "memo" VARCHAR(500) NOT NULL DEFAULT '',
  "created_by_id" UUID NOT NULL,
  "posted_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "wms_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_documents_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_documents_values" CHECK (length(btrim("number")) > 0 AND length(btrim("memo")) <= 500 AND "version" > 0),
  CONSTRAINT "wms_documents_post_state" CHECK (("status" = 'posted' AND "posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL) OR ("status" <> 'posted' AND "posted_at" IS NULL AND "posted_by_id" IS NULL))
);
CREATE UNIQUE INDEX "wms_documents_tenant_id_id_key" ON "wms_documents"("tenant_id", "id");
CREATE UNIQUE INDEX "wms_documents_tenant_id_id_warehouse_id_key" ON "wms_documents"("tenant_id", "id", "warehouse_id");
CREATE UNIQUE INDEX "wms_documents_tenant_id_number_key" ON "wms_documents"("tenant_id", "number");
CREATE INDEX "wms_documents_tenant_id_type_status_created_at_id_idx" ON "wms_documents"("tenant_id", "type", "status", "created_at", "id");

CREATE TABLE "wms_document_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "unit_code" VARCHAR(40) NOT NULL,
  "unit_name" VARCHAR(120) NOT NULL,
  "base_unit" VARCHAR(20) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "factor" INTEGER NOT NULL,
  "unit_version" INTEGER NOT NULL,
  "base_quantity" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "wms_document_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_document_lines_tenant_id_document_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "document_id", "warehouse_id") REFERENCES "wms_documents"("tenant_id", "id", "warehouse_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_document_lines_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_document_lines_tenant_id_warehouse_id_location_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id", "location_id") REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_document_lines_tenant_id_product_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "product_id", "unit_id") REFERENCES "wms_product_units"("tenant_id", "product_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_document_lines_values" CHECK (length(btrim("unit_code")) > 0 AND length(btrim("unit_name")) > 0 AND length(btrim("base_unit")) > 0 AND "quantity" BETWEEN 1 AND 2147483647 AND "factor" BETWEEN 1 AND 1000000 AND "unit_version" > 0 AND "base_quantity" BETWEEN 1 AND 2147483647 AND "base_quantity" = "quantity" * "factor" AND "position" BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "wms_document_lines_tenant_id_document_id_id_key" ON "wms_document_lines"("tenant_id", "document_id", "id");
CREATE UNIQUE INDEX "wms_document_lines_tenant_id_document_id_position_key" ON "wms_document_lines"("tenant_id", "document_id", "position");
CREATE INDEX "wms_document_lines_tenant_id_document_id_position_idx" ON "wms_document_lines"("tenant_id", "document_id", "position");

CREATE TABLE "wms_stock_balances" (
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_stock_balances_pkey" PRIMARY KEY ("tenant_id", "product_id", "warehouse_id", "location_id"),
  CONSTRAINT "wms_stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_balances_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_balances_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_balances_tenant_id_warehouse_id_location_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id", "location_id") REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_balances_quantity" CHECK ("quantity" BETWEEN 0 AND 2147483647)
);
CREATE INDEX "wms_stock_balances_tenant_id_warehouse_id_location_id_produ_idx" ON "wms_stock_balances"("tenant_id", "warehouse_id", "location_id", "product_id");

CREATE TABLE "wms_stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "line_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "delta" INTEGER NOT NULL,
  "actor_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_movements_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "wms_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_movements_tenant_id_document_id_line_id_fkey" FOREIGN KEY ("tenant_id", "document_id", "line_id") REFERENCES "wms_document_lines"("tenant_id", "document_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_movements_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_movements_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_movements_tenant_id_warehouse_id_location_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id", "location_id") REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_movements_values" CHECK ("delta" BETWEEN -2147483647 AND 2147483647 AND "delta" <> 0)
);
CREATE UNIQUE INDEX "wms_stock_movements_tenant_id_line_id_key" ON "wms_stock_movements"("tenant_id", "line_id");
CREATE UNIQUE INDEX "wms_stock_movements_tenant_id_document_id_line_id_key" ON "wms_stock_movements"("tenant_id", "document_id", "line_id");
CREATE INDEX "wms_stock_movements_tenant_id_product_id_created_at_id_idx" ON "wms_stock_movements"("tenant_id", "product_id", "created_at", "id");
CREATE INDEX "wms_stock_movements_tenant_id_warehouse_id_location_id_crea_idx" ON "wms_stock_movements"("tenant_id", "warehouse_id", "location_id", "created_at", "id");

CREATE TABLE "wms_posting_keys" (
  "tenant_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "document_id" UUID NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_posting_keys_pkey" PRIMARY KEY ("tenant_id", "key"),
  CONSTRAINT "wms_posting_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_posting_keys_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "wms_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_posting_keys_hash" CHECK ("key" ~ '^[A-Za-z0-9._:-]{8,128}$' AND "payload_hash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "wms_posting_keys_tenant_id_document_id_idx" ON "wms_posting_keys"("tenant_id", "document_id");

CREATE FUNCTION guard_wms_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WMS documents must be retained' USING ERRCODE = '23514';
  END IF;
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."type" IS DISTINCT FROM OLD."type" OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'WMS document identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'draft' THEN
    RAISE EXCEPTION 'Posted or cancelled WMS documents are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" NOT IN ('draft', 'posted', 'cancelled') OR (NEW."status" <> OLD."status" AND NEW."status" NOT IN ('posted', 'cancelled')) OR NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Invalid WMS document transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_documents_guard BEFORE UPDATE OR DELETE ON "wms_documents" FOR EACH ROW EXECUTE FUNCTION guard_wms_document();

CREATE FUNCTION guard_wms_document_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_id UUID;
BEGIN
  document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."document_id" ELSE NEW."document_id" END;
  IF NOT EXISTS (SELECT 1 FROM "wms_documents" d WHERE d."tenant_id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END AND d."id" = document_id AND d."status" = 'draft') THEN
    RAISE EXCEPTION 'Only draft WMS document lines can change' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_document_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "wms_document_lines" FOR EACH ROW EXECUTE FUNCTION guard_wms_document_line();

CREATE FUNCTION guard_wms_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_type "WmsDocumentType"; line RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'WMS stock movements are append-only' USING ERRCODE = '23514';
  END IF;
  SELECT d."type" INTO document_type FROM "wms_documents" d WHERE d."tenant_id" = NEW."tenant_id" AND d."id" = NEW."document_id" AND d."status" = 'posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'WMS movement requires a posted document' USING ERRCODE = '23514'; END IF;
  SELECT l.* INTO line FROM "wms_document_lines" l WHERE l."tenant_id" = NEW."tenant_id" AND l."document_id" = NEW."document_id" AND l."id" = NEW."line_id";
  IF NOT FOUND OR line."product_id" <> NEW."product_id" OR line."warehouse_id" <> NEW."warehouse_id" OR line."location_id" <> NEW."location_id" OR NEW."actor_id" <> (SELECT "posted_by_id" FROM "wms_documents" WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."document_id") OR (document_type = 'inbound' AND NEW."delta" <> line."base_quantity") OR (document_type = 'outbound' AND NEW."delta" <> -line."base_quantity") THEN
    RAISE EXCEPTION 'WMS movement does not match its posted document line' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_stock_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON "wms_stock_movements" FOR EACH ROW EXECUTE FUNCTION guard_wms_stock_movement();

CREATE FUNCTION apply_wms_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE updated_rows INTEGER;
BEGIN
  IF NEW."delta" < 0 THEN
    UPDATE "wms_stock_balances" SET "quantity" = "quantity" + NEW."delta", "updated_at" = CURRENT_TIMESTAMP
      WHERE "tenant_id" = NEW."tenant_id" AND "product_id" = NEW."product_id" AND "warehouse_id" = NEW."warehouse_id" AND "location_id" = NEW."location_id" AND "quantity" >= -NEW."delta";
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = '23514'; END IF;
  ELSE
    INSERT INTO "wms_stock_balances" ("tenant_id", "product_id", "warehouse_id", "location_id", "quantity")
      VALUES (NEW."tenant_id", NEW."product_id", NEW."warehouse_id", NEW."location_id", NEW."delta")
      ON CONFLICT ("tenant_id", "product_id", "warehouse_id", "location_id") DO UPDATE SET "quantity" = "wms_stock_balances"."quantity" + EXCLUDED."quantity", "updated_at" = CURRENT_TIMESTAMP
      WHERE "wms_stock_balances"."quantity" <= 2147483647 - EXCLUDED."quantity";
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows <> 1 THEN RAISE EXCEPTION 'Stock quantity overflow' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_stock_movements_apply AFTER INSERT ON "wms_stock_movements" FOR EACH ROW EXECUTE FUNCTION apply_wms_stock_movement();

CREATE FUNCTION prevent_wms_master_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_resource_id UUID; v_product_id UUID; v_warehouse_id UUID;
BEGIN
  IF OLD."is_active" AND NOT NEW."is_active" THEN
    IF TG_TABLE_NAME = 'wms_products' THEN
      v_resource_id := OLD."id";
      IF EXISTS (SELECT 1 FROM "wms_stock_balances" WHERE "tenant_id" = OLD."tenant_id" AND "product_id" = v_resource_id AND "quantity" > 0) OR EXISTS (SELECT 1 FROM "wms_document_lines" l JOIN "wms_documents" d ON d."tenant_id" = l."tenant_id" AND d."id" = l."document_id" WHERE l."tenant_id" = OLD."tenant_id" AND l."product_id" = v_resource_id AND d."status" = 'draft') THEN RAISE EXCEPTION 'Product has stock or draft documents' USING ERRCODE = '23514'; END IF;
    ELSIF TG_TABLE_NAME = 'wms_warehouses' THEN
      v_resource_id := OLD."id";
      IF EXISTS (SELECT 1 FROM "wms_stock_balances" WHERE "tenant_id" = OLD."tenant_id" AND "warehouse_id" = v_resource_id AND "quantity" > 0) OR EXISTS (SELECT 1 FROM "wms_documents" WHERE "tenant_id" = OLD."tenant_id" AND "warehouse_id" = v_resource_id AND "status" = 'draft') THEN RAISE EXCEPTION 'Warehouse has stock or draft documents' USING ERRCODE = '23514'; END IF;
    ELSIF TG_TABLE_NAME = 'wms_locations' THEN
      v_resource_id := OLD."id"; v_warehouse_id := OLD."warehouse_id";
      IF EXISTS (SELECT 1 FROM "wms_stock_balances" WHERE "tenant_id" = OLD."tenant_id" AND "warehouse_id" = v_warehouse_id AND "location_id" = v_resource_id AND "quantity" > 0) OR EXISTS (SELECT 1 FROM "wms_document_lines" l JOIN "wms_documents" d ON d."tenant_id" = l."tenant_id" AND d."id" = l."document_id" WHERE l."tenant_id" = OLD."tenant_id" AND l."warehouse_id" = v_warehouse_id AND l."location_id" = v_resource_id AND d."status" = 'draft') THEN RAISE EXCEPTION 'Location has stock or draft documents' USING ERRCODE = '23514'; END IF;
    ELSIF TG_TABLE_NAME = 'wms_product_units' THEN
      v_product_id := OLD."product_id"; v_resource_id := OLD."id";
      IF EXISTS (SELECT 1 FROM "wms_document_lines" l JOIN "wms_documents" d ON d."tenant_id" = l."tenant_id" AND d."id" = l."document_id" WHERE l."tenant_id" = OLD."tenant_id" AND l."product_id" = v_product_id AND l."unit_id" = v_resource_id AND d."status" = 'draft') THEN RAISE EXCEPTION 'Unit is used by draft documents' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_product_deactivation_guard BEFORE UPDATE OF "is_active" ON "wms_products" FOR EACH ROW EXECUTE FUNCTION prevent_wms_master_deactivation();
CREATE TRIGGER wms_warehouse_deactivation_guard BEFORE UPDATE OF "is_active" ON "wms_warehouses" FOR EACH ROW EXECUTE FUNCTION prevent_wms_master_deactivation();
CREATE TRIGGER wms_location_deactivation_guard BEFORE UPDATE OF "is_active" ON "wms_locations" FOR EACH ROW EXECUTE FUNCTION prevent_wms_master_deactivation();
CREATE TRIGGER wms_unit_deactivation_guard BEFORE UPDATE OF "is_active" ON "wms_product_units" FOR EACH ROW EXECUTE FUNCTION prevent_wms_master_deactivation();
