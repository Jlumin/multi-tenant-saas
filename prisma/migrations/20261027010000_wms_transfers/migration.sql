ALTER TABLE "wms_documents"
  ADD COLUMN "destination_warehouse_id" UUID,
  ADD CONSTRAINT "wms_documents_tenant_id_destination_warehouse_id_fkey"
    FOREIGN KEY ("tenant_id", "destination_warehouse_id")
    REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wms_documents_transfer_shape"
    CHECK (("type" = 'transfer' AND "destination_warehouse_id" IS NOT NULL) OR ("type" <> 'transfer' AND "destination_warehouse_id" IS NULL));
CREATE UNIQUE INDEX "wms_documents_tenant_id_id_destination_warehouse_id_key"
  ON "wms_documents"("tenant_id", "id", "destination_warehouse_id");

ALTER TABLE "wms_document_lines"
  ADD COLUMN "target_warehouse_id" UUID,
  ADD COLUMN "target_location_id" UUID,
  ADD CONSTRAINT "wms_document_lines_transfer_shape"
    CHECK (("target_warehouse_id" IS NULL) = ("target_location_id" IS NULL));
ALTER TABLE "wms_document_lines"
  ADD CONSTRAINT "wms_document_lines_tenant_id_document_id_target_warehouse__fkey"
    FOREIGN KEY ("tenant_id", "document_id", "target_warehouse_id")
    REFERENCES "wms_documents"("tenant_id", "id", "destination_warehouse_id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "wms_document_lines_tenant_id_target_warehouse_id_target_lo_fkey"
    FOREIGN KEY ("tenant_id", "target_warehouse_id", "target_location_id")
    REFERENCES "wms_locations"("tenant_id", "warehouse_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

DROP INDEX "wms_stock_movements_tenant_id_line_id_key";
DROP INDEX "wms_stock_movements_tenant_id_document_id_line_id_key";
CREATE UNIQUE INDEX "wms_stock_movements_tenant_id_document_id_line_id_warehouse_key"
  ON "wms_stock_movements"("tenant_id", "document_id", "line_id", "warehouse_id", "location_id");

CREATE OR REPLACE FUNCTION guard_wms_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_type "WmsDocumentType"; line RECORD; document_destination UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'WMS stock movements are append-only' USING ERRCODE = '23514';
  END IF;
  SELECT d."type", d."destination_warehouse_id" INTO document_type, document_destination
    FROM "wms_documents" d WHERE d."tenant_id" = NEW."tenant_id" AND d."id" = NEW."document_id" AND d."status" = 'posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'WMS movement requires a posted document' USING ERRCODE = '23514'; END IF;
  SELECT l.* INTO line FROM "wms_document_lines" l WHERE l."tenant_id" = NEW."tenant_id" AND l."document_id" = NEW."document_id" AND l."id" = NEW."line_id";
  IF NOT FOUND OR line."product_id" <> NEW."product_id"
     OR NEW."actor_id" <> (SELECT "posted_by_id" FROM "wms_documents" WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."document_id")
     OR (document_type = 'inbound' AND (line."warehouse_id" <> NEW."warehouse_id" OR line."location_id" <> NEW."location_id" OR NEW."delta" <> line."base_quantity"))
     OR (document_type = 'outbound' AND (line."warehouse_id" <> NEW."warehouse_id" OR line."location_id" <> NEW."location_id" OR NEW."delta" <> -line."base_quantity"))
     OR (document_type = 'transfer' AND (line."target_warehouse_id" IS NULL OR line."target_location_id" IS NULL OR line."target_warehouse_id" <> document_destination OR (line."warehouse_id" = line."target_warehouse_id" AND line."location_id" = line."target_location_id")))
     OR (document_type = 'transfer' AND NOT (
       (line."warehouse_id" = NEW."warehouse_id" AND line."location_id" = NEW."location_id" AND NEW."delta" = -line."base_quantity")
       OR (line."target_warehouse_id" = document_destination AND line."target_warehouse_id" = NEW."warehouse_id" AND line."target_location_id" = NEW."location_id" AND NEW."delta" = line."base_quantity")
     )) THEN
    RAISE EXCEPTION 'WMS movement does not match its posted document line' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_wms_transfer_movement_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_type "WmsDocumentType"; movement_count INTEGER;
BEGIN
  SELECT d."type" INTO document_type FROM "wms_documents" d WHERE d."tenant_id" = NEW."tenant_id" AND d."id" = NEW."document_id";
  IF document_type = 'transfer' THEN
    SELECT count(*) INTO movement_count FROM "wms_stock_movements" m WHERE m."tenant_id" = NEW."tenant_id" AND m."document_id" = NEW."document_id" AND m."line_id" = NEW."line_id";
    IF movement_count <> 2 THEN RAISE EXCEPTION 'Transfer requires exactly one source and one destination movement' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER wms_transfer_movement_pair_guard
  AFTER INSERT ON "wms_stock_movements" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_wms_transfer_movement_pair();

CREATE FUNCTION prevent_wms_transfer_target_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."is_active" AND NOT NEW."is_active" THEN
    IF TG_TABLE_NAME = 'wms_warehouses' THEN
      IF EXISTS (
        SELECT 1 FROM "wms_documents" d WHERE d."tenant_id" = OLD."tenant_id" AND d."destination_warehouse_id" = OLD."id" AND d."status" = 'draft'
      ) THEN RAISE EXCEPTION 'Warehouse is used as a draft transfer target' USING ERRCODE = '23514'; END IF;
    ELSIF TG_TABLE_NAME = 'wms_locations' THEN
      IF EXISTS (
        SELECT 1 FROM "wms_document_lines" l JOIN "wms_documents" d ON d."tenant_id" = l."tenant_id" AND d."id" = l."document_id"
        WHERE l."tenant_id" = OLD."tenant_id" AND l."target_warehouse_id" = OLD."warehouse_id" AND l."target_location_id" = OLD."id" AND d."status" = 'draft'
      ) THEN RAISE EXCEPTION 'Location is used as a draft transfer target' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_warehouse_transfer_target_guard BEFORE UPDATE OF "is_active" ON "wms_warehouses" FOR EACH ROW EXECUTE FUNCTION prevent_wms_transfer_target_deactivation();
CREATE TRIGGER wms_location_transfer_target_guard BEFORE UPDATE OF "is_active" ON "wms_locations" FOR EACH ROW EXECUTE FUNCTION prevent_wms_transfer_target_deactivation();
