import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.db import IntegrityError, connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from platform_core import application as platform
from platform_core.models import Tenant
from platform_core.services import audit
from .models import AttendanceEvent, AttendanceRecord, CorrectionRequest, Employee, Shift, ShiftAssignment


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "The resource changed; reload and try again."


def _current(request, tenant_id):
    return platform.current_membership(request=request, tenant_id=tenant_id)


def _admin(request, tenant_id):
    member = _current(request, tenant_id)
    if member["role"] != "admin":
        audit(request, "access.denied", target=tenant_id)
        raise PermissionDenied("Tenant administrator role required.")
    return member


def _manager(request, tenant_id):
    member = _current(request, tenant_id)
    if member["role"] == "viewer":
        audit(request, "access.denied", target=tenant_id)
        raise PermissionDenied("A manager or tenant administrator role is required.")
    return member


@transaction.atomic
def create_employee(request, tenant_id, data):
    member = _admin(request, tenant_id)
    if data.get("membership_id"):
        platform.validate_membership_reference(tenant_id=member["tenant_id"], membership_id=data["membership_id"])
    from platform_core.models import Tenant as PlatformTenant
    tenant = PlatformTenant.objects.get(pk=member["tenant_id"])
    try:
        employee = Employee.objects.create(tenant=tenant, **data)
    except IntegrityError as exc:
        raise ValidationError("Employee code or linked account already exists in this tenant.") from exc
    audit(request, "hr.employee.created", tenant=tenant, target=employee.pk)
    return employee


@transaction.atomic
def update_employee(request, tenant_id, employee_id, data):
    member = _admin(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member["tenant_id"])
    employee = get_object_or_404(Employee, tenant=tenant, pk=employee_id)
    if data.pop("version") != employee.version:
        raise Conflict("Employee was changed by someone else. Refresh and retry.")
    if "membership_id" in data and data["membership_id"] is not None:
        platform.validate_membership_reference(tenant_id=tenant.pk, membership_id=data["membership_id"])
    for key, value in data.items():
        setattr(employee, key, value)
    employee.version += 1
    try:
        employee.save()
    except IntegrityError as exc:
        raise ValidationError("Linked account already belongs to another employee.") from exc
    audit(request, "hr.employee.updated", tenant=tenant, target=employee.pk)
    return employee


@transaction.atomic
def create_shift(request, tenant_id, data):
    member = _admin(request, tenant_id)
    tenant = Tenant.objects.get(pk=member["tenant_id"])
    try:
        shift = Shift.objects.create(tenant=tenant, **data)
    except IntegrityError as exc:
        raise ValidationError({"code": "Shift code already exists in this tenant."}) from exc
    audit(request, "hr.shift.created", tenant=tenant, target=shift.pk)
    return shift


def _shift_window(shift, work_date):
    tz = ZoneInfo(shift.timezone_name)
    start = datetime.combine(work_date, shift.start_time).replace(tzinfo=tz)
    end_date = work_date + timedelta(days=1) if shift.spans_midnight else work_date
    end = datetime.combine(end_date, shift.end_time).replace(tzinfo=tz)
    return start.astimezone(dt_timezone.utc), end.astimezone(dt_timezone.utc)


@transaction.atomic
def create_assignment(request, tenant_id, data):
    member = _admin(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member["tenant_id"])
    employee = get_object_or_404(Employee, tenant=tenant, pk=data["employee_id"], is_active=True)
    shift = get_object_or_404(Shift, tenant=tenant, pk=data["shift_id"], is_active=True)
    if employee.membership_id is None:
        raise ValidationError("Assign an active tenant login account before scheduling this employee.")
    platform.validate_membership_reference(tenant_id=tenant.pk, membership_id=employee.membership_id)
    start, end = _shift_window(shift, data["work_date"])
    nearby = ShiftAssignment.objects.filter(
        tenant=tenant, employee=employee,
        work_date__range=(data["work_date"] - timedelta(days=1), data["work_date"] + timedelta(days=1)),
        shift__is_active=True,
    ).select_related("shift")
    for other in nearby:
        other_start, other_end = _shift_window(other.shift, other.work_date)
        if start < other_end and other_start < end:
            raise ValidationError("This assignment overlaps another scheduled shift for the employee.")
    try:
        assignment = ShiftAssignment.objects.create(
            tenant=tenant, employee=employee, shift=shift, work_date=data["work_date"],
            created_by_membership_id=member["id"],
        )
    except IntegrityError as exc:
        raise ValidationError("Assignment already exists for this employee and shift date.") from exc
    audit(request, "hr.shift_assignment.created", tenant=tenant, target=assignment.pk)
    return assignment


def visible_assignments(request, tenant_id):
    member = _current(request, tenant_id)
    queryset = ShiftAssignment.objects.filter(tenant_id=member["tenant_id"]).select_related("employee", "shift").prefetch_related("attendance")
    if member["role"] == "viewer":
        queryset = queryset.filter(employee__membership_id=member["id"], employee__is_active=True)
    return queryset.order_by("-work_date", "employee__code", "id")


def _punch_digest(assignment_id, kind):
    payload = {"assignment_id": str(assignment_id), "kind": kind}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@transaction.atomic
def record_punch(request, tenant_id, assignment_id, kind, idempotency_key):
    member = _current(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member["tenant_id"], is_active=True)
    assignment = get_object_or_404(
        ShiftAssignment.objects.select_for_update().select_related("employee", "shift"),
        tenant=tenant, pk=assignment_id,
    )
    self_punch = assignment.employee.membership_id == member["id"]
    if not self_punch and member["role"] not in ("admin", "manager"):
        audit(request, "access.denied", tenant=tenant, target=assignment.pk)
        raise PermissionDenied("You can only record your own attendance.")
    if not assignment.employee.is_active or not assignment.shift.is_active:
        raise ValidationError("Inactive employee or shift cannot be punched.")
    digest = _punch_digest(assignment.pk, kind)
    existing = AttendanceEvent.objects.filter(tenant=tenant, idempotency_key=idempotency_key).first()
    if existing:
        if existing.payload_digest != digest:
            raise Conflict("Idempotency key was used for a different punch.")
        return existing, AttendanceRecord.objects.get(assignment=assignment)
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('hr.allow_record_write', 'on', true)")
    record, _ = AttendanceRecord.objects.get_or_create(tenant=tenant, assignment=assignment)
    now = timezone.now()
    if kind == AttendanceEvent.Kind.CLOCK_IN:
        if record.clock_in_at is not None:
            raise Conflict("Clock-in is already recorded. Use the correction workflow if it is wrong.")
        record.clock_in_at = now
    elif kind == AttendanceEvent.Kind.CLOCK_OUT:
        if record.clock_in_at is None:
            raise ValidationError("Clock-in is required before clock-out.")
        if record.clock_out_at is not None:
            raise Conflict("Clock-out is already recorded. Use the correction workflow if it is wrong.")
        if now < record.clock_in_at:
            raise ValidationError("Clock-out cannot precede clock-in.")
        record.clock_out_at = now
    else:
        raise ValidationError("Invalid attendance event type.")
    record.version += 1
    record.save()
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('hr.allow_record_write', 'off', true)")
    event = AttendanceEvent.objects.create(
        tenant=tenant, assignment=assignment, employee=assignment.employee, kind=kind,
        occurred_at=now, idempotency_key=idempotency_key, payload_digest=digest,
        recorded_by_membership_id=member["id"],
    )
    audit(request, f"hr.attendance.{kind}", tenant=tenant, target=event.pk)
    return event, record


@transaction.atomic
def create_correction(request, tenant_id, data):
    member = _current(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member["tenant_id"], is_active=True)
    assignment = get_object_or_404(ShiftAssignment.objects.select_related("employee"), tenant=tenant, pk=data["assignment_id"])
    is_self = assignment.employee.membership_id == member["id"]
    if member["role"] == "viewer" and not is_self:
        raise PermissionDenied("You can only request correction for your own attendance.")
    if data["proposed_at"] > timezone.now():
        raise ValidationError({"proposed_at": "Correction time cannot be in the future."})
    pending = CorrectionRequest.objects.filter(
        tenant=tenant, assignment=assignment, field=data["field"], status=CorrectionRequest.Status.PENDING,
    ).exists()
    if pending:
        raise Conflict("A correction for this punch is already awaiting review.")
    correction = CorrectionRequest.objects.create(
        tenant=tenant, assignment=assignment, employee=assignment.employee,
        field=data["field"], proposed_at=data["proposed_at"], reason=data["reason"],
        requested_by_membership_id=member["id"],
    )
    audit(request, "hr.attendance_correction.requested", tenant=tenant, target=correction.pk)
    return correction


def visible_corrections(request, tenant_id):
    member = _current(request, tenant_id)
    queryset = CorrectionRequest.objects.filter(tenant_id=member["tenant_id"]).select_related("employee", "assignment")
    if member["role"] == "viewer":
        queryset = queryset.filter(employee__membership_id=member["id"])
    return queryset


@transaction.atomic
def decide_correction(request, tenant_id, correction_id, *, approve, decision_note=""):
    member = _admin(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member["tenant_id"], is_active=True)
    correction = get_object_or_404(
        CorrectionRequest.objects.select_for_update().select_related("assignment", "employee"),
        tenant=tenant, pk=correction_id,
    )
    desired = CorrectionRequest.Status.APPROVED if approve else CorrectionRequest.Status.REJECTED
    if correction.status == desired:
        return correction
    if correction.status != CorrectionRequest.Status.PENDING:
        raise Conflict("This correction request has already been decided.")
    requester = platform.validate_membership_reference(tenant_id=tenant.pk, membership_id=correction.requested_by_membership_id)
    if requester["user_id"] == member["user_id"]:
        raise PermissionDenied("The requester cannot approve their own correction.")
    if approve:
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('hr.allow_record_write', 'on', true)")
        record, _ = AttendanceRecord.objects.get_or_create(tenant=tenant, assignment=correction.assignment)
        field = "clock_in_at" if correction.field == CorrectionRequest.Field.CLOCK_IN else "clock_out_at"
        other = record.clock_out_at if field == "clock_in_at" else record.clock_in_at
        if field == "clock_out_at" and other is None:
            raise ValidationError("A corrected clock-out requires a clock-in record.")
        if field == "clock_in_at" and other and correction.proposed_at > other:
            raise ValidationError("Corrected clock-in must be at or before clock-out.")
        if field == "clock_out_at" and other and correction.proposed_at < other:
            raise ValidationError("Corrected clock-out must be at or after clock-in.")
        setattr(record, field, correction.proposed_at)
        record.version += 1
        record.save()
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('hr.allow_record_write', 'off', true)")
        event_kind = AttendanceEvent.Kind.CORRECTION_IN if field == "clock_in_at" else AttendanceEvent.Kind.CORRECTION_OUT
        key = uuid.uuid5(uuid.NAMESPACE_URL, f"sme-cloud:hr:correction:{correction.pk}")
        payload = f"{correction.assignment_id}:{event_kind}:{correction.proposed_at.isoformat()}"
        AttendanceEvent.objects.create(
            tenant=tenant, assignment=correction.assignment, employee=correction.employee,
            kind=event_kind, occurred_at=correction.proposed_at, idempotency_key=key,
            payload_digest=hashlib.sha256(payload.encode()).hexdigest(),
            recorded_by_membership_id=member["id"], correction=correction,
        )
    correction.status = desired
    correction.reviewed_by_membership_id = member["id"]
    correction.reviewed_at = timezone.now()
    correction.decision_note = decision_note
    correction.save(update_fields=["status", "reviewed_by_membership_id", "reviewed_at", "decision_note"])
    audit(request, f"hr.attendance_correction.{desired}", tenant=tenant, target=correction.pk)
    return correction
