CREATE TABLE "ecom_stores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(64) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecom_stores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_stores_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "ecom_stores_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "ecom_stores_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ecom_stores_version_check" CHECK ("version" > 0),
  CONSTRAINT "ecom_stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ecom_stores_tenant_id_key" ON "ecom_stores"("tenant_id");
CREATE UNIQUE INDEX "ecom_stores_slug_key" ON "ecom_stores"("slug");
CREATE UNIQUE INDEX "ecom_stores_tenant_id_id_key" ON "ecom_stores"("tenant_id", "id");

CREATE TABLE "ecom_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000) NOT NULL DEFAULT '',
  "price" DECIMAL(12,2) NOT NULL,
  "is_published" BOOLEAN NOT NULL DEFAULT FALSE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecom_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_products_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  CONSTRAINT "ecom_products_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "ecom_products_price_check" CHECK ("price" >= 0),
  CONSTRAINT "ecom_products_version_check" CHECK ("version" > 0),
  CONSTRAINT "ecom_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_products_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "ecom_stores"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_products_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ecom_products_tenant_id_store_id_id_key" ON "ecom_products"("tenant_id", "store_id", "id");
CREATE UNIQUE INDEX "ecom_products_tenant_id_store_id_code_key" ON "ecom_products"("tenant_id", "store_id", "code");
CREATE INDEX "ecom_products_tenant_id_store_id_is_published_created_at_id_idx" ON "ecom_products"("tenant_id", "store_id", "is_published", "created_at", "id");

CREATE FUNCTION guard_ecom_store() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'E-Commerce stores must be retained' USING ERRCODE = '23514'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."slug" IS DISTINCT FROM OLD."slug" THEN
    RAISE EXCEPTION 'E-Commerce store identity and public slug are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'Store version must advance one step' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ecom_stores_guard BEFORE UPDATE OR DELETE ON "ecom_stores" FOR EACH ROW EXECUTE FUNCTION guard_ecom_store();

CREATE FUNCTION guard_ecom_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'E-Commerce products must be retained' USING ERRCODE = '23514'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR NEW."store_id" IS DISTINCT FROM OLD."store_id" OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" THEN
    RAISE EXCEPTION 'E-Commerce product ownership is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'Product version must advance one step' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ecom_products_guard BEFORE UPDATE OR DELETE ON "ecom_products" FOR EACH ROW EXECUTE FUNCTION guard_ecom_product();
