CREATE TYPE "RestaurantOrderStatus" AS ENUM ('pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled');

CREATE TABLE "restaurants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TWD',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurants_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurants_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "restaurants_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "restaurants_version_check" CHECK ("version" > 0),
    CONSTRAINT "restaurants_tenant_id_key" UNIQUE ("tenant_id"),
    CONSTRAINT "restaurants_tenant_id_id_key" UNIQUE ("tenant_id", "id")
);

CREATE TABLE "restaurant_menu_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurant_menu_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_menu_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_categories_tenant_id_restaurant_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id") REFERENCES "restaurants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_categories_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_categories_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "restaurant_menu_categories_version_check" CHECK ("version" > 0),
    CONSTRAINT "restaurant_menu_categories_tenant_id_restaurant_id_id_key" UNIQUE ("tenant_id", "restaurant_id", "id")
);
CREATE INDEX "restaurant_menu_categories_tenant_id_restaurant_id_is_activ_idx" ON "restaurant_menu_categories"("tenant_id", "restaurant_id", "is_active", "sort_order");

CREATE TABLE "restaurant_menu_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "price" DECIMAL(12,2) NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurant_menu_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_menu_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_items_tenant_id_restaurant_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id") REFERENCES "restaurants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_items_tenant_id_restaurant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id", "category_id") REFERENCES "restaurant_menu_categories"("tenant_id", "restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_items_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_menu_items_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "restaurant_menu_items_code_check" CHECK (length(btrim("code")) BETWEEN 1 AND 40),
    CONSTRAINT "restaurant_menu_items_price_check" CHECK ("price" >= 0),
    CONSTRAINT "restaurant_menu_items_version_check" CHECK ("version" > 0),
    CONSTRAINT "restaurant_menu_items_tenant_id_restaurant_id_id_key" UNIQUE ("tenant_id", "restaurant_id", "id"),
    CONSTRAINT "restaurant_menu_items_tenant_id_restaurant_id_code_key" UNIQUE ("tenant_id", "restaurant_id", "code")
);
CREATE INDEX "restaurant_menu_items_tenant_id_restaurant_id_is_published__idx" ON "restaurant_menu_items"("tenant_id", "restaurant_id", "is_published", "created_at");

CREATE TABLE "restaurant_tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "table_number" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "qr_token_hash" CHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_tables_tenant_id_restaurant_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id") REFERENCES "restaurants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_tables_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_tables_number_check" CHECK (length(btrim("table_number")) BETWEEN 1 AND 40),
    CONSTRAINT "restaurant_tables_label_check" CHECK (length(btrim("label")) BETWEEN 1 AND 80),
    CONSTRAINT "restaurant_tables_version_check" CHECK ("version" > 0),
    CONSTRAINT "restaurant_tables_tenant_id_restaurant_id_id_key" UNIQUE ("tenant_id", "restaurant_id", "id"),
    CONSTRAINT "restaurant_tables_tenant_id_restaurant_id_table_number_key" UNIQUE ("tenant_id", "restaurant_id", "table_number"),
    CONSTRAINT "restaurant_tables_qr_token_hash_key" UNIQUE ("qr_token_hash")
);

CREATE TABLE "restaurant_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "order_number" VARCHAR(24) NOT NULL,
    "status" "RestaurantOrderStatus" NOT NULL DEFAULT 'pending',
    "currency" CHAR(3) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_orders_tenant_id_restaurant_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id") REFERENCES "restaurants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_orders_tenant_id_restaurant_id_table_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id", "table_id") REFERENCES "restaurant_tables"("tenant_id", "restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_orders_total_amount_check" CHECK ("total_amount" >= 0),
    CONSTRAINT "restaurant_orders_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "restaurant_orders_tenant_id_restaurant_id_id_key" UNIQUE ("tenant_id", "restaurant_id", "id"),
    CONSTRAINT "restaurant_orders_tenant_id_restaurant_id_order_number_key" UNIQUE ("tenant_id", "restaurant_id", "order_number"),
    CONSTRAINT "restaurant_orders_tenant_id_restaurant_id_idempotency_key_h_key" UNIQUE ("tenant_id", "restaurant_id", "idempotency_key_hash")
);
CREATE INDEX "restaurant_orders_tenant_id_restaurant_id_status_created_at_idx" ON "restaurant_orders"("tenant_id", "restaurant_id", "status", "created_at");

CREATE TABLE "restaurant_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_code" VARCHAR(40) NOT NULL,
    "item_name" VARCHAR(120) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "restaurant_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "restaurant_order_lines_tenant_id_restaurant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id", "order_id") REFERENCES "restaurant_orders"("tenant_id", "restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_order_lines_tenant_id_restaurant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "restaurant_id", "item_id") REFERENCES "restaurant_menu_items"("tenant_id", "restaurant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "restaurant_order_lines_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99),
    CONSTRAINT "restaurant_order_lines_amount_check" CHECK ("unit_price" >= 0 AND "line_total" = "unit_price" * "quantity"),
    CONSTRAINT "restaurant_order_lines_tenant_id_order_id_item_id_key" UNIQUE ("tenant_id", "order_id", "item_id")
);
CREATE INDEX "restaurant_order_lines_tenant_id_restaurant_id_order_id_idx" ON "restaurant_order_lines"("tenant_id", "restaurant_id", "order_id");

CREATE FUNCTION restaurant_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Restaurant orders are append-only' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."id", NEW."tenant_id", NEW."restaurant_id", NEW."table_id", NEW."order_number", NEW."currency", NEW."total_amount", NEW."idempotency_key_hash", NEW."payload_hash", NEW."created_at")
       IS DISTINCT FROM (OLD."id", OLD."tenant_id", OLD."restaurant_id", OLD."table_id", OLD."order_number", OLD."currency", OLD."total_amount", OLD."idempotency_key_hash", OLD."payload_hash", OLD."created_at")
       OR NOT (
          (OLD."status" = 'pending' AND NEW."status" IN ('accepted','cancelled')) OR
          (OLD."status" = 'accepted' AND NEW."status" IN ('preparing','cancelled')) OR
          (OLD."status" = 'preparing' AND NEW."status" = 'ready') OR
          (OLD."status" = 'ready' AND NEW."status" = 'completed')
       ) THEN
        RAISE EXCEPTION 'Invalid Restaurant order transition' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "restaurant_orders_guard_trigger" BEFORE UPDATE OR DELETE ON "restaurant_orders" FOR EACH ROW EXECUTE FUNCTION restaurant_order_guard();

CREATE FUNCTION restaurant_order_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Restaurant order lines are append-only' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "restaurant_order_lines_guard_trigger" BEFORE UPDATE OR DELETE ON "restaurant_order_lines" FOR EACH ROW EXECUTE FUNCTION restaurant_order_lines_guard();

CREATE FUNCTION restaurant_validate_order_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_tenant UUID; target_restaurant UUID; target_order UUID; expected_total DECIMAL(12,2); actual_total DECIMAL(12,2); line_count INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'restaurant_orders' THEN target_tenant := NEW."tenant_id"; target_restaurant := NEW."restaurant_id"; target_order := NEW."id";
    ELSE target_tenant := NEW."tenant_id"; target_restaurant := NEW."restaurant_id"; target_order := NEW."order_id"; END IF;
    SELECT "total_amount" INTO expected_total FROM "restaurant_orders" WHERE "tenant_id"=target_tenant AND "restaurant_id"=target_restaurant AND "id"=target_order;
    SELECT COALESCE(SUM("line_total"),0), COUNT(*) INTO actual_total,line_count FROM "restaurant_order_lines" WHERE "tenant_id"=target_tenant AND "restaurant_id"=target_restaurant AND "order_id"=target_order;
    IF line_count < 1 OR actual_total <> expected_total THEN RAISE EXCEPTION 'Restaurant order total mismatch' USING ERRCODE='check_violation'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "restaurant_orders_total_guard" AFTER INSERT ON "restaurant_orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION restaurant_validate_order_total();
CREATE CONSTRAINT TRIGGER "restaurant_order_lines_total_guard" AFTER INSERT ON "restaurant_order_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION restaurant_validate_order_total();
