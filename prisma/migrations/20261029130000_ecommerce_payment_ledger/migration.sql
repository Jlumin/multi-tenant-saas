CREATE TYPE "EcomPaymentStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed');
CREATE TYPE "EcomPaymentEventKind" AS ENUM ('processing', 'succeeded', 'failed');

CREATE TABLE "ecom_payment_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider_code" VARCHAR(40) NOT NULL,
  "provider_transaction_id" VARCHAR(160),
  "idempotency_key_hash" CHAR(64) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "EcomPaymentStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecom_payment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_payment_attempts_tenant_id_id_store_id_key" UNIQUE ("tenant_id", "id", "store_id"),
  CONSTRAINT "ecom_payment_attempts_tenant_id_order_id_attempt_number_key" UNIQUE ("tenant_id", "order_id", "attempt_number"),
  CONSTRAINT "ecom_payment_attempts_tenant_id_store_id_idempotency_key_ha_key" UNIQUE ("tenant_id", "store_id", "idempotency_key_hash"),
  CONSTRAINT "ecom_payment_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_payment_attempts_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "ecom_stores"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_payment_attempts_tenant_id_order_id_store_id_fkey" FOREIGN KEY ("tenant_id", "order_id", "store_id") REFERENCES "ecom_orders"("tenant_id", "id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_payment_attempts_attempt_number_check" CHECK ("attempt_number" > 0),
  CONSTRAINT "ecom_payment_attempts_provider_code_check" CHECK ("provider_code" ~ '^[a-z][a-z0-9._-]{0,39}$'),
  CONSTRAINT "ecom_payment_attempts_idempotency_hash_check" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ecom_payment_attempts_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "ecom_payment_attempts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE INDEX "ecom_payment_attempts_tenant_id_store_id_order_id_created_a_idx" ON "ecom_payment_attempts"("tenant_id", "store_id", "order_id", "created_at");
CREATE UNIQUE INDEX "ecom_payment_attempts_tenant_provider_transaction_key" ON "ecom_payment_attempts"("tenant_id", "provider_code", "provider_transaction_id") WHERE "provider_transaction_id" IS NOT NULL;
CREATE UNIQUE INDEX "ecom_payment_attempts_one_success_per_order_key" ON "ecom_payment_attempts"("tenant_id", "order_id") WHERE "status" = 'succeeded';

CREATE TABLE "ecom_payment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "payment_attempt_id" UUID NOT NULL,
  "provider_code" VARCHAR(40) NOT NULL,
  "provider_event_id_hash" CHAR(64) NOT NULL,
  "kind" "EcomPaymentEventKind" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ecom_payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ecom_payment_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_payment_events_tenant_id_payment_attempt_id_store_id_fkey" FOREIGN KEY ("tenant_id", "payment_attempt_id", "store_id") REFERENCES "ecom_payment_attempts"("tenant_id", "id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ecom_payment_events_provider_code_check" CHECK ("provider_code" ~ '^[a-z][a-z0-9._-]{0,39}$'),
  CONSTRAINT "ecom_payment_events_event_hash_check" CHECK ("provider_event_id_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ecom_payment_events_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "ecom_payment_events_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ecom_payment_events_tenant_id_provider_code_provider_event__key" UNIQUE ("tenant_id", "provider_code", "provider_event_id_hash")
);
CREATE INDEX "ecom_payment_events_tenant_id_payment_attempt_id_received_a_idx" ON "ecom_payment_events"("tenant_id", "payment_attempt_id", "received_at");

CREATE FUNCTION guard_ecom_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'E-Commerce payment attempts must be retained' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."store_id" IS DISTINCT FROM OLD."store_id"
     OR NEW."order_id" IS DISTINCT FROM OLD."order_id"
     OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
     OR NEW."provider_code" IS DISTINCT FROM OLD."provider_code"
     OR NEW."idempotency_key_hash" IS DISTINCT FROM OLD."idempotency_key_hash"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'E-Commerce payment attempt identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."provider_transaction_id" IS NOT NULL AND NEW."provider_transaction_id" IS DISTINCT FROM OLD."provider_transaction_id" THEN
    RAISE EXCEPTION 'Provider transaction reference is immutable once assigned' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('processing', 'succeeded', 'failed')) OR
    (OLD."status" = 'processing' AND NEW."status" IN ('succeeded', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Invalid E-Commerce payment state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ecom_payment_attempts_guard" BEFORE UPDATE OR DELETE ON "ecom_payment_attempts" FOR EACH ROW EXECUTE FUNCTION guard_ecom_payment_attempt();

CREATE FUNCTION guard_ecom_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt "ecom_payment_attempts"%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'E-Commerce payment events are append-only' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO attempt FROM "ecom_payment_attempts"
   WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."payment_attempt_id" AND "store_id" = NEW."store_id";
  IF NOT FOUND OR attempt."provider_code" <> NEW."provider_code" OR attempt."amount" <> NEW."amount" OR attempt."currency" <> NEW."currency" THEN
    RAISE EXCEPTION 'Payment event does not match its attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ecom_payment_events_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ecom_payment_events" FOR EACH ROW EXECUTE FUNCTION guard_ecom_payment_event();

CREATE FUNCTION verify_ecom_payment_amounts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_attempt UUID;
BEGIN
  target_attempt := NEW."id";
  IF NOT EXISTS (
    SELECT 1 FROM "ecom_payment_attempts" p
    JOIN "ecom_orders" o ON o."tenant_id" = p."tenant_id" AND o."id" = p."order_id" AND o."store_id" = p."store_id"
    WHERE p."id" = target_attempt AND p."tenant_id" = o."tenant_id" AND p."amount" = o."total_amount" AND p."currency" = o."currency"
  ) THEN
    RAISE EXCEPTION 'Payment attempt amount or currency does not match the order snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ecom_payment_attempts_order_snapshot_check" AFTER INSERT ON "ecom_payment_attempts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ecom_payment_amounts();
