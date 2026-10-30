from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core import application as platform
from platform_core.access import membership_for
from .models import AttendanceEvent, CorrectionRequest, Employee, Shift, ShiftAssignment
from .serializers import (
    AssignmentInput, AssignmentOutput, CorrectionDecisionInput, CorrectionInput,
    CorrectionOutput, EmployeeInput, EmployeeOutput, EmployeePatch, PunchInput,
    ShiftInput, ShiftOutput,
)
from .services import (
    create_assignment, create_correction, create_employee, create_shift,
    decide_correction, record_punch, update_employee, visible_assignments,
    visible_corrections,
)


class EmployeeList(generics.ListAPIView):
    serializer_class = EmployeeOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        if member.role == "viewer":
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Employee roster requires a manager or tenant administrator role.")
        return Employee.objects.filter(tenant=member.tenant).order_by("code", "id")

    def post(self, request, tenant_id):
        serializer = EmployeeInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = create_employee(request, tenant_id, dict(serializer.validated_data))
        return Response(EmployeeOutput(employee).data, status=201)


class EmployeeDetail(APIView):
    def patch(self, request, tenant_id, employee_id):
        serializer = EmployeePatch(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = update_employee(request, tenant_id, employee_id, dict(serializer.validated_data))
        return Response(EmployeeOutput(employee).data)


class ShiftList(generics.ListAPIView):
    serializer_class = ShiftOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        if member.role == "viewer":
            return Shift.objects.none()
        return Shift.objects.filter(tenant=member.tenant).order_by("code", "id")

    def post(self, request, tenant_id):
        serializer = ShiftInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        shift = create_shift(request, tenant_id, dict(serializer.validated_data))
        return Response(ShiftOutput(shift).data, status=201)


class AssignmentList(generics.ListAPIView):
    serializer_class = AssignmentOutput

    def get_queryset(self):
        return visible_assignments(self.request, self.kwargs["tenant_id"])

    def post(self, request, tenant_id):
        serializer = AssignmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignment = create_assignment(request, tenant_id, dict(serializer.validated_data))
        assignment = ShiftAssignment.objects.select_related("employee", "shift").get(pk=assignment.pk)
        return Response(AssignmentOutput(assignment).data, status=201)


class AttendancePunch(APIView):
    def post(self, request, tenant_id, assignment_id, action):
        if action not in ("clock-in", "clock-out"):
            raise NotFound()
        serializer = PunchInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        kind = AttendanceEvent.Kind.CLOCK_IN if action == "clock-in" else AttendanceEvent.Kind.CLOCK_OUT
        event, record = record_punch(request, tenant_id, assignment_id, kind, serializer.validated_data["idempotency_key"])
        return Response({"event_id": str(event.pk), "kind": event.kind, "occurred_at": event.occurred_at, "attendance": {
            "clock_in_at": record.clock_in_at, "clock_out_at": record.clock_out_at, "version": record.version,
        }})


class CorrectionList(generics.ListAPIView):
    serializer_class = CorrectionOutput

    def get_queryset(self):
        return visible_corrections(self.request, self.kwargs["tenant_id"])

    def post(self, request, tenant_id):
        serializer = CorrectionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        correction = create_correction(request, tenant_id, dict(serializer.validated_data))
        return Response(CorrectionOutput(correction).data, status=201)


class CorrectionDecision(APIView):
    def post(self, request, tenant_id, correction_id, action):
        if action not in ("approve", "reject"):
            raise NotFound()
        serializer = CorrectionDecisionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        correction = decide_correction(
            request, tenant_id, correction_id, approve=action == "approve",
            decision_note=serializer.validated_data.get("decision_note", ""),
        )
        return Response(CorrectionOutput(correction).data)


class AttendanceEventList(generics.ListAPIView):
    serializer_class = None

    def list(self, request, *args, **kwargs):
        member = platform.current_membership(request=request, tenant_id=self.kwargs["tenant_id"])
        queryset = AttendanceEvent.objects.filter(tenant_id=member["tenant_id"]).select_related("employee", "assignment", "assignment__shift")
        if member["role"] == "viewer":
            queryset = queryset.filter(employee__membership_id=member["id"])
        queryset = queryset.order_by("-occurred_at", "-id")[:100]
        return Response({"count": len(queryset), "results": [{
            "id": str(event.pk), "employee_code": event.employee.code,
            "employee_name": event.employee.display_name, "work_date": event.assignment.work_date,
            "kind": event.kind, "occurred_at": event.occurred_at, "recorded_at": event.recorded_at,
            "timezone_name": event.assignment.shift.timezone_name,
        } for event in queryset]})
