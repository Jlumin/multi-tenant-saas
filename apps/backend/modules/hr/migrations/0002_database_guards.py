from django.db import migrations


FORWARD_SQL = r"""
CREATE FUNCTION hr_guard_employee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HR employee records are retained'; END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code) THEN
    RAISE EXCEPTION 'HR employee tenant and code are immutable';
  END IF;
  IF NEW.membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform_core_membership m JOIN auth_user u ON u.id=m.user_id
    WHERE m.id=NEW.membership_id AND m.tenant_id=NEW.tenant_id AND m.is_active AND u.is_active
  ) THEN RAISE EXCEPTION 'HR employee account must be active in the same tenant'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_employee_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_employee
FOR EACH ROW EXECUTE FUNCTION hr_guard_employee();

CREATE FUNCTION hr_guard_shift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HR shifts are retained'; END IF;
  IF TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.code<>OLD.code OR
      NEW.start_time<>OLD.start_time OR NEW.end_time<>OLD.end_time OR NEW.timezone_name<>OLD.timezone_name) THEN
    RAISE EXCEPTION 'HR shift identity and scheduled times are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_shift_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_shift
FOR EACH ROW EXECUTE FUNCTION hr_guard_shift();

CREATE FUNCTION hr_guard_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'HR shift assignments are immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hr_employee e JOIN hr_shift s ON s.id=NEW.shift_id AND s.tenant_id=NEW.tenant_id
    JOIN platform_core_membership m ON m.id=NEW.created_by_membership_id AND m.tenant_id=NEW.tenant_id
    JOIN auth_user u ON u.id=m.user_id
    WHERE e.id=NEW.employee_id AND e.tenant_id=NEW.tenant_id AND e.is_active AND e.membership_id IS NOT NULL
      AND s.is_active AND m.is_active AND u.is_active AND m.role='admin'
  ) THEN RAISE EXCEPTION 'HR assignment references must be active and share tenant'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_shiftassignment
FOR EACH ROW EXECUTE FUNCTION hr_guard_assignment();

CREATE FUNCTION hr_guard_attendance_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HR attendance records are retained'; END IF;
  IF current_setting('hr.allow_record_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'HR attendance records may only be changed by attendance services';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hr_shiftassignment a WHERE a.id=NEW.assignment_id AND a.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'HR attendance assignment must share tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_attendance_record_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_attendancerecord
FOR EACH ROW EXECUTE FUNCTION hr_guard_attendance_record();

CREATE FUNCTION hr_guard_attendance_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'HR attendance events are append-only'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hr_shiftassignment a JOIN hr_employee e ON e.id=NEW.employee_id AND e.tenant_id=NEW.tenant_id
    JOIN platform_core_membership m ON m.id=NEW.recorded_by_membership_id AND m.tenant_id=NEW.tenant_id
    WHERE a.id=NEW.assignment_id AND a.employee_id=NEW.employee_id AND a.tenant_id=NEW.tenant_id AND m.is_active
  ) THEN RAISE EXCEPTION 'HR attendance event references must share tenant'; END IF;
  IF NEW.correction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hr_correctionrequest c WHERE c.id=NEW.correction_id AND c.tenant_id=NEW.tenant_id
      AND c.assignment_id=NEW.assignment_id AND c.employee_id=NEW.employee_id
      AND c.status='pending' AND c.proposed_at=NEW.occurred_at
      AND ((c.field='clock_in' AND NEW.kind='correction_in') OR (c.field='clock_out' AND NEW.kind='correction_out'))
  ) THEN RAISE EXCEPTION 'HR correction event must match its pending request'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_attendance_event_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_attendanceevent
FOR EACH ROW EXECUTE FUNCTION hr_guard_attendance_event();

CREATE FUNCTION hr_guard_correction_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'HR correction requests are retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM hr_shiftassignment a JOIN hr_employee e ON e.id=NEW.employee_id AND e.tenant_id=NEW.tenant_id
      JOIN platform_core_membership m ON m.id=NEW.requested_by_membership_id AND m.tenant_id=NEW.tenant_id
      WHERE a.id=NEW.assignment_id AND a.employee_id=NEW.employee_id AND a.tenant_id=NEW.tenant_id AND e.is_active AND m.is_active
    ) THEN RAISE EXCEPTION 'HR correction request references must share tenant'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR
      NEW.tenant_id<>OLD.tenant_id OR NEW.assignment_id<>OLD.assignment_id OR NEW.employee_id<>OLD.employee_id OR
      NEW.field<>OLD.field OR NEW.proposed_at<>OLD.proposed_at OR NEW.reason<>OLD.reason OR
      NEW.requested_by_membership_id<>OLD.requested_by_membership_id THEN
    RAISE EXCEPTION 'HR correction request payload is immutable';
  END IF;
  IF NEW.reviewed_by_membership_id IS NULL OR NEW.reviewed_at IS NULL OR NOT EXISTS (
    SELECT 1 FROM platform_core_membership reviewer JOIN auth_user ru ON ru.id=reviewer.user_id
    JOIN platform_core_membership requester ON requester.id=NEW.requested_by_membership_id
    WHERE reviewer.id=NEW.reviewed_by_membership_id AND reviewer.tenant_id=NEW.tenant_id
      AND reviewer.role='admin' AND reviewer.is_active AND ru.is_active AND reviewer.user_id<>requester.user_id
  ) THEN RAISE EXCEPTION 'HR correction decision requires a different active tenant administrator'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_correction_request_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_correctionrequest
FOR EACH ROW EXECUTE FUNCTION hr_guard_correction_request();

CREATE FUNCTION hr_check_correction_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved','rejected') AND (
    NEW.reviewed_by_membership_id IS NULL OR NEW.reviewed_at IS NULL OR
    (NEW.status='approved' AND NOT EXISTS (
      SELECT 1 FROM hr_attendanceevent ev JOIN hr_attendancerecord r ON r.assignment_id=NEW.assignment_id
      WHERE ev.correction_id=NEW.id AND ev.tenant_id=NEW.tenant_id
        AND ev.occurred_at=NEW.proposed_at
        AND ((NEW.field='clock_in' AND ev.kind='correction_in' AND r.clock_in_at=NEW.proposed_at) OR
             (NEW.field='clock_out' AND ev.kind='correction_out' AND r.clock_out_at=NEW.proposed_at))
    ))
  ) THEN RAISE EXCEPTION 'HR correction decision requires reviewer and approved event'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER hr_correction_complete AFTER INSERT OR UPDATE ON hr_correctionrequest
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_check_correction_complete();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS hr_correction_complete ON hr_correctionrequest;
DROP FUNCTION IF EXISTS hr_check_correction_complete();
DROP TRIGGER IF EXISTS hr_correction_request_guard ON hr_correctionrequest;
DROP FUNCTION IF EXISTS hr_guard_correction_request();
DROP TRIGGER IF EXISTS hr_attendance_event_guard ON hr_attendanceevent;
DROP FUNCTION IF EXISTS hr_guard_attendance_event();
DROP TRIGGER IF EXISTS hr_attendance_record_guard ON hr_attendancerecord;
DROP FUNCTION IF EXISTS hr_guard_attendance_record();
DROP TRIGGER IF EXISTS hr_assignment_guard ON hr_shiftassignment;
DROP FUNCTION IF EXISTS hr_guard_assignment();
DROP TRIGGER IF EXISTS hr_shift_guard ON hr_shift;
DROP FUNCTION IF EXISTS hr_guard_shift();
DROP TRIGGER IF EXISTS hr_employee_guard ON hr_employee;
DROP FUNCTION IF EXISTS hr_guard_employee();
"""


class Migration(migrations.Migration):
    dependencies = [("hr", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
