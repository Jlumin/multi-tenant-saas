from django.db import migrations


FORWARD_SQL = r"""
CREATE FUNCTION crm_guard_customer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CRM customers are retained; deactivate instead'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.code <> OLD.code) THEN
    RAISE EXCEPTION 'CRM customer tenant and code are immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_core_tenant t WHERE t.id = NEW.tenant_id AND t.is_active) THEN
    RAISE EXCEPTION 'CRM customer must belong to an active tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_customer_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customer
FOR EACH ROW EXECUTE FUNCTION crm_guard_customer();

CREATE FUNCTION crm_guard_consent_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'CRM consent events are append-only'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crm_customer c
    JOIN platform_core_membership m ON m.id = NEW.recorded_by_id AND m.tenant_id = NEW.tenant_id
    WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id
      AND c.is_active AND m.is_active
  ) THEN RAISE EXCEPTION 'CRM consent references must share an active tenant membership'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_consent_event_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_consentevent
FOR EACH ROW EXECUTE FUNCTION crm_guard_consent_event();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS crm_consent_event_guard ON crm_consentevent;
DROP FUNCTION IF EXISTS crm_guard_consent_event();
DROP TRIGGER IF EXISTS crm_customer_guard ON crm_customer;
DROP FUNCTION IF EXISTS crm_guard_customer();
"""


class Migration(migrations.Migration):
    dependencies = [("crm", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
