import hashlib
import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import DatabaseError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from platform_core.models import Membership, Store, StoreAccess, Tenant
from .models import MenuCategory, MenuItem, Order, OrderLine, PaymentEvent, PosShift, Table


class RestaurantApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin_user = User.objects.create_user(username="restaurant-admin", password="Restaurant-admin-test-2026!")
        cls.manager_user = User.objects.create_user(username="restaurant-manager", password="Restaurant-manager-test-2026!")
        cls.cashier_user = User.objects.create_user(username="restaurant-cashier", password="Restaurant-cashier-test-2026!")
        cls.other_user = User.objects.create_user(username="restaurant-other", password="Restaurant-other-test-2026!")
        cls.tenant = Tenant.objects.create(name="Restaurant Tenant", slug="restaurant-tenant")
        cls.other_tenant = Tenant.objects.create(name="Other Restaurant", slug="other-restaurant")
        cls.admin = Membership.objects.create(tenant=cls.tenant, user=cls.admin_user, role="admin")
        cls.manager = Membership.objects.create(tenant=cls.tenant, user=cls.manager_user, role="manager")
        cls.cashier = Membership.objects.create(tenant=cls.tenant, user=cls.cashier_user, role="viewer")
        cls.other_admin = Membership.objects.create(tenant=cls.other_tenant, user=cls.other_user, role="admin")
        cls.store = Store.objects.create(tenant=cls.tenant, name="Main", code="main")
        cls.other_store = Store.objects.create(tenant=cls.tenant, name="Other", code="other")
        cls.foreign_store = Store.objects.create(tenant=cls.other_tenant, name="Foreign", code="foreign")
        StoreAccess.objects.create(membership=cls.manager, store=cls.store)
        StoreAccess.objects.create(membership=cls.cashier, store=cls.store)
        cls.category = MenuCategory.objects.create(tenant=cls.tenant, code="FOOD", name="Food")
        cls.item = MenuItem.objects.create(tenant=cls.tenant, category=cls.category, code="SOUP", name="Soup", price=Decimal("125.00"))

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)
        self.base = f"/api/v1/tenants/{self.tenant.pk}/"
        self.store_base = self.base + f"stores/{self.store.pk}/restaurant/"

    def create_table(self):
        return self.client.post(self.store_base + "tables/", {"code": "T01", "name": "Table 1"}, format="json")

    def open_shift(self, client=None):
        client = client or self.client
        return client.post(self.store_base + "pos-shift/open/", {"opening_float": "50.00"}, format="json")

    def test_admin_can_create_menu_and_table_scoped_revocable_qr(self):
        created = self.create_table()
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(len(created.data["qr_token"]), 43)
        self.assertIn("?qr=", created.data["qr_url"])
        menu = self.client.get(f"/api/v1/restaurant/qr/{created.data['qr_token']}/menu/")
        self.assertEqual(menu.status_code, 200)
        self.assertEqual(menu.data["table_name"], "Table 1")
        self.assertEqual(menu.data["categories"][0]["items"][0]["name"], "Soup")
        qr = self.client.get(created.data["qr_code_url"])
        self.assertEqual(qr.status_code, 200)
        self.assertTrue(qr["Content-Type"].startswith("image/svg+xml"))
        rotated = self.client.post(self.base + f"restaurant/tables/{created.data['id']}/rotate-qr/", {}, format="json")
        self.assertEqual(rotated.status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/restaurant/qr/{created.data['qr_token']}/menu/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/restaurant/qr/{rotated.data['qr_token']}/menu/").status_code, 200)

    def test_qr_guest_order_is_scoped_snapshotted_and_idempotent(self):
        table_response = self.create_table()
        token = table_response.data["qr_token"]
        self.assertEqual(APIClient().get(f"/api/v1/restaurant/qr/{token}/menu/").data["accepting_orders"], False)
        self.open_shift()
        self.assertEqual(APIClient().get(f"/api/v1/restaurant/qr/{token}/menu/").data["accepting_orders"], True)
        key = str(uuid.uuid4())
        payload = {"idempotency_key": key, "lines": [{"menu_item_id": str(self.item.pk), "quantity": 2}], "note": "no cilantro"}
        created = APIClient().post(f"/api/v1/restaurant/qr/{token}/orders/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        replay = APIClient().post(f"/api/v1/restaurant/qr/{token}/orders/", payload, format="json")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data["id"], created.data["id"])
        self.assertEqual(created.data["total_amount"], "250.00")
        self.assertEqual(Order.objects.filter(tenant=self.tenant).count(), 1)
        self.assertEqual(OrderLine.objects.get(order_id=created.data["id"]).item_name, "Soup")
        conflict_payload = {**payload, "lines": [{"menu_item_id": str(self.item.pk), "quantity": 1}]}
        conflict = APIClient().post(f"/api/v1/restaurant/qr/{token}/orders/", conflict_payload, format="json")
        self.assertEqual(conflict.status_code, 409)
        foreign = Table.objects.create(tenant=self.other_tenant, store_id=self.foreign_store.pk, code="T01", name="Foreign", qr_token_digest=hashlib.sha256(b"foreign-token").hexdigest())
        self.assertEqual(APIClient().get(f"/api/v1/restaurant/qr/{foreign.qr_token_digest}/menu/").status_code, 404)

    def test_qr_order_write_requires_csrf_and_invalid_item_fails_closed(self):
        table = self.create_table().data
        self.open_shift()
        client = APIClient(enforce_csrf_checks=True)
        no_token = client.post(f"/api/v1/restaurant/qr/{table['qr_token']}/orders/", {
            "idempotency_key": str(uuid.uuid4()), "lines": [{"menu_item_id": str(self.item.pk), "quantity": 1}],
        }, format="json")
        self.assertEqual(no_token.status_code, 403)
        csrf = client.get("/api/v1/auth/csrf/").data["csrfToken"]
        invalid = client.post(f"/api/v1/restaurant/qr/{table['qr_token']}/orders/", {
            "idempotency_key": str(uuid.uuid4()), "lines": [{"menu_item_id": str(uuid.uuid4()), "quantity": 1}],
        }, format="json", HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(invalid.status_code, 400)

    def test_staff_store_scope_and_cash_pos_payment_refund_and_handover(self):
        shift_response = self.open_shift()
        self.assertEqual(shift_response.status_code, 201, shift_response.data)
        duplicate_shift = self.open_shift()
        self.assertEqual(duplicate_shift.status_code, 409)
        order = self.client.post(self.store_base + "orders/", {
            "idempotency_key": str(uuid.uuid4()), "lines": [{"menu_item_id": str(self.item.pk), "quantity": 2}],
        }, format="json")
        self.assertEqual(order.status_code, 201, order.data)
        close_while_unpaid = self.client.post(self.store_base + "pos-shift/close/", {"closing_cash": "50.00"}, format="json")
        self.assertEqual(close_while_unpaid.status_code, 400)
        for action, expected in [("accept", "accepted"), ("prepare", "preparing"), ("ready", "ready"), ("serve", "served")]:
            order = self.client.post(self.base + f"restaurant/orders/{order.data['id']}/{action}/", {}, format="json")
            self.assertEqual(order.data["status"], expected)
        payment_key = str(uuid.uuid4())
        payment_path = self.base + f"restaurant/orders/{order.data['id']}/pay-cash/"
        payment = self.client.post(payment_path, {"idempotency_key": payment_key}, format="json")
        self.assertEqual(payment.status_code, 201, payment.data)
        replay = self.client.post(payment_path, {"idempotency_key": payment_key}, format="json")
        self.assertEqual(replay.data["id"], payment.data["id"])
        self.assertEqual(PaymentEvent.objects.count(), 1)
        refund_path = self.base + f"restaurant/orders/{order.data['id']}/refund-cash/"
        refund = self.client.post(refund_path, {"idempotency_key": str(uuid.uuid4()), "amount": "25.00", "reason": "Missing side"}, format="json")
        self.assertEqual(refund.status_code, 201, refund.data)
        self.assertEqual(Order.objects.get(pk=order.data["id"]).payment_status, Order.PaymentStatus.PARTIALLY_REFUNDED)
        excessive = self.client.post(refund_path, {"idempotency_key": str(uuid.uuid4()), "amount": "226.00", "reason": "Too much"}, format="json")
        self.assertEqual(excessive.status_code, 400)
        full_refund = self.client.post(refund_path, {"idempotency_key": str(uuid.uuid4()), "amount": "225.00", "reason": "Remaining"}, format="json")
        self.assertEqual(full_refund.status_code, 201, full_refund.data)
        self.assertEqual(Order.objects.get(pk=order.data["id"]).payment_status, Order.PaymentStatus.REFUNDED)
        close = self.client.post(self.store_base + "pos-shift/close/", {"closing_cash": "50.00"}, format="json")
        self.assertEqual(close.status_code, 200, close.data)
        self.assertEqual(close.data["cash_variance"], "0.00")
        self.assertEqual(PaymentEvent.objects.count(), 3)

    def test_cashier_can_operate_assigned_store_but_cannot_refund_or_cross_store(self):
        self.assertEqual(self.open_shift().status_code, 201)
        client = APIClient()
        client.force_authenticate(self.cashier_user)
        order = client.post(self.store_base + "orders/", {
            "idempotency_key": str(uuid.uuid4()), "lines": [{"menu_item_id": str(self.item.pk), "quantity": 1}],
        }, format="json")
        self.assertEqual(order.status_code, 201, order.data)
        payment = client.post(self.base + f"restaurant/orders/{order.data['id']}/pay-cash/", {"idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(payment.status_code, 201)
        refund = client.post(self.base + f"restaurant/orders/{order.data['id']}/refund-cash/", {"idempotency_key": str(uuid.uuid4()), "amount": "10.00", "reason": "Return"}, format="json")
        self.assertEqual(refund.status_code, 403)
        cross_store = client.get(f"/api/v1/tenants/{self.tenant.pk}/stores/{self.other_store.pk}/restaurant/pos-shift/")
        self.assertEqual(cross_store.status_code, 403)

    def test_cash_received_refund_and_order_lines_are_append_only(self):
        self.open_shift()
        order = self.client.post(self.store_base + "orders/", {
            "idempotency_key": str(uuid.uuid4()), "lines": [{"menu_item_id": str(self.item.pk), "quantity": 1}],
        }, format="json").data
        self.client.post(self.base + f"restaurant/orders/{order['id']}/pay-cash/", {"idempotency_key": str(uuid.uuid4())}, format="json")
        event = PaymentEvent.objects.get()
        with self.assertRaises(DatabaseError), transaction.atomic():
            event.delete()
        with self.assertRaises(DatabaseError), transaction.atomic():
            PaymentEvent.objects.filter(pk=event.pk).update(amount=Decimal("0.01"))
        with self.assertRaises(DatabaseError), transaction.atomic():
            OrderLine.objects.filter(order_id=order["id"]).update(quantity=10)

    def test_viewer_cannot_manage_menu_or_open_shift_and_store_must_match_tenant(self):
        client = APIClient()
        client.force_authenticate(self.cashier_user)
        denied = client.post(self.base + "restaurant/categories/", {"code": "DRINK", "name": "Drink"}, format="json")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(client.post(self.store_base + "pos-shift/open/", {"opening_float": "0.00"}, format="json").status_code, 403)
        bad_store = self.client.post(f"/api/v1/tenants/{self.tenant.pk}/stores/{self.foreign_store.pk}/restaurant/tables/", {"code": "F", "name": "Foreign"}, format="json")
        self.assertIn(bad_store.status_code, [400, 404])
