from io import StringIO
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.db import DatabaseError, IntegrityError, connections, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from .models import AuditEvent, Membership, Store, StoreAccess, Tenant


class PlatformTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = get_user_model().objects.create_user(username="admin-a", password="Testing-session-pass-289!")
        cls.other = get_user_model().objects.create_user(username="admin-b", password="Testing-session-pass-381!")
        cls.viewer = get_user_model().objects.create_user(username="viewer")
        cls.manager = get_user_model().objects.create_user(username="manager")
        cls.a = Tenant.objects.create(name="Tenant A", slug="tenant-a")
        cls.b = Tenant.objects.create(name="Tenant B", slug="tenant-b")
        cls.admin_member = Membership.objects.create(tenant=cls.a, user=cls.admin, role="admin")
        Membership.objects.create(tenant=cls.b, user=cls.other, role="admin")
        cls.viewer_member = Membership.objects.create(tenant=cls.a, user=cls.viewer, role="viewer")
        cls.manager_member = Membership.objects.create(tenant=cls.a, user=cls.manager, role="manager")
        cls.store = Store.objects.create(tenant=cls.a, name="Store A1", code="a1")
        cls.unassigned = Store.objects.create(tenant=cls.a, name="Store A2", code="a2")
        cls.foreign = Store.objects.create(tenant=cls.b, name="Store B", code="b1")
        StoreAccess.objects.create(membership=cls.viewer_member, store=cls.store)
        StoreAccess.objects.create(membership=cls.manager_member, store=cls.store)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def url(self, suffix, tenant=None):
        return f"/api/v1/tenants/{(tenant or self.a).pk}/{suffix}/"

    def test_anonymous_cannot_access_identity_or_tenant(self):
        self.client.force_authenticate(None)
        for url in ("/api/v1/auth/me/", self.url("stores"), self.url("members"), self.url("audit")):
            self.assertEqual(self.client.get(url).status_code, 403)

    def test_me_only_lists_active_memberships(self):
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(len(response.data["memberships"]), 1)
        self.assertEqual(response.data["memberships"][0]["tenant_id"], str(self.a.pk))
        self.a.is_active = False
        self.a.save()
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["memberships"], [])

    def test_cross_tenant_reads_and_writes_return_404(self):
        for suffix in ("stores", "members", "audit"):
            self.assertEqual(self.client.get(self.url(suffix, self.b)).status_code, 404)
        self.assertEqual(self.client.post(self.url("stores", self.b), {"name": "Blocked", "code": "blocked"}).status_code, 404)
        self.assertEqual(self.client.get(self.url(f"stores/{self.foreign.pk}")).status_code, 404)
        self.assertEqual(self.client.patch(self.url(f"stores/{self.foreign.pk}"), {"name": "Blocked"}).status_code, 404)

    def test_admin_store_creation_is_scoped_and_audited(self):
        response = self.client.post(self.url("stores"), {"name": "New", "code": "new", "tenant": str(self.b.pk)})
        self.assertEqual(response.status_code, 201)
        store = Store.objects.get(pk=response.data["id"])
        self.assertEqual(store.tenant_id, self.a.pk)
        event = AuditEvent.objects.get(action="store.created")
        self.assertEqual(event.actor_id, self.admin.pk)
        self.assertEqual(event.request_id, response["X-Request-ID"])
        self.assertEqual(event.tenant_id, self.a.pk)

    def test_store_codes_are_unique_within_tenant(self):
        self.assertEqual(self.client.post(self.url("stores"), {"name": "Duplicate", "code": "a1"}).status_code, 400)
        self.assertEqual(self.client.post(self.url("stores"), {"name": "Allowed", "code": "b1"}).status_code, 201)

    def test_viewer_and_manager_only_see_assigned_active_stores(self):
        for user in (self.viewer, self.manager):
            self.client.force_authenticate(user)
            response = self.client.get(self.url("stores"))
            self.assertEqual([str(s["id"]) for s in response.data["results"]], [str(self.store.pk)])
            self.assertEqual(self.client.get(self.url(f"stores/{self.unassigned.pk}")).status_code, 404)
            self.assertEqual(self.client.get(self.url(f"stores/{self.foreign.pk}")).status_code, 404)
            self.assertEqual(self.client.get(self.url(f"stores/{self.store.pk}")).status_code, 200)
        self.store.is_active = False
        self.store.save()
        self.assertEqual(self.client.get(self.url("stores")).data["count"], 0)

    def test_non_admin_cannot_manage_or_read_audit(self):
        for user in (self.viewer, self.manager):
            self.client.force_authenticate(user)
            for suffix in ("members", "audit"):
                self.assertEqual(self.client.get(self.url(suffix)).status_code, 403)
            self.assertEqual(self.client.post(self.url("stores"), {"name": "X", "code": "x"}).status_code, 403)
            self.assertEqual(self.client.patch(self.url(f"stores/{self.store.pk}"), {"name": "X"}).status_code, 403)
            self.assertEqual(self.client.patch(self.url(f"members/{self.viewer_member.pk}"), {"role": "admin"}).status_code, 403)

    def test_inactive_store_grants_are_preserved_without_granting_access(self):
        self.store.is_active = False
        self.store.save()
        response = self.client.patch(self.url(f"members/{self.viewer_member.pk}"), {"role": "manager", "store_ids": [str(self.store.pk)]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get(self.url("stores")).data["count"], 0)
        self.store.is_active = True
        self.store.save()
        self.assertEqual(self.client.get(self.url("stores")).data["count"], 1)

    def test_superuser_has_no_implicit_tenant_bypass(self):
        user = get_user_model().objects.create_superuser(username="root", password="Test-superuser-782!")
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get(self.url("stores")).status_code, 404)

    def test_disabled_membership_tenant_and_user_fail_closed(self):
        self.admin_member.is_active = False
        self.admin_member.save()
        self.assertEqual(self.client.get(self.url("stores")).status_code, 404)
        self.admin_member.is_active = True
        self.admin_member.save()
        self.a.is_active = False
        self.a.save()
        self.assertEqual(self.client.get(self.url("stores")).status_code, 404)
        self.admin.is_active = False
        self.admin.save()
        client = APIClient()
        client.force_login(self.admin)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 403)

    def test_member_creation_password_and_store_assignment(self):
        password = "Another-secure-member-893!"
        response = self.client.post(self.url("members"), {"username": "new-member", "password": password, "role": "manager", "store_ids": [str(self.store.pk)]}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("password", response.data)
        self.assertTrue(get_user_model().objects.get(username="new-member").check_password(password))
        member = Membership.objects.get(pk=response.data["id"])
        self.assertEqual(list(member.stores.all()), [self.store])
        self.assertEqual(AuditEvent.objects.get(action="membership.created").target_id, str(member.pk))

    def test_invalid_member_creation_does_not_create_user(self):
        for stores in ([str(self.foreign.pk)],):
            response = self.client.post(self.url("members"), {"username": "not-created", "password": "Strong-test-account-182!", "store_ids": stores}, format="json")
            self.assertEqual(response.status_code, 400)
        self.assertFalse(get_user_model().objects.filter(username="not-created").exists())
        self.assertEqual(self.client.post(self.url("members"), {"username": "weak", "password": "123"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url("members"), {"username": self.admin.username, "password": "Strong-test-account-182!"}, format="json").status_code, 400)

    def test_last_admin_cannot_be_demoted_or_disabled(self):
        for payload in ({"role": "viewer"}, {"is_active": False}):
            self.assertEqual(self.client.patch(self.url(f"members/{self.admin_member.pk}"), payload, format="json").status_code, 400)
        self.assertEqual(AuditEvent.objects.count(), 0)
        self.assertEqual(self.client.patch(self.url(f"members/{self.viewer_member.pk}"), {"role": "admin"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(self.url(f"members/{self.admin_member.pk}"), {"role": "viewer"}, format="json").status_code, 200)

    def test_membership_mutation_rejects_foreign_objects_and_identity_changes(self):
        member_b = Membership.objects.get(tenant=self.b)
        self.assertEqual(self.client.patch(self.url(f"members/{member_b.pk}"), {"role": "viewer"}, format="json").status_code, 404)
        self.assertEqual(self.client.patch(self.url(f"members/{self.viewer_member.pk}"), {"store_ids": [str(self.foreign.pk)]}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(self.url(f"members/{self.viewer_member.pk}"), {"username": "changed"}, format="json").status_code, 400)

    def test_audit_is_scoped_read_only_and_paginated(self):
        AuditEvent.objects.create(tenant=self.a, actor=self.admin, action="test.a")
        AuditEvent.objects.create(tenant=self.b, actor=self.other, action="test.b")
        response = self.client.get(self.url("audit"))
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["action"], "test.a")
        self.assertEqual(self.client.post(self.url("audit"), {"action": "forged"}).status_code, 405)

    @patch("platform_core.services.audit", side_effect=RuntimeError("audit unavailable"))
    def test_business_write_rolls_back_if_audit_fails(self, mock):
        with self.assertRaises(RuntimeError):
            self.client.post(self.url("stores"), {"name": "Rolled back", "code": "rollback"})
        self.assertFalse(Store.objects.filter(code="rollback").exists())

    def test_database_uniqueness_and_assignment_guard(self):
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            StoreAccess.objects.create(membership=self.viewer_member, store=self.foreign)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Membership.objects.create(tenant=self.a, user=self.admin)
        with self.assertRaises(IntegrityError), transaction.atomic():
            StoreAccess.objects.bulk_create([StoreAccess(membership=self.viewer_member, store=self.foreign)])
        with self.assertRaises(IntegrityError), transaction.atomic():
            Store.objects.filter(pk=self.store.pk).update(tenant=self.b)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Membership.objects.filter(pk=self.viewer_member.pk).update(tenant=self.b)

    def test_audit_cannot_be_changed_or_deleted_through_queryset(self):
        event = AuditEvent.objects.create(tenant=self.a, actor=self.admin, action="original")
        with self.assertRaises(DatabaseError), transaction.atomic():
            AuditEvent.objects.filter(pk=event.pk).update(action="forged")
        with self.assertRaises(DatabaseError), transaction.atomic():
            AuditEvent.objects.filter(pk=event.pk).delete()
        event.refresh_from_db()
        self.assertEqual(event.action, "original")

    def test_login_csrf_session_rotation_logout_and_audit(self):
        client = APIClient(enforce_csrf_checks=True)
        url = "/api/v1/auth/login/"
        credentials = {"username": self.admin.username, "password": "Testing-session-pass-289!"}
        self.assertEqual(client.post(url, credentials, format="json").status_code, 403)
        token = client.get("/api/v1/auth/csrf/").data["csrfToken"]
        old_cookie = client.cookies["csrftoken"].value
        login_response = client.post(url, credentials, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(login_response.status_code, 200)
        self.assertNotEqual(old_cookie, client.cookies["csrftoken"].value)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(client.post("/api/v1/auth/logout/", {}, format="json").status_code, 403)
        self.assertEqual(client.post("/api/v1/auth/logout/", {}, format="json", HTTP_X_CSRFTOKEN=login_response.data["csrfToken"]).status_code, 200)
        self.assertEqual(client.get("/api/v1/auth/me/").status_code, 403)
        self.assertTrue(AuditEvent.objects.filter(action="auth.login", actor=self.admin).exists())
        self.assertTrue(AuditEvent.objects.filter(action="auth.logout", actor=self.admin).exists())

    def test_failed_login_is_generic_audited_and_throttled(self):
        client = APIClient()
        for i in range(10):
            response = client.post("/api/v1/auth/login/", {"username": "unknown", "password": "wrong"}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["error"]["code"], "invalid_credentials")
        self.assertEqual(client.post("/api/v1/auth/login/", {}, format="json").status_code, 429)
        self.assertEqual(AuditEvent.objects.filter(action="auth.login_failed").count(), 10)
        self.assertFalse(AuditEvent.objects.filter(action="auth.login_failed").exclude(target_id="").exists())

    def test_request_id_and_error_shape(self):
        response = self.client.get(self.url("stores", self.b), HTTP_X_REQUEST_ID="untrusted")
        self.assertNotEqual(response["X-Request-ID"], "untrusted")
        self.assertEqual(response.data["error"]["request_id"], response["X-Request-ID"])

    @patch("platform_core.management.commands.provision_tenant.getpass", side_effect=["Tenant-command-pass-812!", "Tenant-command-pass-812!"])
    def test_provision_command_creates_admin_and_can_link_existing_identity(self, prompt):
        call_command("provision_tenant", name="New tenant", slug="new-tenant", username="new-admin", stdout=StringIO())
        user = get_user_model().objects.get(username="new-admin")
        self.assertTrue(user.check_password("Tenant-command-pass-812!"))
        call_command("provision_tenant", name="Second tenant", slug="second-tenant", username="new-admin", stdout=StringIO())
        self.assertEqual(prompt.call_count, 2)
        self.assertEqual(Membership.objects.filter(user=user, role="admin").count(), 2)


class ConcurrentAdminTests(TransactionTestCase):
    def test_concurrent_demotions_preserve_one_admin(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        tenant = Tenant.objects.create(name="Concurrent", slug="concurrent")
        pairs = []
        for name in ("first", "second"):
            user = get_user_model().objects.create_user(username=name)
            member = Membership.objects.create(tenant=tenant, user=user, role="admin")
            pairs.append((user.pk, member.pk))
        barrier = Barrier(2)

        def demote(pair):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=pair[0]))
                barrier.wait(timeout=10)
                return client.patch(f"/api/v1/tenants/{tenant.pk}/members/{pair[1]}/", {"role": "viewer"}, format="json").status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(demote, pairs))
        self.assertEqual(sorted(statuses), [200, 400])
        self.assertEqual(Membership.objects.filter(tenant=tenant, role="admin", is_active=True).count(), 1)
