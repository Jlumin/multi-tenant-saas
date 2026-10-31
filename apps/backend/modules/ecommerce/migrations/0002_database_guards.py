from django.db import migrations


FORWARD_SQL = r"""
CREATE FUNCTION ecom_guard_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'E-Commerce listings are retained'; END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.product_id<>OLD.product_id OR NEW.warehouse_id<>OLD.warehouse_id OR NEW.product_code<>OLD.product_code) THEN
    RAISE EXCEPTION 'E-Commerce listing identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ecom_listing_guard BEFORE INSERT OR UPDATE OR DELETE ON ecommerce_listing
FOR EACH ROW EXECUTE FUNCTION ecom_guard_listing();

CREATE FUNCTION ecom_guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'E-Commerce orders are retained'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'pending_payment' OR NEW.status NOT IN ('paid','canceled') OR
       NEW.tenant_id<>OLD.tenant_id OR NEW.customer_id<>OLD.customer_id OR NEW.customer_name<>OLD.customer_name OR
       NEW.customer_email<>OLD.customer_email OR NEW.order_code<>OLD.order_code OR NEW.idempotency_key<>OLD.idempotency_key OR
       NEW.payload_digest<>OLD.payload_digest OR NEW.currency<>OLD.currency OR NEW.total_amount<>OLD.total_amount OR
       NEW.created_by_id<>OLD.created_by_id THEN RAISE EXCEPTION 'E-Commerce order snapshot is immutable'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_core_membership m WHERE m.id=NEW.created_by_id AND m.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'E-Commerce order actor must share tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ecom_order_guard BEFORE INSERT OR UPDATE OR DELETE ON ecommerce_order
FOR EACH ROW EXECUTE FUNCTION ecom_guard_order();

CREATE FUNCTION ecom_guard_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'E-Commerce order lines are immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ecommerce_order o JOIN ecommerce_listing l ON l.id=NEW.listing_id AND l.tenant_id=NEW.tenant_id
    WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND o.status='pending_payment'
      AND l.product_id=NEW.product_id AND l.warehouse_id=NEW.warehouse_id
      AND l.product_code=NEW.product_code
  ) THEN RAISE EXCEPTION 'E-Commerce order line scope does not match order/listing'; END IF;
  IF NEW.line_total<>NEW.unit_price*NEW.quantity THEN RAISE EXCEPTION 'E-Commerce order line total is invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ecom_order_line_guard BEFORE INSERT OR UPDATE OR DELETE ON ecommerce_orderline
FOR EACH ROW EXECUTE FUNCTION ecom_guard_order_line();

CREATE FUNCTION ecom_guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'E-Commerce payments are retained'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'pending' OR NEW.status<>'captured' OR NEW.captured_at IS NULL OR
       NEW.tenant_id<>OLD.tenant_id OR NEW.order_id<>OLD.order_id OR NEW.provider<>OLD.provider OR
       NEW.amount<>OLD.amount OR NEW.currency<>OLD.currency OR NEW.idempotency_key<>OLD.idempotency_key THEN
      RAISE EXCEPTION 'E-Commerce payment is immutable except sandbox capture';
    END IF;
  END IF;
  IF NEW.provider<>'sandbox' OR NOT EXISTS (
    SELECT 1 FROM ecommerce_order o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id
      AND o.total_amount=NEW.amount AND o.currency=NEW.currency
  ) THEN RAISE EXCEPTION 'E-Commerce payment must match its sandbox order'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ecom_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON ecommerce_payment
FOR EACH ROW EXECUTE FUNCTION ecom_guard_payment();

CREATE FUNCTION ecom_check_order_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status varchar(20);
        current_total numeric(14,2);
        current_currency varchar(3);
        current_tenant uuid;
BEGIN
  SELECT status,total_amount,currency,tenant_id INTO current_status,current_total,current_currency,current_tenant
    FROM ecommerce_order WHERE id=NEW.id;
  IF (SELECT COUNT(*) FROM ecommerce_orderline l WHERE l.order_id=NEW.id)=0 OR
     COALESCE((SELECT SUM(l.line_total) FROM ecommerce_orderline l WHERE l.order_id=NEW.id),0)<>current_total OR
     NOT EXISTS (SELECT 1 FROM ecommerce_payment p WHERE p.order_id=NEW.id AND p.tenant_id=current_tenant
       AND p.amount=current_total AND p.currency=current_currency
       AND ((current_status='paid' AND p.status='captured' AND p.captured_at IS NOT NULL) OR
            (current_status IN ('pending_payment','canceled') AND p.status='pending' AND p.captured_at IS NULL))) THEN
    RAISE EXCEPTION 'E-Commerce order requires matching immutable lines and payment';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ecom_order_complete AFTER INSERT OR UPDATE ON ecommerce_order
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ecom_check_order_complete();

CREATE FUNCTION ecom_check_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status varchar(20);
        current_payment_status varchar(10);
        current_captured_at timestamptz;
        current_order_id uuid;
        current_tenant_id uuid;
BEGIN
  SELECT status,captured_at,order_id,tenant_id INTO current_payment_status,current_captured_at,current_order_id,current_tenant_id
    FROM ecommerce_payment WHERE id=NEW.id;
  SELECT status INTO current_status FROM ecommerce_order WHERE id=current_order_id AND tenant_id=current_tenant_id;
  IF NOT FOUND OR
     (current_status='paid' AND (current_payment_status<>'captured' OR current_captured_at IS NULL)) OR
     (current_status IN ('pending_payment','canceled') AND (current_payment_status<>'pending' OR current_captured_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'E-Commerce payment state must match order state';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ecom_payment_order_consistency AFTER INSERT OR UPDATE ON ecommerce_payment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ecom_check_payment_order();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS ecom_order_complete ON ecommerce_order;
DROP FUNCTION IF EXISTS ecom_check_order_complete();
DROP TRIGGER IF EXISTS ecom_payment_order_consistency ON ecommerce_payment;
DROP FUNCTION IF EXISTS ecom_check_payment_order();
DROP TRIGGER IF EXISTS ecom_payment_guard ON ecommerce_payment;
DROP FUNCTION IF EXISTS ecom_guard_payment();
DROP TRIGGER IF EXISTS ecom_order_line_guard ON ecommerce_orderline;
DROP FUNCTION IF EXISTS ecom_guard_order_line();
DROP TRIGGER IF EXISTS ecom_order_guard ON ecommerce_order;
DROP FUNCTION IF EXISTS ecom_guard_order();
DROP TRIGGER IF EXISTS ecom_listing_guard ON ecommerce_listing;
DROP FUNCTION IF EXISTS ecom_guard_listing();
"""


class Migration(migrations.Migration):
    dependencies = [("ecommerce", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
