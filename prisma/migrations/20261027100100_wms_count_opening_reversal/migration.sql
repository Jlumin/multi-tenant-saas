ALTER TABLE "wms_warehouses" ADD COLUMN "stock_revision" BIGINT NOT NULL DEFAULT 0;
UPDATE "wms_warehouses" w SET "stock_revision" = (
  SELECT count(*) FROM "wms_stock_movements" m WHERE m."tenant_id" = w."tenant_id" AND m."warehouse_id" = w."id"
);

CREATE TYPE "WmsStockCountStatus" AS ENUM ('draft', 'posted', 'stale', 'cancelled');

CREATE TABLE "wms_stock_counts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "number" VARCHAR(40) NOT NULL,
  "status" "WmsStockCountStatus" NOT NULL DEFAULT 'draft',
  "snapshot_revision" BIGINT NOT NULL,
  "memo" VARCHAR(500) NOT NULL DEFAULT '',
  "created_by_id" UUID NOT NULL,
  "posted_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "wms_stock_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_stock_counts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_counts_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_counts_post_state" CHECK (("status" = 'posted' AND "posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL) OR ("status" <> 'posted' AND "posted_at" IS NULL AND "posted_by_id" IS NULL)),
  CONSTRAINT "wms_stock_counts_values" CHECK (length(btrim("number")) > 0 AND length(btrim("memo")) <= 500 AND "version" > 0)
);
CREATE UNIQUE INDEX "wms_stock_counts_tenant_id_id_key" ON "wms_stock_counts"("tenant_id", "id");
CREATE UNIQUE INDEX "wms_stock_counts_tenant_id_id_warehouse_id_key" ON "wms_stock_counts"("tenant_id", "id", "warehouse_id");
CREATE UNIQUE INDEX "wms_stock_counts_tenant_id_number_key" ON "wms_stock_counts"("tenant_id", "number");
CREATE INDEX "wms_stock_counts_tenant_id_warehouse_id_status_created_at_i_idx" ON "wms_stock_counts"("tenant_id", "warehouse_id", "status", "created_at", "id");

CREATE TABLE "wms_stock_count_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "count_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "snapshot_quantity" INTEGER NOT NULL,
  "counted_quantity" INTEGER,
  "reason" VARCHAR(200) NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL,
  CONSTRAINT "wms_stock_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_stock_count_lines_tenant_id_count_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "count_id", "warehouse_id") REFERENCES "wms_stock_counts"("tenant_id", "id", "warehouse_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_count_lines_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_count_lines_tenant_id_warehouse_id_location_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id", "location_id") REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_stock_count_lines_values" CHECK ("snapshot_quantity" BETWEEN 0 AND 2147483647 AND ("counted_quantity" IS NULL OR "counted_quantity" BETWEEN 0 AND 2147483647) AND length(btrim("reason")) <= 200 AND "position" BETWEEN 1 AND 100000)
);
CREATE UNIQUE INDEX "wms_stock_count_lines_tenant_id_count_id_id_key" ON "wms_stock_count_lines"("tenant_id", "count_id", "id");
CREATE UNIQUE INDEX "wms_stock_count_lines_tenant_id_count_id_product_id_warehou_key" ON "wms_stock_count_lines"("tenant_id", "count_id", "product_id", "warehouse_id", "location_id");
CREATE UNIQUE INDEX "wms_stock_count_lines_tenant_id_count_id_position_key" ON "wms_stock_count_lines"("tenant_id", "count_id", "position");
CREATE INDEX "wms_stock_count_lines_tenant_id_count_id_position_idx" ON "wms_stock_count_lines"("tenant_id", "count_id", "position");

ALTER TABLE "wms_documents"
  ADD COLUMN "stock_count_id" UUID,
  ADD COLUMN "reversal_of_id" UUID,
  ADD CONSTRAINT "wms_documents_tenant_id_stock_count_id_fkey" FOREIGN KEY ("tenant_id", "stock_count_id") REFERENCES "wms_stock_counts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wms_documents_tenant_id_reversal_of_id_fkey" FOREIGN KEY ("tenant_id", "reversal_of_id") REFERENCES "wms_documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wms_documents_stock_count_shape" CHECK (("type" = 'adjustment' AND (("stock_count_id" IS NOT NULL AND "reversal_of_id" IS NULL) OR ("stock_count_id" IS NULL AND "reversal_of_id" IS NOT NULL))) OR ("type" <> 'adjustment' AND "stock_count_id" IS NULL));
CREATE UNIQUE INDEX "wms_documents_tenant_id_stock_count_id_key" ON "wms_documents"("tenant_id", "stock_count_id");
CREATE UNIQUE INDEX "wms_documents_tenant_id_reversal_of_id_key" ON "wms_documents"("tenant_id", "reversal_of_id");

ALTER TABLE "wms_document_lines" ADD COLUMN "adjustment_delta" INTEGER,
  ADD CONSTRAINT "wms_document_lines_adjustment_shape" CHECK ("adjustment_delta" IS NULL OR ("adjustment_delta" BETWEEN -2147483647 AND 2147483647 AND "adjustment_delta" <> 0 AND abs("adjustment_delta"::BIGINT) = "base_quantity"));
ALTER TABLE "wms_document_lines" DROP CONSTRAINT "wms_document_lines_values";
ALTER TABLE "wms_document_lines" ADD CONSTRAINT "wms_document_lines_values" CHECK (length(btrim("unit_code")) > 0 AND length(btrim("unit_name")) > 0 AND length(btrim("base_unit")) > 0 AND "quantity" BETWEEN 1 AND 2147483647 AND "factor" BETWEEN 1 AND 1000000 AND "unit_version" > 0 AND "base_quantity" BETWEEN 1 AND 2147483647 AND "base_quantity" = "quantity" * "factor" AND "position" BETWEEN 1 AND 100000);

CREATE TABLE "wms_opening_entries" (
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "line_id" UUID NOT NULL,
  CONSTRAINT "wms_opening_entries_pkey" PRIMARY KEY ("tenant_id", "product_id", "warehouse_id", "location_id"),
  CONSTRAINT "wms_opening_entries_tenant_id_document_id_line_id_key" UNIQUE ("tenant_id", "document_id", "line_id"),
  CONSTRAINT "wms_opening_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_opening_entries_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_opening_entries_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_opening_entries_tenant_id_warehouse_id_location_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id", "location_id") REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_opening_entries_tenant_id_document_id_line_id_fkey" FOREIGN KEY ("tenant_id", "document_id", "line_id") REFERENCES "wms_document_lines"("tenant_id", "document_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE OR REPLACE FUNCTION guard_wms_document_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_id UUID; document_type "WmsDocumentType"; document_status "WmsDocumentStatus"; stock_count_id UUID; v_reversal_of_id UUID; source RECORD;
BEGIN
  document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."document_id" ELSE NEW."document_id" END;
  SELECT d."type", d."status", d."stock_count_id", d."reversal_of_id" INTO document_type, document_status, stock_count_id, v_reversal_of_id
    FROM "wms_documents" d WHERE d."tenant_id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END AND d."id" = document_id;
  IF NOT FOUND OR (document_status <> 'draft' AND NOT (TG_OP = 'INSERT' AND document_status = 'posted' AND (stock_count_id IS NOT NULL OR v_reversal_of_id IS NOT NULL))) THEN
    RAISE EXCEPTION 'Only draft documents or atomic posted adjustments can change lines' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."document_id" IS DISTINCT FROM OLD."document_id") THEN
    RAISE EXCEPTION 'WMS document line identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF (document_type = 'adjustment' AND (NEW."adjustment_delta" IS NULL OR abs(NEW."adjustment_delta"::BIGINT) <> NEW."base_quantity"))
     OR (document_type <> 'adjustment' AND NEW."adjustment_delta" IS NOT NULL) THEN
    RAISE EXCEPTION 'Adjustment line must preserve its signed base quantity' USING ERRCODE = '23514';
  END IF;
  IF stock_count_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "wms_stock_counts" c WHERE c."tenant_id" = NEW."tenant_id" AND c."id" = stock_count_id AND c."status" = 'posted') THEN
    RAISE EXCEPTION 'Count adjustment requires a posted stock count' USING ERRCODE = '23514';
  END IF;
  IF v_reversal_of_id IS NOT NULL THEN
    SELECT original."type", original."warehouse_id", original."destination_warehouse_id", old_line.* INTO source
      FROM "wms_documents" original JOIN "wms_document_lines" old_line ON old_line."tenant_id" = original."tenant_id" AND old_line."document_id" = original."id"
      WHERE original."tenant_id" = NEW."tenant_id" AND original."id" = v_reversal_of_id AND old_line."position" = NEW."position";
    IF NOT FOUND OR source."product_id" <> NEW."product_id" OR source."unit_id" <> NEW."unit_id" OR source."quantity" <> NEW."quantity" OR source."factor" <> NEW."factor" OR source."base_quantity" <> NEW."base_quantity" THEN
      RAISE EXCEPTION 'Reversal line must preserve its source quantity and unit' USING ERRCODE = '23514';
    END IF;
    IF source."type" IN ('inbound', 'opening', 'outbound') AND (NEW."warehouse_id" <> source."warehouse_id" OR NEW."location_id" <> source."location_id" OR NEW."target_warehouse_id" IS NOT NULL OR NEW."adjustment_delta" IS NOT NULL) THEN
      RAISE EXCEPTION 'Reversal line location does not match original' USING ERRCODE = '23514';
    ELSIF source."type" = 'transfer' AND (NEW."warehouse_id" <> source."destination_warehouse_id" OR NEW."location_id" <> source."target_location_id" OR NEW."target_warehouse_id" <> source."warehouse_id" OR NEW."target_location_id" <> source."location_id") THEN
      RAISE EXCEPTION 'Transfer reversal must swap source and destination' USING ERRCODE = '23514';
    ELSIF source."type" = 'adjustment' AND (NEW."warehouse_id" <> source."warehouse_id" OR NEW."location_id" <> source."location_id" OR NEW."adjustment_delta" <> -source."adjustment_delta") THEN
      RAISE EXCEPTION 'Adjustment reversal must invert its signed quantity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_wms_reversal_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD; expected_type "WmsDocumentType";
BEGIN
  IF NEW."reversal_of_id" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO source FROM "wms_documents" d WHERE d."tenant_id" = NEW."tenant_id" AND d."id" = NEW."reversal_of_id" AND d."status" = 'posted' AND d."reversal_of_id" IS NULL;
  IF NOT FOUND OR NEW."reversal_of_id" = NEW."id" THEN RAISE EXCEPTION 'Reversal requires an unreversed posted source document' USING ERRCODE = '23514'; END IF;
  expected_type := CASE WHEN source."type" IN ('inbound', 'opening') THEN 'outbound'::"WmsDocumentType" WHEN source."type" = 'outbound' THEN 'inbound'::"WmsDocumentType" ELSE source."type" END;
  IF NEW."type" <> expected_type OR NEW."stock_count_id" IS NOT NULL
    OR (source."type" = 'transfer' AND (NEW."warehouse_id" <> source."destination_warehouse_id" OR NEW."destination_warehouse_id" <> source."warehouse_id"))
    OR (source."type" <> 'transfer' AND (NEW."warehouse_id" <> source."warehouse_id" OR NEW."destination_warehouse_id" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Reversal document must exactly reverse the source type and warehouse scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_reversal_document_guard BEFORE INSERT ON "wms_documents" FOR EACH ROW EXECUTE FUNCTION guard_wms_reversal_document();

CREATE FUNCTION guard_wms_stock_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS stock counts must be retained' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."warehouse_id" IS DISTINCT FROM OLD."warehouse_id" OR NEW."number" IS DISTINCT FROM OLD."number" OR NEW."snapshot_revision" IS DISTINCT FROM OLD."snapshot_revision" OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'WMS stock count snapshot identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" <> 'draft' OR NEW."status" NOT IN ('draft', 'posted', 'stale', 'cancelled') OR NEW."version" <> OLD."version" + 1 OR (NEW."status" <> OLD."status" AND NEW."status" NOT IN ('posted', 'stale', 'cancelled')) THEN
      RAISE EXCEPTION 'Invalid WMS stock count transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_stock_counts_guard BEFORE UPDATE OR DELETE ON "wms_stock_counts" FOR EACH ROW EXECUTE FUNCTION guard_wms_stock_count();

CREATE FUNCTION guard_wms_stock_count_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE count_id UUID; count_status "WmsStockCountStatus";
BEGIN
  count_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."count_id" ELSE NEW."count_id" END;
  SELECT c."status" INTO count_status FROM "wms_stock_counts" c WHERE c."tenant_id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."tenant_id" ELSE NEW."tenant_id" END AND c."id" = count_id;
  IF NOT FOUND OR count_status <> 'draft' THEN RAISE EXCEPTION 'Only draft stock count lines can change' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."count_id" IS DISTINCT FROM OLD."count_id" OR NEW."warehouse_id" IS DISTINCT FROM OLD."warehouse_id" OR NEW."product_id" IS DISTINCT FROM OLD."product_id" OR NEW."location_id" IS DISTINCT FROM OLD."location_id" OR NEW."snapshot_quantity" IS DISTINCT FROM OLD."snapshot_quantity" OR NEW."position" IS DISTINCT FROM OLD."position") THEN
    RAISE EXCEPTION 'Stock count snapshot line is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_stock_count_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "wms_stock_count_lines" FOR EACH ROW EXECUTE FUNCTION guard_wms_stock_count_line();

CREATE OR REPLACE FUNCTION guard_wms_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_type "WmsDocumentType"; line RECORD; document_destination UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'WMS stock movements are append-only' USING ERRCODE = '23514'; END IF;
  SELECT d."type", d."destination_warehouse_id" INTO document_type, document_destination
    FROM "wms_documents" d WHERE d."tenant_id" = NEW."tenant_id" AND d."id" = NEW."document_id" AND d."status" = 'posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'WMS movement requires a posted document' USING ERRCODE = '23514'; END IF;
  SELECT l.* INTO line FROM "wms_document_lines" l WHERE l."tenant_id" = NEW."tenant_id" AND l."document_id" = NEW."document_id" AND l."id" = NEW."line_id";
  IF NOT FOUND OR line."product_id" <> NEW."product_id"
     OR NEW."actor_id" <> (SELECT "posted_by_id" FROM "wms_documents" WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."document_id")
     OR (document_type IN ('inbound', 'opening') AND (line."warehouse_id" <> NEW."warehouse_id" OR line."location_id" <> NEW."location_id" OR NEW."delta" <> line."base_quantity"))
     OR (document_type = 'outbound' AND (line."warehouse_id" <> NEW."warehouse_id" OR line."location_id" <> NEW."location_id" OR NEW."delta" <> -line."base_quantity"))
     OR (document_type = 'adjustment' AND (line."warehouse_id" <> NEW."warehouse_id" OR line."location_id" <> NEW."location_id" OR NEW."delta" <> line."adjustment_delta"))
     OR (document_type = 'transfer' AND (line."target_warehouse_id" IS NULL OR line."target_location_id" IS NULL OR line."target_warehouse_id" <> document_destination OR (line."warehouse_id" = line."target_warehouse_id" AND line."location_id" = line."target_location_id")))
     OR (document_type = 'transfer' AND NOT ((line."warehouse_id" = NEW."warehouse_id" AND line."location_id" = NEW."location_id" AND NEW."delta" = -line."base_quantity") OR (line."target_warehouse_id" = document_destination AND line."target_warehouse_id" = NEW."warehouse_id" AND line."target_location_id" = NEW."location_id" AND NEW."delta" = line."base_quantity"))) THEN
    RAISE EXCEPTION 'WMS movement does not match its posted document line' USING ERRCODE = '23514';
  END IF;
  IF document_type = 'opening' THEN
    IF EXISTS (SELECT 1 FROM "wms_stock_movements" m WHERE m."tenant_id" = NEW."tenant_id" AND m."product_id" = NEW."product_id" AND m."warehouse_id" = NEW."warehouse_id" AND m."location_id" = NEW."location_id") THEN
      RAISE EXCEPTION 'Opening stock requires an unused product location' USING ERRCODE = '23514';
    END IF;
    INSERT INTO "wms_opening_entries" VALUES (NEW."tenant_id", NEW."product_id", NEW."warehouse_id", NEW."location_id", NEW."document_id", NEW."line_id");
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_wms_master() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS master records must be retained' USING ERRCODE = '23514'; END IF;
  IF (to_jsonb(NEW) - ARRAY['name','is_active','version','updated_at','stock_revision']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['name','is_active','version','updated_at','stock_revision']) THEN
    RAISE EXCEPTION 'WMS identity and conversion are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'wms_warehouses' THEN
    IF NEW."stock_revision" IS DISTINCT FROM OLD."stock_revision" AND NEW."stock_revision" <> OLD."stock_revision" + 1 THEN
      RAISE EXCEPTION 'Warehouse stock revision must advance one movement at a time' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF COALESCE((to_jsonb(OLD)->>'is_base')::boolean, false) OR COALESCE((to_jsonb(OLD)->>'is_default')::boolean, false) THEN
    RAISE EXCEPTION 'WMS system defaults are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION apply_wms_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
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
  UPDATE "wms_warehouses" SET "stock_revision" = "stock_revision" + 1 WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."warehouse_id";
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_wms_count_master_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."is_active" AND NOT NEW."is_active" THEN
    IF TG_TABLE_NAME = 'wms_products' THEN
      IF EXISTS (SELECT 1 FROM "wms_stock_count_lines" l JOIN "wms_stock_counts" c ON c."tenant_id" = l."tenant_id" AND c."id" = l."count_id" WHERE l."tenant_id" = OLD."tenant_id" AND l."product_id" = OLD."id" AND c."status" = 'draft') THEN RAISE EXCEPTION 'Product is used in a draft stock count' USING ERRCODE = '23514'; END IF;
    ELSIF TG_TABLE_NAME = 'wms_locations' THEN
      IF EXISTS (SELECT 1 FROM "wms_stock_count_lines" l JOIN "wms_stock_counts" c ON c."tenant_id" = l."tenant_id" AND c."id" = l."count_id" WHERE l."tenant_id" = OLD."tenant_id" AND l."warehouse_id" = OLD."warehouse_id" AND l."location_id" = OLD."id" AND c."status" = 'draft') THEN RAISE EXCEPTION 'Location is used in a draft stock count' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_product_count_guard BEFORE UPDATE OF "is_active" ON "wms_products" FOR EACH ROW EXECUTE FUNCTION prevent_wms_count_master_deactivation();
CREATE TRIGGER wms_location_count_guard BEFORE UPDATE OF "is_active" ON "wms_locations" FOR EACH ROW EXECUTE FUNCTION prevent_wms_count_master_deactivation();
