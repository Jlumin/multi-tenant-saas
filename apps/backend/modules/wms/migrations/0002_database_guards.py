from django.db import migrations


FORWARD_SQL = r"""
CREATE FUNCTION wms_guard_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'WMS product tenant is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_product_guard BEFORE UPDATE ON wms_product
FOR EACH ROW EXECUTE FUNCTION wms_guard_product();

CREATE FUNCTION wms_guard_package_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS package units are retained'; END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id <> OLD.tenant_id OR NEW.product_id <> OLD.product_id OR
    NEW.code <> OLD.code OR NEW.base_quantity <> OLD.base_quantity OR NEW.is_base <> OLD.is_base
  ) THEN RAISE EXCEPTION 'WMS package conversion identity is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_base AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'The base unit cannot be deactivated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wms_product p WHERE p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'WMS package unit and product must share a tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_package_unit_guard BEFORE INSERT OR UPDATE OR DELETE ON wms_packageunit
FOR EACH ROW EXECUTE FUNCTION wms_guard_package_unit();

CREATE FUNCTION wms_guard_warehouse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'WMS warehouse tenant is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_warehouse_guard BEFORE UPDATE ON wms_warehouse
FOR EACH ROW EXECUTE FUNCTION wms_guard_warehouse();

CREATE FUNCTION wms_guard_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_default THEN RAISE EXCEPTION 'Default location cannot be deleted'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS locations are retained'; END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id <> OLD.tenant_id OR NEW.warehouse_id <> OLD.warehouse_id OR
    NEW.code <> OLD.code OR NEW.is_default <> OLD.is_default
  ) THEN RAISE EXCEPTION 'WMS location identity is immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_default AND NOT NEW.is_active THEN
    RAISE EXCEPTION 'Default location cannot be deactivated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wms_warehouse w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'WMS location and warehouse must share a tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_location_guard BEFORE INSERT OR UPDATE OR DELETE ON wms_location
FOR EACH ROW EXECUTE FUNCTION wms_guard_location();

CREATE FUNCTION wms_guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS documents are retained'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'WMS documents are immutable after posting or cancellation'; END IF;
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.warehouse_id <> OLD.warehouse_id OR
       NEW.kind <> OLD.kind OR NEW.document_code <> OLD.document_code OR
       NEW.idempotency_key <> OLD.idempotency_key OR NEW.payload_digest <> OLD.payload_digest OR
       NEW.created_by_id <> OLD.created_by_id THEN
      RAISE EXCEPTION 'WMS document identity is immutable';
    END IF;
  END IF;
  IF NEW.status NOT IN ('draft', 'posted', 'canceled') THEN RAISE EXCEPTION 'Invalid WMS document status'; END IF;
  IF NOT EXISTS (SELECT 1 FROM wms_warehouse w WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id) OR
     NOT EXISTS (SELECT 1 FROM platform_core_membership m WHERE m.id = NEW.created_by_id AND m.tenant_id = NEW.tenant_id) OR
     (NEW.posted_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform_core_membership m WHERE m.id = NEW.posted_by_id AND m.tenant_id = NEW.tenant_id)) THEN
    RAISE EXCEPTION 'WMS document references must share a tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_document_guard BEFORE INSERT OR UPDATE OR DELETE ON wms_inventorydocument
FOR EACH ROW EXECUTE FUNCTION wms_guard_document();

CREATE FUNCTION wms_check_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'posted' AND (
    NEW.posted_by_id IS NULL OR NEW.posted_at IS NULL OR
    (SELECT COUNT(*) FROM wms_inventorydocumentline l WHERE l.document_id = NEW.id) = 0 OR
    (SELECT COUNT(*) FROM wms_stockmovement m WHERE m.document_id = NEW.id) <>
    (SELECT COUNT(*) FROM wms_inventorydocumentline l WHERE l.document_id = NEW.id) OR
    (SELECT COUNT(*) FROM wms_stockmovement m WHERE m.document_id = NEW.id AND m.created_by_id = NEW.posted_by_id) <>
    (SELECT COUNT(*) FROM wms_inventorydocumentline l WHERE l.document_id = NEW.id) OR
    NOT EXISTS (
      SELECT 1 FROM platform_core_membership m JOIN auth_user u ON u.id = m.user_id
      WHERE m.id = NEW.posted_by_id AND m.tenant_id = NEW.tenant_id
        AND m.role = 'admin' AND m.is_active AND u.is_active
    )
  ) THEN RAISE EXCEPTION 'Posted WMS documents require one movement per line and posting metadata'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER wms_posted_document_complete
AFTER INSERT OR UPDATE ON wms_inventorydocument DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION wms_check_posted_document();

CREATE FUNCTION wms_guard_document_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_id uuid;
BEGIN
  document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'WMS document lines are replaced while the document is draft'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM wms_inventorydocument d WHERE d.id = document_id AND d.status = 'draft') THEN
      RAISE EXCEPTION 'Only draft WMS document lines may be removed';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wms_inventorydocument d
    JOIN wms_warehouse w ON w.id = d.warehouse_id AND w.tenant_id = d.tenant_id
    JOIN wms_product p ON p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id
    JOIN wms_packageunit u ON u.id = NEW.package_unit_id AND u.product_id = p.id AND u.tenant_id = p.tenant_id
    JOIN wms_location l ON l.id = NEW.location_id AND l.warehouse_id = d.warehouse_id AND l.tenant_id = d.tenant_id
    WHERE d.id = NEW.document_id AND d.tenant_id = NEW.tenant_id AND d.status = 'draft'
      AND u.base_quantity = NEW.conversion_snapshot
      AND NEW.base_quantity = NEW.quantity::bigint * NEW.conversion_snapshot
  ) THEN RAISE EXCEPTION 'WMS document line references or quantity snapshot are invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_document_line_guard BEFORE INSERT OR UPDATE OR DELETE ON wms_inventorydocumentline
FOR EACH ROW EXECUTE FUNCTION wms_guard_document_line();

CREATE FUNCTION wms_guard_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'WMS stock movements are append-only'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wms_inventorydocument d
    JOIN wms_inventorydocumentline l ON l.document_id = d.id AND l.id = NEW.line_id
    JOIN wms_product p ON p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id
    JOIN wms_location loc ON loc.id = NEW.location_id AND loc.warehouse_id = NEW.warehouse_id AND loc.tenant_id = NEW.tenant_id
    JOIN platform_core_membership m ON m.id = NEW.created_by_id AND m.tenant_id = NEW.tenant_id
    WHERE d.id = NEW.document_id AND d.tenant_id = NEW.tenant_id AND d.status = 'draft'
      AND d.warehouse_id = NEW.warehouse_id AND l.tenant_id = NEW.tenant_id
      AND l.product_id = NEW.product_id AND l.location_id = NEW.location_id
      AND NEW.quantity_delta = CASE WHEN d.kind = 'receipt' THEN l.base_quantity ELSE -l.base_quantity END
  ) THEN RAISE EXCEPTION 'WMS stock movement does not match a draft document line'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_stock_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON wms_stockmovement
FOR EACH ROW EXECUTE FUNCTION wms_guard_stock_movement();

CREATE FUNCTION wms_guard_stock_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WMS stock balances are retained'; END IF;
  IF current_setting('wms.allow_balance_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'WMS balances may only be changed by the posting service';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wms_product p
    JOIN wms_warehouse w ON w.id = NEW.warehouse_id AND w.tenant_id = p.tenant_id
    JOIN wms_location l ON l.id = NEW.location_id AND l.warehouse_id = w.id AND l.tenant_id = p.tenant_id
    WHERE p.id = NEW.product_id AND p.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'WMS stock balance references must share a tenant and warehouse'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_stock_balance_guard BEFORE INSERT OR UPDATE OR DELETE ON wms_stockbalance
FOR EACH ROW EXECUTE FUNCTION wms_guard_stock_balance();
"""


REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS wms_stock_balance_guard ON wms_stockbalance;
DROP FUNCTION IF EXISTS wms_guard_stock_balance();
DROP TRIGGER IF EXISTS wms_stock_movement_guard ON wms_stockmovement;
DROP FUNCTION IF EXISTS wms_guard_stock_movement();
DROP TRIGGER IF EXISTS wms_document_line_guard ON wms_inventorydocumentline;
DROP FUNCTION IF EXISTS wms_guard_document_line();
DROP TRIGGER IF EXISTS wms_posted_document_complete ON wms_inventorydocument;
DROP FUNCTION IF EXISTS wms_check_posted_document();
DROP TRIGGER IF EXISTS wms_document_guard ON wms_inventorydocument;
DROP FUNCTION IF EXISTS wms_guard_document();
DROP TRIGGER IF EXISTS wms_location_guard ON wms_location;
DROP FUNCTION IF EXISTS wms_guard_location();
DROP TRIGGER IF EXISTS wms_warehouse_guard ON wms_warehouse;
DROP FUNCTION IF EXISTS wms_guard_warehouse();
DROP TRIGGER IF EXISTS wms_package_unit_guard ON wms_packageunit;
DROP FUNCTION IF EXISTS wms_guard_package_unit();
DROP TRIGGER IF EXISTS wms_product_guard ON wms_product;
DROP FUNCTION IF EXISTS wms_guard_product();
"""


class Migration(migrations.Migration):
    dependencies = [("wms", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]

