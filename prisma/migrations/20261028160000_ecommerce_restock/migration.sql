CREATE TYPE "EcomRestockSubscriptionStatus" AS ENUM ('active', 'notifying', 'notified', 'unsubscribed');

CREATE TABLE "ecom_restock_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "email_hash" CHAR(64) NOT NULL,
  "unsubscribe_token_hash" CHAR(64) NOT NULL,
  "status" "EcomRestockSubscriptionStatus" NOT NULL DEFAULT 'active',
  "notification_attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notified_at" TIMESTAMPTZ(3),
  CONSTRAINT "ecom_restock_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_restock_subscriptions_email_hash_check" CHECK ("email_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ecom_restock_subscriptions_unsubscribe_hash_check" CHECK ("unsubscribe_token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ecom_restock_subscriptions_attempts_check" CHECK ("notification_attempts" >= 0),
  CONSTRAINT "ecom_restock_subscriptions_tenant_id_store_id_product_id_em_key" UNIQUE ("tenant_id", "store_id", "product_id", "email_hash"),
  CONSTRAINT "ecom_restock_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_restock_subscriptions_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "ecom_stores"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_restock_subscriptions_tenant_id_store_id_product_id_fkey" FOREIGN KEY ("tenant_id", "store_id", "product_id") REFERENCES "ecom_products"("tenant_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ecom_restock_subscriptions_tenant_id_store_id_product_id_st_idx" ON "ecom_restock_subscriptions"("tenant_id", "store_id", "product_id", "status");
