from django.db import migrations


FORWARD_SQL = r"""
CREATE FUNCTION rest_guard_table() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Restaurant tables are retained'; END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.store_id<>OLD.store_id OR NEW.code<>OLD.code) THEN
    RAISE EXCEPTION 'Restaurant table tenant, store, and code are immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_core_store s WHERE s.id=NEW.store_id AND s.tenant_id=NEW.tenant_id AND s.is_active)
    THEN RAISE EXCEPTION 'Restaurant table must reference an active store in its tenant'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_table_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_table
FOR EACH ROW EXECUTE FUNCTION rest_guard_table();

CREATE FUNCTION rest_guard_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Restaurant menu categories are retained'; END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code) THEN
    RAISE EXCEPTION 'Restaurant category tenant and code are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_category_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_menucategory
FOR EACH ROW EXECUTE FUNCTION rest_guard_category();

CREATE FUNCTION rest_guard_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Restaurant menu items are retained'; END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code) THEN
    RAISE EXCEPTION 'Restaurant item tenant and code are immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM restaurant_menucategory c WHERE c.id=NEW.category_id AND c.tenant_id=NEW.tenant_id)
    THEN RAISE EXCEPTION 'Restaurant item category must belong to the same tenant'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_item_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_menuitem
FOR EACH ROW EXECUTE FUNCTION rest_guard_item();

CREATE FUNCTION rest_guard_shift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Restaurant POS shifts are retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM platform_core_store s WHERE s.id=NEW.store_id AND s.tenant_id=NEW.tenant_id AND s.is_active)
      OR NOT EXISTS (SELECT 1 FROM platform_core_membership m JOIN auth_user u ON u.id=m.user_id
        WHERE m.id=NEW.opened_by_membership_id AND m.tenant_id=NEW.tenant_id AND m.is_active AND u.is_active AND m.role IN ('admin','manager'))
      THEN RAISE EXCEPTION 'Restaurant shift opener and store must be active in tenant'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.closed_at IS NOT NULL OR NEW.tenant_id<>OLD.tenant_id OR NEW.store_id<>OLD.store_id OR
      NEW.opened_by_membership_id<>OLD.opened_by_membership_id OR NEW.opening_float<>OLD.opening_float OR
      NEW.opened_at<>OLD.opened_at OR NEW.closed_at IS NULL OR NEW.closing_cash IS NULL OR NEW.cash_variance IS NULL OR
      NOT EXISTS (SELECT 1 FROM platform_core_membership m JOIN auth_user u ON u.id=m.user_id
        WHERE m.id=NEW.closed_by_membership_id AND m.tenant_id=NEW.tenant_id AND m.is_active AND u.is_active AND m.role IN ('admin','manager')) THEN
    RAISE EXCEPTION 'Restaurant POS shift permits one valid close transition only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_shift_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_posshift
FOR EACH ROW EXECUTE FUNCTION rest_guard_shift();

CREATE FUNCTION rest_guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Restaurant orders are retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM platform_core_store s WHERE s.id=NEW.store_id AND s.tenant_id=NEW.tenant_id AND s.is_active)
      OR (NEW.table_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM restaurant_table t WHERE t.id=NEW.table_id AND t.tenant_id=NEW.tenant_id AND t.store_id=NEW.store_id AND t.is_active))
      OR (NEW.source='qr' AND (NEW.table_id IS NULL OR NEW.created_by_membership_id IS NOT NULL))
      OR (NEW.source='pos' AND NOT EXISTS (SELECT 1 FROM platform_core_membership m JOIN auth_user u ON u.id=m.user_id
        WHERE m.id=NEW.created_by_membership_id AND m.tenant_id=NEW.tenant_id AND m.is_active AND u.is_active)) THEN
      RAISE EXCEPTION 'Restaurant order table, store, and source must be valid in tenant';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.store_id<>OLD.store_id OR NEW.table_id IS DISTINCT FROM OLD.table_id OR
      NEW.source<>OLD.source OR NEW.order_code<>OLD.order_code OR NEW.currency<>OLD.currency OR NEW.total_amount<>OLD.total_amount OR
      NEW.note<>OLD.note OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.payload_digest<>OLD.payload_digest OR
      NEW.created_by_membership_id IS DISTINCT FROM OLD.created_by_membership_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Restaurant order identity and amounts are immutable';
  END IF;
  IF NEW.status<>OLD.status AND NOT (
      (OLD.status='placed' AND NEW.status IN ('accepted','cancelled')) OR
      (OLD.status='accepted' AND NEW.status IN ('preparing','cancelled')) OR
      (OLD.status='preparing' AND NEW.status='ready') OR (OLD.status='ready' AND NEW.status='served')) THEN
    RAISE EXCEPTION 'Invalid restaurant order status transition';
  END IF;
  IF NEW.payment_status<>OLD.payment_status AND NOT (
      (OLD.payment_status='unpaid' AND NEW.payment_status='paid') OR
      (OLD.payment_status='paid' AND NEW.payment_status IN ('partially_refunded','refunded')) OR
      (OLD.payment_status='partially_refunded' AND NEW.payment_status='refunded')) THEN
    RAISE EXCEPTION 'Invalid restaurant payment status transition';
  END IF;
  IF NEW.payment_status<>OLD.payment_status THEN
    IF (SELECT COALESCE(SUM(amount),0) FROM restaurant_paymentevent WHERE order_id=NEW.id AND kind='cash_received') <> NEW.total_amount THEN
      RAISE EXCEPTION 'Restaurant order payment must match its cash receipt';
    END IF;
    IF NEW.payment_status='paid' AND EXISTS (SELECT 1 FROM restaurant_paymentevent WHERE order_id=NEW.id AND kind='cash_refund') THEN
      RAISE EXCEPTION 'Paid status cannot have refunds';
    END IF;
    IF NEW.payment_status='partially_refunded' AND NOT EXISTS (SELECT 1 FROM restaurant_paymentevent WHERE order_id=NEW.id AND kind='cash_refund') THEN
      RAISE EXCEPTION 'Partial refund status requires a refund event';
    END IF;
    IF (NEW.payment_status='refunded' AND (SELECT COALESCE(SUM(amount),0) FROM restaurant_paymentevent WHERE order_id=NEW.id AND kind='cash_refund') <> NEW.total_amount)
      OR (NEW.payment_status='partially_refunded' AND (SELECT COALESCE(SUM(amount),0) FROM restaurant_paymentevent WHERE order_id=NEW.id AND kind='cash_refund') >= NEW.total_amount) THEN
      RAISE EXCEPTION 'Restaurant refund events must match order payment status';
    END IF;
  END IF;
  IF NEW.status='cancelled' AND NEW.payment_status<>'unpaid' THEN RAISE EXCEPTION 'Refund before cancelling a paid order'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_order_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_order
FOR EACH ROW EXECUTE FUNCTION rest_guard_order();

CREATE FUNCTION rest_guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Restaurant order lines are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM restaurant_order o JOIN restaurant_menuitem i ON i.id=NEW.menu_item_id
    WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND i.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'Restaurant order line references must share tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_line_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_orderline
FOR EACH ROW EXECUTE FUNCTION rest_guard_line();

CREATE FUNCTION rest_guard_order_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Restaurant order events are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM restaurant_order o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id)
    OR (NEW.actor_membership_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform_core_membership m WHERE m.id=NEW.actor_membership_id AND m.tenant_id=NEW.tenant_id AND m.is_active)) THEN
    RAISE EXCEPTION 'Restaurant order event references must share tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_order_event_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_orderevent
FOR EACH ROW EXECUTE FUNCTION rest_guard_order_event();

CREATE FUNCTION rest_guard_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Restaurant payment events are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM restaurant_order o JOIN restaurant_posshift s ON s.id=NEW.shift_id
    JOIN platform_core_membership m ON m.id=NEW.actor_membership_id JOIN auth_user u ON u.id=m.user_id
    WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND o.store_id=s.store_id AND o.tenant_id=s.tenant_id
      AND s.closed_at IS NULL AND m.tenant_id=NEW.tenant_id AND m.is_active AND u.is_active) THEN
    RAISE EXCEPTION 'Restaurant payment event requires an active order, shift, and tenant member';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rest_payment_event_guard BEFORE INSERT OR UPDATE OR DELETE ON restaurant_paymentevent
FOR EACH ROW EXECUTE FUNCTION rest_guard_payment_event();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS rest_payment_event_guard ON restaurant_paymentevent; DROP FUNCTION IF EXISTS rest_guard_payment_event();
DROP TRIGGER IF EXISTS rest_order_event_guard ON restaurant_orderevent; DROP FUNCTION IF EXISTS rest_guard_order_event();
DROP TRIGGER IF EXISTS rest_line_guard ON restaurant_orderline; DROP FUNCTION IF EXISTS rest_guard_line();
DROP TRIGGER IF EXISTS rest_order_guard ON restaurant_order; DROP FUNCTION IF EXISTS rest_guard_order();
DROP TRIGGER IF EXISTS rest_shift_guard ON restaurant_posshift; DROP FUNCTION IF EXISTS rest_guard_shift();
DROP TRIGGER IF EXISTS rest_item_guard ON restaurant_menuitem; DROP FUNCTION IF EXISTS rest_guard_item();
DROP TRIGGER IF EXISTS rest_category_guard ON restaurant_menucategory; DROP FUNCTION IF EXISTS rest_guard_category();
DROP TRIGGER IF EXISTS rest_table_guard ON restaurant_table; DROP FUNCTION IF EXISTS rest_guard_table();
"""


class Migration(migrations.Migration):
    dependencies = [("restaurant", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
