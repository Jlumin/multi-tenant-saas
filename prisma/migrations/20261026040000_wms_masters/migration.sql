CREATE TABLE "wms_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "sku" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "base_unit" VARCHAR(20) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_products_values" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$' AND length(btrim("name")) > 0 AND length(btrim("base_unit")) > 0 AND "version" > 0)
);
CREATE UNIQUE INDEX "wms_products_tenant_id_id_key" ON "wms_products"("tenant_id", "id");
CREATE UNIQUE INDEX "wms_products_tenant_id_sku_key" ON "wms_products"("tenant_id", "sku");
CREATE INDEX "wms_products_tenant_id_is_active_id_idx" ON "wms_products"("tenant_id", "is_active", "id");

CREATE TABLE "wms_product_units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "factor" INTEGER NOT NULL,
  "is_base" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_product_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_product_units_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "wms_products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_product_units_values" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$' AND length(btrim("name")) > 0 AND "version" > 0 AND "factor" BETWEEN 1 AND 1000000),
  CONSTRAINT "wms_product_units_base" CHECK ("is_base" = ("code" = 'BASE') AND (NOT "is_base" OR ("factor" = 1 AND "is_active")))
);
CREATE UNIQUE INDEX "wms_product_units_tenant_id_product_id_id_key" ON "wms_product_units"("tenant_id", "product_id", "id");
CREATE UNIQUE INDEX "wms_product_units_tenant_id_product_id_code_key" ON "wms_product_units"("tenant_id", "product_id", "code");
CREATE INDEX "wms_product_units_tenant_id_product_id_is_active_id_idx" ON "wms_product_units"("tenant_id", "product_id", "is_active", "id");

CREATE TABLE "wms_warehouses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_warehouses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_warehouses_values" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$' AND length(btrim("name")) > 0 AND "version" > 0)
);
CREATE UNIQUE INDEX "wms_warehouses_tenant_id_id_key" ON "wms_warehouses"("tenant_id", "id");
CREATE UNIQUE INDEX "wms_warehouses_tenant_id_code_key" ON "wms_warehouses"("tenant_id", "code");
CREATE INDEX "wms_warehouses_tenant_id_is_active_id_idx" ON "wms_warehouses"("tenant_id", "is_active", "id");

CREATE TABLE "wms_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wms_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wms_locations_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "wms_warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wms_locations_values" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$' AND length(btrim("name")) > 0 AND "version" > 0),
  CONSTRAINT "wms_locations_default" CHECK ("is_default" = ("code" = 'UNASSIGNED') AND (NOT "is_default" OR "is_active"))
);
CREATE UNIQUE INDEX "wms_locations_tenant_id_warehouse_id_id_key" ON "wms_locations"("tenant_id", "warehouse_id", "id");
CREATE UNIQUE INDEX "wms_locations_tenant_id_warehouse_id_code_key" ON "wms_locations"("tenant_id", "warehouse_id", "code");
CREATE INDEX "wms_locations_tenant_id_warehouse_id_is_active_id_idx" ON "wms_locations"("tenant_id", "warehouse_id", "is_active", "id");

CREATE FUNCTION protect_wms_master() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WMS master records must be retained' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['name','is_active','version','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['name','is_active','version','updated_at']) THEN
    RAISE EXCEPTION 'WMS identity and conversion are immutable' USING ERRCODE = '23514';
  END IF;
  IF COALESCE((to_jsonb(OLD)->>'is_base')::boolean, false) OR COALESCE((to_jsonb(OLD)->>'is_default')::boolean, false) THEN
    RAISE EXCEPTION 'WMS system defaults are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_products_guard BEFORE UPDATE OR DELETE ON "wms_products" FOR EACH ROW EXECUTE FUNCTION protect_wms_master();
CREATE TRIGGER wms_product_units_guard BEFORE UPDATE OR DELETE ON "wms_product_units" FOR EACH ROW EXECUTE FUNCTION protect_wms_master();
CREATE TRIGGER wms_warehouses_guard BEFORE UPDATE OR DELETE ON "wms_warehouses" FOR EACH ROW EXECUTE FUNCTION protect_wms_master();
CREATE TRIGGER wms_locations_guard BEFORE UPDATE OR DELETE ON "wms_locations" FOR EACH ROW EXECUTE FUNCTION protect_wms_master();
