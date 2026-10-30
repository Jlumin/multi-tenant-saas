import uuid
from datetime import datetime, timedelta, timezone

from django.contrib.auth import get_user_model
from django.db import DatabaseError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from platform_core.models import AuditEvent, Membership, Tenant
from .models import AttendanceEvent, AttendanceRecord, Employee, Shift, ShiftAssignment


class HrApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin_user = User.objects.create_user(username="hr-admin", password="HR-admin-test-password-2026!")
        cls.manager_user = User.objects.create_user(username="hr-manager", password="HR-manager-test-password-2026!")
        cls.employee_user = User.objects.create_user(username="hr-employee", password="HR-employee-test-password-2026!")
        cls.other_user = User.objects.create_user(username="hr-other", password="HR-other-test-password-2026!")
        cls.tenant = Tenant.objects.create(name="HR Tenant A", slug="hr-tenant-a")
        cls.other_tenant = Tenant.objects.create(name="HR Tenant B", slug="hr-tenant-b")
        cls.admin = Membership.objects.create(tenant=cls.tenant, user=cls.admin_user, role="admin")
        cls.manager = Membership.objects.create(tenant=cls.tenant, user=cls.manager_user, role="manager")
        cls.employee_membership = Membership.objects.create(tenant=cls.tenant, user=cls.employee_user, role="viewer")
        Membership.objects.create(tenant=cls.other_tenant, user=cls.other_user, role="admin")
        cls.employee = Employee.objects.create(tenant=cls.tenant, code="E-001", display_name="Test Employee", membership_id=cls.employee_membership.pk)
        cls.shift = Shift.objects.create(tenant=cls.tenant, code="NIGHT", name="Night shift", start_time="22:00", end_time="06:00", timezone_name="Asia/Taipei")
        cls.assignment = ShiftAssignment.objects.create(
            tenant=cls.tenant, employee=cls.employee, shift=cls.shift,
            work_date="2026-10-30", created_by_membership_id=cls.admin.pk,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)
        self.base = f"/api/v1/tenants/{self.tenant.pk}/hr/"

    def test_owner_can_create_employee_shift_and_overnight_assignment(self):
        employee = self.client.post(self.base + "employees/", {
            "code": "E-002", "display_name": "Second Employee", "membership_id": str(self.manager.pk),
        }, format="json")
        self.assertEqual(employee.status_code, 201, employee.data)
        shift = self.client.post(self.base + "shifts/", {
            "code": "LATE", "name": "Late shift", "start_time": "21:00", "end_time": "05:00", "timezone_name": "Asia/Taipei",
        }, format="json")
        self.assertEqual(shift.status_code, 201, shift.data)
        self.assertTrue(shift.data["spans_midnight"])
        assignment = self.client.post(self.base + "assignments/", {
            "employee_id": employee.data["id"], "shift_id": shift.data["id"], "work_date": "2026-10-30",
        }, format="json")
        self.assertEqual(assignment.status_code, 201, assignment.data)
        self.assertTrue(assignment.data["spans_midnight"])
        # Same employee cannot receive overlapping scheduled intervals.
        conflict = self.client.post(self.base + "assignments/", {
            "employee_id": employee.data["id"], "shift_id": self.shift.pk, "work_date": "2026-10-30",
        }, format="json")
        self.assertEqual(conflict.status_code, 400)

    def test_employee_self_service_clocking_is_idempotent_and_tenant_scoped(self):
        self.client.force_authenticate(self.employee_user)
        own = self.client.get(self.base + "assignments/")
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.data["count"], 1)
        key = uuid.uuid4()
        path = self.base + f"assignments/{self.assignment.pk}/clock-in/"
        clock_in = self.client.post(path, {"idempotency_key": str(key)}, format="json")
        self.assertEqual(clock_in.status_code, 200, clock_in.data)
        replay = self.client.post(path, {"idempotency_key": str(key)}, format="json")
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(AttendanceEvent.objects.filter(assignment=self.assignment).count(), 1)
        duplicate = self.client.post(path, {"idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(duplicate.status_code, 409)
        clock_out = self.client.post(self.base + f"assignments/{self.assignment.pk}/clock-out/", {"idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(clock_out.status_code, 200, clock_out.data)
        self.assertLessEqual(clock_in.data["occurred_at"], clock_out.data["occurred_at"])
        self.assertEqual(AttendanceEvent.objects.filter(assignment=self.assignment).count(), 2)
        self.assertEqual(self.client.get(f"/api/v1/tenants/{self.other_tenant.pk}/hr/assignments/").status_code, 404)

    def test_employee_cannot_punch_another_employee_assignment(self):
        second_user = get_user_model().objects.create_user(username="hr-second-employee")
        second_membership = Membership.objects.create(tenant=self.tenant, user=second_user, role="viewer")
        second_employee = Employee.objects.create(tenant=self.tenant, code="E-002", display_name="Second", membership_id=second_membership.pk)
        other_assignment = ShiftAssignment.objects.create(
            tenant=self.tenant, employee=second_employee, shift=self.shift,
            work_date="2026-10-31", created_by_membership_id=self.admin.pk,
        )
        self.client.force_authenticate(self.employee_user)
        response = self.client.post(self.base + f"assignments/{other_assignment.pk}/clock-in/", {"idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_correction_requires_separate_owner_approval_and_appends_event(self):
        self.client.force_authenticate(self.employee_user)
        punch = self.client.post(self.base + f"assignments/{self.assignment.pk}/clock-in/", {"idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(punch.status_code, 200)
        proposed = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        correction = self.client.post(self.base + "corrections/", {
            "assignment_id": str(self.assignment.pk), "field": "clock_in", "proposed_at": proposed,
            "reason": "忘記按打卡，主管確認到班。",
        }, format="json")
        self.assertEqual(correction.status_code, 201, correction.data)
        original_events = AttendanceEvent.objects.filter(assignment=self.assignment).count()
        self.client.force_authenticate(self.admin_user)
        approved = self.client.post(self.base + f"corrections/{correction.data['id']}/approve/", {"decision_note": "核對排班紀錄"}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(approved.data["status"], "approved")
        record = AttendanceRecord.objects.get(assignment=self.assignment)
        self.assertEqual(record.clock_in_at.isoformat(), datetime.fromisoformat(proposed).isoformat())
        self.assertEqual(AttendanceEvent.objects.filter(assignment=self.assignment).count(), original_events + 1)
        self.assertTrue(AttendanceEvent.objects.filter(correction_id=correction.data["id"], kind="correction_in").exists())
        self.assertTrue(AuditEvent.objects.filter(tenant=self.tenant, action="hr.attendance_correction.approved").exists())

    def test_requester_cannot_approve_own_request_and_manager_cannot_approve(self):
        admin_employee = Employee.objects.create(tenant=self.tenant, code="E-ADMIN", display_name="Admin employee", membership_id=self.admin.pk)
        assignment = ShiftAssignment.objects.create(
            tenant=self.tenant, employee=admin_employee, shift=self.shift,
            work_date="2026-11-01", created_by_membership_id=self.admin.pk,
        )
        request_time = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        self.client.force_authenticate(self.admin_user)
        correction = self.client.post(self.base + "corrections/", {
            "assignment_id": str(assignment.pk), "field": "clock_in", "proposed_at": request_time, "reason": "Admin self request.",
        }, format="json")
        self.assertEqual(correction.status_code, 201)
        own_decision = self.client.post(self.base + f"corrections/{correction.data['id']}/approve/", {}, format="json")
        self.assertEqual(own_decision.status_code, 403)
        self.client.force_authenticate(self.manager_user)
        manager_decision = self.client.post(self.base + f"corrections/{correction.data['id']}/approve/", {}, format="json")
        self.assertEqual(manager_decision.status_code, 403)

    def test_viewer_cannot_read_roster_or_mutate_schedule_and_events_are_immutable(self):
        self.client.force_authenticate(self.employee_user)
        self.assertEqual(self.client.get(self.base + "employees/").status_code, 403)
        self.assertEqual(self.client.post(self.base + "shifts/", {"code": "X", "name": "X", "start_time": "08:00", "end_time": "16:00"}, format="json").status_code, 403)
        punch = self.client.post(self.base + f"assignments/{self.assignment.pk}/clock-in/", {"idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(punch.status_code, 200)
        event = AttendanceEvent.objects.get(pk=punch.data["event_id"])
        with self.assertRaises(ValueError):
            event.delete()
        with self.assertRaises(ValueError):
            event.save()
        with self.assertRaises(DatabaseError), transaction.atomic():
            AttendanceRecord.objects.filter(assignment=self.assignment).update(clock_in_at=None)

    def test_invalid_timezone_and_future_or_unlinked_punch_are_rejected(self):
        shift = self.client.post(self.base + "shifts/", {
            "code": "BAD-TZ", "name": "Bad", "start_time": "08:00", "end_time": "16:00", "timezone_name": "Mars/Olympus",
        }, format="json")
        self.assertEqual(shift.status_code, 400)
        unlinked = self.client.post(self.base + "employees/", {"code": "NO-LINK", "display_name": "No login"}, format="json")
        self.assertEqual(unlinked.status_code, 201)
        assignment = self.client.post(self.base + "assignments/", {
            "employee_id": unlinked.data["id"], "shift_id": self.shift.pk, "work_date": "2026-11-02",
        }, format="json")
        self.assertEqual(assignment.status_code, 400)
        self.assertEqual(self.client.post(self.base + "corrections/", {
            "assignment_id": str(self.assignment.pk), "field": "clock_in",
            "proposed_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), "reason": "Future",
        }, format="json").status_code, 400)
