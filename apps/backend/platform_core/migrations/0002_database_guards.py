from django.db import migrations


FORWARD = """
CREATE FUNCTION platform_core_validate_store_access() RETURNS trigger AS $$
BEGIN
    IF (SELECT tenant_id FROM platform_core_membership WHERE id = NEW.membership_id)
       IS DISTINCT FROM (SELECT tenant_id FROM platform_core_store WHERE id = NEW.store_id) THEN
        RAISE EXCEPTION 'Cross-tenant store assignment denied' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_core_store_access_guard
BEFORE INSERT OR UPDATE ON platform_core_storeaccess
FOR EACH ROW EXECUTE FUNCTION platform_core_validate_store_access();

CREATE FUNCTION platform_core_immutable_tenant() RETURNS trigger AS $$
BEGIN
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'Tenant ownership cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_core_store_tenant_guard BEFORE UPDATE ON platform_core_store
FOR EACH ROW EXECUTE FUNCTION platform_core_immutable_tenant();
CREATE TRIGGER platform_core_membership_tenant_guard BEFORE UPDATE ON platform_core_membership
FOR EACH ROW EXECUTE FUNCTION platform_core_immutable_tenant();

CREATE FUNCTION platform_core_append_only_audit() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_core_audit_guard BEFORE UPDATE OR DELETE ON platform_core_auditevent
FOR EACH ROW EXECUTE FUNCTION platform_core_append_only_audit();
"""

REVERSE = """
DROP TRIGGER platform_core_audit_guard ON platform_core_auditevent;
DROP FUNCTION platform_core_append_only_audit();
DROP TRIGGER platform_core_membership_tenant_guard ON platform_core_membership;
DROP TRIGGER platform_core_store_tenant_guard ON platform_core_store;
DROP FUNCTION platform_core_immutable_tenant();
DROP TRIGGER platform_core_store_access_guard ON platform_core_storeaccess;
DROP FUNCTION platform_core_validate_store_access();
"""


class Migration(migrations.Migration):
    dependencies = [("platform_core", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
