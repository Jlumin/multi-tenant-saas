CREATE FUNCTION verify_ecom_order_amounts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_order UUID;
  order_total DECIMAL(12,2);
  line_total DECIMAL(12,2);
  line_count BIGINT;
  order_currency CHAR(3);
  store_currency CHAR(3);
BEGIN
  IF TG_TABLE_NAME = 'ecom_orders' THEN target_order := NEW."id";
  ELSE target_order := NEW."order_id";
  END IF;
  SELECT o."total_amount", o."currency", s."currency", COALESCE(SUM(l."line_total"), 0), COUNT(l."id")
    INTO order_total, order_currency, store_currency, line_total, line_count
    FROM "ecom_orders" o
    JOIN "ecom_stores" s ON s."tenant_id" = o."tenant_id" AND s."id" = o."store_id"
    LEFT JOIN "ecom_order_lines" l ON l."tenant_id" = o."tenant_id" AND l."order_id" = o."id"
   WHERE o."id" = target_order
   GROUP BY o."total_amount", o."currency", s."currency";
  IF line_count < 1 OR order_total <> line_total OR order_currency <> store_currency THEN
    RAISE EXCEPTION 'E-Commerce order amounts or currency do not match snapshots' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ecom_orders_amounts_check AFTER INSERT ON "ecom_orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ecom_order_amounts();
CREATE CONSTRAINT TRIGGER ecom_order_lines_amounts_check AFTER INSERT ON "ecom_order_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ecom_order_amounts();

CREATE FUNCTION guard_ecom_order_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ecom_orders" o
     WHERE o."tenant_id" = NEW."tenant_id" AND o."id" = NEW."order_id" AND o."store_id" = NEW."store_id"
       AND o.xmin::text::bigint = MOD(txid_current(), 4294967296)
  ) THEN
    RAISE EXCEPTION 'Order lines must be created with their order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ecom_order_lines_insert_guard BEFORE INSERT ON "ecom_order_lines" FOR EACH ROW EXECUTE FUNCTION guard_ecom_order_line_insert();
