CREATE TYPE "EcomOrderStatus" AS ENUM ('submitted');

CREATE TABLE "ecom_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "order_number" VARCHAR(32) NOT NULL,
  "status" "EcomOrderStatus" NOT NULL DEFAULT 'submitted',
  "currency" CHAR(3) NOT NULL,
  "buyer_name" VARCHAR(120) NOT NULL,
  "buyer_email" VARCHAR(254) NOT NULL,
  "total_amount" DECIMAL(12,2) NOT NULL,
  "idempotency_key_hash" CHAR(64) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecom_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_orders_name_check" CHECK (length(btrim("buyer_name")) BETWEEN 1 AND 120),
  CONSTRAINT "ecom_orders_email_check" CHECK ("buyer_email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT "ecom_orders_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ecom_orders_total_check" CHECK ("total_amount" >= 0),
  CONSTRAINT "ecom_orders_idempotency_hash_check" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ecom_orders_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ecom_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_orders_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "ecom_stores"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ecom_orders_tenant_id_id_store_id_key" ON "ecom_orders"("tenant_id", "id", "store_id");
CREATE UNIQUE INDEX "ecom_orders_tenant_id_order_number_key" ON "ecom_orders"("tenant_id", "order_number");
CREATE UNIQUE INDEX "ecom_orders_tenant_id_store_id_idempotency_key_hash_key" ON "ecom_orders"("tenant_id", "store_id", "idempotency_key_hash");
CREATE INDEX "ecom_orders_tenant_id_store_id_created_at_id_idx" ON "ecom_orders"("tenant_id", "store_id", "created_at", "id");

CREATE TABLE "ecom_order_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "product_code" VARCHAR(40) NOT NULL,
  "product_name" VARCHAR(120) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "line_total" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "ecom_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_order_lines_code_check" CHECK ("product_code" ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  CONSTRAINT "ecom_order_lines_name_check" CHECK (length(btrim("product_name")) BETWEEN 1 AND 120),
  CONSTRAINT "ecom_order_lines_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99),
  CONSTRAINT "ecom_order_lines_unit_price_check" CHECK ("unit_price" >= 0),
  CONSTRAINT "ecom_order_lines_total_check" CHECK ("line_total" = "unit_price" * "quantity"),
  CONSTRAINT "ecom_order_lines_tenant_id_order_id_store_id_fkey" FOREIGN KEY ("tenant_id", "order_id", "store_id") REFERENCES "ecom_orders"("tenant_id", "id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_order_lines_tenant_id_store_id_product_id_fkey" FOREIGN KEY ("tenant_id", "store_id", "product_id") REFERENCES "ecom_products"("tenant_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ecom_order_lines_tenant_id_order_id_product_id_key" ON "ecom_order_lines"("tenant_id", "order_id", "product_id");
CREATE INDEX "ecom_order_lines_tenant_id_order_id_idx" ON "ecom_order_lines"("tenant_id", "order_id");

CREATE FUNCTION guard_ecom_order_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'E-Commerce orders and snapshots are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ecom_orders_immutable BEFORE UPDATE OR DELETE ON "ecom_orders" FOR EACH ROW EXECUTE FUNCTION guard_ecom_order_immutable();
CREATE TRIGGER ecom_order_lines_immutable BEFORE UPDATE OR DELETE ON "ecom_order_lines" FOR EACH ROW EXECUTE FUNCTION guard_ecom_order_immutable();
