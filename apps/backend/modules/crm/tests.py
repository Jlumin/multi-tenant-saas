from django.contrib.auth import get_user_model
from django.db import DatabaseError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from platform_core.models import AuditEvent, Membership, Tenant
from .models import ConsentEvent, Customer


class CrmApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin_user = User.objects.create_user(username="crm-admin", password="Test-admin-password-991!")
        cls.manager_user = User.objects.create_user(username="crm-manager", password="Test-manager-password-991!")
        cls.viewer_user = User.objects.create_user(username="crm-viewer", password="Test-viewer-password-991!")
        cls.other_user = User.objects.create_user(username="crm-other", password="Test-other-password-991!")
        cls.tenant = Tenant.objects.create(name="CRM Tenant A", slug="crm-tenant-a")
        cls.other_tenant = Tenant.objects.create(name="CRM Tenant B", slug="crm-tenant-b")
        cls.admin = Membership.objects.create(tenant=cls.tenant, user=cls.admin_user, role="admin")
        cls.manager = Membership.objects.create(tenant=cls.tenant, user=cls.manager_user, role="manager")
        cls.viewer = Membership.objects.create(tenant=cls.tenant, user=cls.viewer_user, role="viewer")
        Membership.objects.create(tenant=cls.other_tenant, user=cls.other_user, role="admin")
        cls.customer = Customer.objects.create(tenant=cls.tenant, code="C-001", name="Test Customer", email="test@example.com")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)

    def url(self, suffix="", tenant=None):
        return f"/api/v1/tenants/{(tenant or self.tenant).pk}/crm/customers/{suffix}"

    def test_manager_can_create_and_update_customer_with_version(self):
        self.client.force_authenticate(self.manager_user)
        response = self.client.post(self.url(), {"code": "c-002", "name": "New Customer", "email": "new@example.com"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        customer_id = response.data["id"]
        self.assertEqual(self.client.patch(self.url(f"{customer_id}/"), {"version": 1, "phone": "+886900000000"}, format="json").status_code, 200)
        stale = self.client.patch(self.url(f"{customer_id}/"), {"version": 1, "name": "Stale"}, format="json")
        self.assertEqual(stale.status_code, 409)

    def test_viewer_is_read_only_and_tenant_scope_is_enforced(self):
        self.client.force_authenticate(self.viewer_user)
        self.assertEqual(self.client.get(self.url()).status_code, 403)
        self.assertEqual(self.client.post(self.url(), {"code": "NO", "name": "No"}, format="json").status_code, 403)
        self.assertEqual(self.client.get(self.url(tenant=self.other_tenant)).status_code, 404)
        other_customer = Customer.objects.create(tenant=self.other_tenant, code="X", name="Other")
        self.assertEqual(self.client.get(self.url(f"{other_customer.pk}/")).status_code, 403)
        self.client.force_authenticate(self.admin_user)
        self.assertEqual(self.client.get(self.url(f"{other_customer.pk}/")).status_code, 404)
        self.assertEqual(APIClient().get(self.url()).status_code, 403)

    def test_customer_list_searches_only_current_tenant(self):
        Customer.objects.create(tenant=self.other_tenant, code="C-001", name="Secret Customer")
        response = self.client.get(self.url("?search=Test"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Customer")

    def test_consent_changes_append_and_withdrawal_is_a_new_event(self):
        first = self.client.post(self.url(f"{self.customer.pk}/consents/"), {"purpose": "marketing_email", "granted": True, "policy_version": "v1"}, format="json")
        second = self.client.post(self.url(f"{self.customer.pk}/consents/"), {"purpose": "marketing_email", "granted": False, "policy_version": "v1"}, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(ConsentEvent.objects.filter(customer=self.customer).count(), 2)
        self.assertFalse(ConsentEvent.objects.filter(customer=self.customer).latest("recorded_at").granted)
        self.assertTrue(AuditEvent.objects.filter(tenant=self.tenant, action="crm.consent.recorded").exists())
        detail = self.client.get(self.url(f"{self.customer.pk}/"))
        self.assertEqual(len(detail.data["consents"]), 2)

    def test_consent_is_immutable_and_customer_is_soft_deactivated(self):
        event = ConsentEvent.objects.create(tenant=self.tenant, customer=self.customer, purpose="terms", granted=True, policy_version="v1", recorded_by=self.admin)
        event.granted = False
        with self.assertRaises(ValueError):
            event.save()
        with self.assertRaises(ValueError):
            event.delete()
        response = self.client.patch(self.url(f"{self.customer.pk}/"), {"version": 1, "is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Customer.objects.filter(pk=self.customer.pk, consent_events__pk=event.pk).exists())
        denied = self.client.post(self.url(f"{self.customer.pk}/consents/"), {"purpose": "terms", "granted": False, "policy_version": "v1"}, format="json")
        self.assertEqual(denied.status_code, 400)

    def test_request_fields_cannot_choose_tenant_or_actor(self):
        response = self.client.post(self.url(), {"code": "C-002", "name": "New", "tenant": str(self.other_tenant.pk)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Customer.objects.filter(code="C-002").exists())

    def test_database_guards_reject_cross_tenant_consent_and_customer_deletion(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            ConsentEvent.objects.create(tenant=self.other_tenant, customer=self.customer, purpose="terms", granted=True, policy_version="v1", recorded_by=self.admin)
        with self.assertRaises(DatabaseError), transaction.atomic():
            Customer.objects.filter(pk=self.customer.pk).delete()
