from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from .models import AttendanceEvent, AttendanceRecord, CorrectionRequest, Employee, Shift, ShiftAssignment


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Unknown field." for key in sorted(unknown)})
        return super().to_internal_value(data)


class EmployeeInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{1,40}$")
    display_name = serializers.CharField(max_length=120, trim_whitespace=True)
    membership_id = serializers.UUIDField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)


class EmployeePatch(StrictSerializer):
    display_name = serializers.CharField(max_length=120, required=False, trim_whitespace=True)
    membership_id = serializers.UUIDField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)
    version = serializers.IntegerField(min_value=1)


class EmployeeOutput(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ["id", "code", "display_name", "membership_id", "is_active", "created_at", "version"]
        read_only_fields = fields


class ShiftInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{1,32}$")
    name = serializers.CharField(max_length=100, trim_whitespace=True)
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    timezone_name = serializers.CharField(max_length=64, default="Asia/Taipei")
    is_active = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if attrs["start_time"] == attrs["end_time"]:
            raise serializers.ValidationError({"end_time": "A shift cannot have zero duration."})
        try:
            ZoneInfo(attrs["timezone_name"])
        except ZoneInfoNotFoundError as exc:
            raise serializers.ValidationError({"timezone_name": "Use a valid IANA timezone name."}) from exc
        return attrs


class ShiftOutput(serializers.ModelSerializer):
    spans_midnight = serializers.BooleanField(read_only=True)

    class Meta:
        model = Shift
        fields = ["id", "code", "name", "start_time", "end_time", "timezone_name", "spans_midnight", "is_active"]
        read_only_fields = fields


class AssignmentInput(StrictSerializer):
    employee_id = serializers.UUIDField()
    shift_id = serializers.UUIDField()
    work_date = serializers.DateField()


class AttendanceOutput(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ["clock_in_at", "clock_out_at", "version", "updated_at"]
        read_only_fields = fields


class AssignmentOutput(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.code", read_only=True)
    employee_name = serializers.CharField(source="employee.display_name", read_only=True)
    shift_code = serializers.CharField(source="shift.code", read_only=True)
    shift_name = serializers.CharField(source="shift.name", read_only=True)
    shift_start = serializers.TimeField(source="shift.start_time", read_only=True)
    shift_end = serializers.TimeField(source="shift.end_time", read_only=True)
    timezone_name = serializers.CharField(source="shift.timezone_name", read_only=True)
    spans_midnight = serializers.BooleanField(source="shift.spans_midnight", read_only=True)
    attendance = serializers.SerializerMethodField()

    class Meta:
        model = ShiftAssignment
        fields = ["id", "employee_id", "employee_code", "employee_name", "shift_id", "shift_code", "shift_name", "shift_start", "shift_end", "timezone_name", "spans_midnight", "work_date", "attendance"]
        read_only_fields = fields

    def get_attendance(self, obj):
        try:
            record = obj.attendance
        except AttendanceRecord.DoesNotExist:
            return None
        return AttendanceOutput(record).data


class PunchInput(StrictSerializer):
    idempotency_key = serializers.UUIDField()


class CorrectionInput(StrictSerializer):
    assignment_id = serializers.UUIDField()
    field = serializers.ChoiceField(choices=CorrectionRequest.Field.choices)
    proposed_at = serializers.DateTimeField()
    reason = serializers.CharField(max_length=500, trim_whitespace=True)


class CorrectionDecisionInput(StrictSerializer):
    decision_note = serializers.CharField(max_length=500, allow_blank=True, required=False, trim_whitespace=True)


class CorrectionOutput(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.code", read_only=True)
    employee_name = serializers.CharField(source="employee.display_name", read_only=True)
    requested_by_membership_id = serializers.UUIDField(read_only=True)
    class Meta:
        model = CorrectionRequest
        fields = ["id", "assignment_id", "employee_id", "employee_code", "employee_name", "field", "proposed_at", "reason", "status", "requested_by_membership_id", "decision_note", "created_at", "reviewed_at"]
        read_only_fields = fields
