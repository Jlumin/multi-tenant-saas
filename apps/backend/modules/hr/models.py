import uuid
from django.db import models
from django.db.models import Q


class Employee(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    display_name = models.CharField(max_length=120)
    membership_id = models.UUIDField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="hr_employee_tenant_code_uniq"),
            models.UniqueConstraint(fields=["tenant", "membership_id"], condition=Q(membership_id__isnull=False), name="hr_employee_membership_uniq"),
            models.CheckConstraint(condition=~Q(code=""), name="hr_employee_code_not_empty"),
            models.CheckConstraint(condition=~Q(display_name=""), name="hr_employee_name_not_empty"),
        ]
        ordering = ["code", "id"]


class Shift(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=100)
    start_time = models.TimeField()
    end_time = models.TimeField()
    timezone_name = models.CharField(max_length=64, default="Asia/Taipei")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def spans_midnight(self):
        return self.end_time <= self.start_time

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="hr_shift_tenant_code_uniq"),
            models.CheckConstraint(condition=~Q(code=""), name="hr_shift_code_not_empty"),
            models.CheckConstraint(condition=~Q(name=""), name="hr_shift_name_not_empty"),
            models.CheckConstraint(condition=~Q(start_time=models.F("end_time")), name="hr_shift_duration_not_zero"),
        ]
        ordering = ["code", "id"]


class ShiftAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    employee = models.ForeignKey(Employee, related_name="assignments", on_delete=models.PROTECT)
    shift = models.ForeignKey(Shift, related_name="assignments", on_delete=models.PROTECT)
    work_date = models.DateField()
    created_by_membership_id = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["employee", "shift", "work_date"], name="hr_assignment_employee_shift_date_uniq")]
        ordering = ["-work_date", "employee__code", "id"]


class AttendanceRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    assignment = models.OneToOneField(ShiftAssignment, related_name="attendance", on_delete=models.PROTECT)
    clock_in_at = models.DateTimeField(null=True, blank=True)
    clock_out_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(
            condition=Q(clock_out_at__isnull=True) | (Q(clock_in_at__isnull=False) & Q(clock_out_at__gte=models.F("clock_in_at"))),
            name="hr_attendance_time_order_valid",
        )]


class AttendanceEvent(models.Model):
    class Kind(models.TextChoices):
        CLOCK_IN = "clock_in", "Clock in"
        CLOCK_OUT = "clock_out", "Clock out"
        CORRECTION_IN = "correction_in", "Corrected clock in"
        CORRECTION_OUT = "correction_out", "Corrected clock out"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    assignment = models.ForeignKey(ShiftAssignment, related_name="events", on_delete=models.PROTECT)
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    occurred_at = models.DateTimeField()
    idempotency_key = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    recorded_by_membership_id = models.UUIDField()
    correction = models.ForeignKey("CorrectionRequest", null=True, blank=True, on_delete=models.PROTECT)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="hr_event_tenant_idem_uniq"),
            models.CheckConstraint(condition=Q(kind__in=["clock_in", "clock_out", "correction_in", "correction_out"]), name="hr_event_kind_valid"),
        ]
        ordering = ["-occurred_at", "-id"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Attendance events are append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Attendance events cannot be deleted.")


class CorrectionRequest(models.Model):
    class Field(models.TextChoices):
        CLOCK_IN = "clock_in", "Clock in"
        CLOCK_OUT = "clock_out", "Clock out"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    assignment = models.ForeignKey(ShiftAssignment, related_name="corrections", on_delete=models.PROTECT)
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT)
    field = models.CharField(max_length=10, choices=Field.choices)
    proposed_at = models.DateTimeField()
    reason = models.CharField(max_length=500)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    requested_by_membership_id = models.UUIDField()
    reviewed_by_membership_id = models.UUIDField(null=True, blank=True)
    decision_note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(field__in=["clock_in", "clock_out"]), name="hr_correction_field_valid"),
            models.CheckConstraint(condition=Q(status__in=["pending", "approved", "rejected"]), name="hr_correction_status_valid"),
            models.CheckConstraint(condition=~Q(reason=""), name="hr_correction_reason_not_empty"),
        ]
        ordering = ["-created_at", "-id"]
