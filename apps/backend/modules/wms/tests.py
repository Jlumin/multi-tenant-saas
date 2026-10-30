from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
import uuid

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from platform_core.models import AuditEvent, Membership, Tenant
from .models import (
    InventoryDocument,
    InventoryDocumentLine,
    Location,
    PackageUnit,
    Product,
    StockBalance,
    StockMovement,
    Warehouse,
)


class WmsApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin_user = User.objects.create_user(username="wms-admin", password="Test-admin-password-991!")
        cls.manager_user = User.objects.create_user(username="wms-manager", password="Test-manager-password-991!")
        cls.viewer_user = User.objects.create_user(username="wms-viewer", password="Test-viewer-password-991!")
        cls.other_user = User.objects.create_user(username="wms-other", password="Test-other-password-991!")
        cls.tenant = Tenant.objects.create(name="WMS Tenant A", slug="wms-tenant-a")
        cls.other_tenant = Tenant.objects.create(name="WMS Tenant B", slug="wms-tenant-b")
        cls.admin = Membership.objects.create(tenant=cls.tenant, user=cls.admin_user, role="admin")
        cls.manager = Membership.objects.create(tenant=cls.tenant, user=cls.manager_user, role="manager")
        cls.viewer = Membership.objects.create(tenant=cls.tenant, user=cls.viewer_user, role="viewer")
        Membership.objects.create(tenant=cls.other_tenant, user=cls.other_user, role="admin")
        cls.product = Product.objects.create(tenant=cls.tenant, code="PART-1", name="Part One")
        cls.base_unit = PackageUnit.objects.create(tenant=cls.tenant, product=cls.product, code="BASE", name="PCS", base_quantity=1, is_base=True)
        cls.box_unit = PackageUnit.objects.create(tenant=cls.tenant, product=cls.product, code="BOX", name="Box of 10", base_quantity=10)
        cls.warehouse = Warehouse.objects.create(tenant=cls.tenant, code="NORTH", name="North warehouse")
        cls.location = Location.objects.create(tenant=cls.tenant, warehouse=cls.warehouse, code="UNASSIGNED", name="Unassigned", is_default=True)
        cls.bin_location = Location.objects.create(tenant=cls.tenant, warehouse=cls.warehouse, code="A-01", name="Aisle A / shelf 1")
        cls.other_product = Product.objects.create(tenant=cls.other_tenant, code="PART-1", name="Other tenant part")
        cls.other_wh = Warehouse.objects.create(tenant=cls.other_tenant, code="NORTH", name="Other warehouse")
        cls.other_location = Location.objects.create(tenant=cls.other_tenant, warehouse=cls.other_wh, code="UNASSIGNED", name="Unassigned", is_default=True)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)

    def url(self, suffix, tenant=None):
        return f"/api/v1/tenants/{(tenant or self.tenant).pk}/wms/{suffix}/"

    def receipt(self, quantity=2, *, product=None, location=None, unit=None, key=None, code=None):
        payload = {
            "kind": "receipt", "warehouse_id": str(self.warehouse.pk),
            "document_code": code or f"RCV-{uuid.uuid4().hex[:8]}",
            "idempotency_key": str(key or uuid.uuid4()),
            "lines": [{"product_id": str((product or self.product).pk),
                       "package_unit_id": str((unit or self.base_unit).pk),
                       "location_id": str((location or self.location).pk), "quantity": quantity}],
        }
        return self.client.post(self.url("documents"), payload, format="json")

    def test_product_creation_makes_base_unit_and_admin_is_required(self):
        response = self.client.post(self.url("products"), {"code": "bolt-2", "name": "Bolt", "base_unit": "PCS"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        created = Product.objects.get(pk=response.data["id"])
        self.assertEqual(created.code, "BOLT-2")
        self.assertEqual(created.package_units.get(is_base=True).base_quantity, 1)
        self.assertTrue(AuditEvent.objects.filter(tenant=self.tenant, action="wms.product.created", target_id=str(created.pk)).exists())
        self.client.force_authenticate(self.manager_user)
        self.assertEqual(self.client.post(self.url("products"), {"code": "BOLT-3", "name": "Bolt"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.url("products"), {"code": "BOLT-3", "name": "Bolt", "tenant_id": str(self.other_tenant.pk)}, format="json").status_code, 400)

    def test_product_optimistic_version_and_active_stock_guard(self):
        self.assertEqual(self.client.patch(self.url(f"products/{self.product.pk}"), {"version": 99, "name": "Stale"}, format="json").status_code, 409)
        receipt = self.receipt(quantity=1)
        self.client.post(self.url(f"documents/{receipt.data['id']}/post"), {}, format="json")
        response = self.client.patch(self.url(f"products/{self.product.pk}"), {"version": self.product.version, "is_active": False}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_product_cross_tenant_details_and_nonmember_listing_are_hidden(self):
        self.assertEqual(self.client.get(self.url(f"products/{self.other_product.pk}")).status_code, 404)
        self.assertEqual(self.client.get(self.url("products", self.other_tenant)).status_code, 404)
        anon = APIClient()
        self.assertEqual(anon.get(self.url("products")).status_code, 403)

    def test_warehouse_creation_creates_default_location_and_scopes_children(self):
        response = self.client.post(self.url("warehouses"), {"code": "WEST", "name": "West depot"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        warehouse = Warehouse.objects.get(pk=response.data["id"])
        default = warehouse.locations.get(is_default=True)
        self.assertEqual(default.code, "UNASSIGNED")
        self.assertEqual(default.name, "未分配儲位")
        self.assertEqual(self.client.get(self.url(f"warehouses/{self.other_wh.pk}")).status_code, 404)
        self.client.force_authenticate(self.viewer_user)
        self.assertEqual(self.client.post(self.url("warehouses"), {"code": "OTHER", "name": "No"}, format="json").status_code, 403)

    def test_integer_package_conversion_and_invalid_unit_or_location_are_rejected(self):
        draft = self.receipt(quantity=3, unit=self.box_unit, location=self.bin_location)
        self.assertEqual(draft.status_code, 201, draft.data)
        self.assertEqual(draft.data["lines"][0]["conversion_snapshot"], 10)
        self.assertEqual(draft.data["lines"][0]["base_quantity"], 30)
        payload = {
            "kind": "receipt", "warehouse_id": str(self.warehouse.pk), "document_code": "BAD-DECIMAL",
            "idempotency_key": str(uuid.uuid4()),
            "lines": [{"product_id": str(self.product.pk), "package_unit_id": str(self.base_unit.pk),
                       "location_id": str(self.location.pk), "quantity": 1.5}],
        }
        self.assertEqual(self.client.post(self.url("documents"), payload, format="json").status_code, 400)
        payload["document_code"] = "BAD-UNIT"
        payload["idempotency_key"] = str(uuid.uuid4())
        payload["lines"][0]["package_unit_id"] = str(self.box_unit.pk)
        payload["lines"][0]["product_id"] = str(self.other_product.pk)
        self.assertEqual(self.client.post(self.url("documents"), payload, format="json").status_code, 400)

    def test_package_unit_activation_is_admin_only_and_base_unit_is_protected(self):
        base_url = self.url(f"products/{self.product.pk}/units/{self.base_unit.pk}")
        self.assertEqual(self.client.patch(base_url, {"is_active": False}, format="json").status_code, 400)
        self.client.force_authenticate(self.manager_user)
        package_url = self.url(f"products/{self.product.pk}/units/{self.box_unit.pk}")
        self.assertEqual(self.client.patch(package_url, {"is_active": False}, format="json").status_code, 403)
        self.client.force_authenticate(self.admin_user)
        draft = self.receipt(quantity=2, unit=self.box_unit)
        blocked = self.client.patch(package_url, {"is_active": False}, format="json")
        self.assertEqual(blocked.status_code, 400)
        self.client.post(self.url(f"documents/{draft.data['id']}/cancel"), {}, format="json")
        deactivated = self.client.patch(package_url, {"is_active": False}, format="json")
        self.assertEqual(deactivated.status_code, 200, deactivated.data)
        self.assertFalse(deactivated.data["is_active"])

    def test_manager_can_draft_but_only_admin_can_post(self):
        self.client.force_authenticate(self.manager_user)
        draft = self.receipt(quantity=2)
        self.assertEqual(draft.status_code, 201, draft.data)
        action_url = self.url(f"documents/{draft.data['id']}/post")
        self.assertEqual(self.client.post(action_url, {}, format="json").status_code, 403)
        self.client.force_authenticate(self.admin_user)
        posted = self.client.post(action_url, {}, format="json")
        self.assertEqual(posted.status_code, 200, posted.data)
        self.assertEqual(posted.data["status"], "posted")
        self.assertEqual(self.client.post(action_url, {}, format="json").status_code, 200)
        self.assertEqual(StockBalance.objects.get(product=self.product, location=self.location).quantity, 2)
        self.assertEqual(StockMovement.objects.filter(document_id=draft.data["id"]).count(), 1)

    def test_receipt_issue_and_no_negative_stock(self):
        receipt = self.receipt(quantity=30, unit=self.box_unit)
        self.assertEqual(receipt.status_code, 201, receipt.data)
        self.assertEqual(self.client.post(self.url(f"documents/{receipt.data['id']}/post"), {}, format="json").status_code, 200)
        issue_data = {
            "kind": "issue", "warehouse_id": str(self.warehouse.pk), "document_code": "ISSUE-1",
            "idempotency_key": str(uuid.uuid4()),
            "lines": [{"product_id": str(self.product.pk), "package_unit_id": str(self.box_unit.pk),
                       "location_id": str(self.location.pk), "quantity": 2}],
        }
        issue = self.client.post(self.url("documents"), issue_data, format="json")
        self.assertEqual(issue.status_code, 201, issue.data)
        self.assertEqual(self.client.post(self.url(f"documents/{issue.data['id']}/post"), {}, format="json").status_code, 200)
        balance = StockBalance.objects.get(product=self.product, location=self.location)
        self.assertEqual(balance.quantity, 280)
        self.assertEqual(StockMovement.objects.filter(tenant=self.tenant).count(), 2)
        issue_data["document_code"] = "ISSUE-TOO-MUCH"
        issue_data["idempotency_key"] = str(uuid.uuid4())
        issue_data["lines"][0]["quantity"] = 29
        too_much = self.client.post(self.url("documents"), issue_data, format="json")
        self.assertEqual(too_much.status_code, 201)
        rejected = self.client.post(self.url(f"documents/{too_much.data['id']}/post"), {}, format="json")
        self.assertEqual(rejected.status_code, 400)
        balance.refresh_from_db()
        self.assertEqual(balance.quantity, 280)
        self.assertEqual(StockMovement.objects.filter(document_id=too_much.data["id"]).count(), 0)

    def test_idempotent_document_replay_and_conflicting_payload(self):
        key = uuid.uuid4()
        first = self.receipt(quantity=4, key=key, code="IDEMPOTENT-1")
        replay = self.receipt(quantity=4, key=key, code="IDEMPOTENT-1")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(first.data["id"], replay.data["id"])
        code_conflict = self.receipt(quantity=4, key=key, code="IDEMPOTENT-OTHER-CODE")
        self.assertEqual(code_conflict.status_code, 409)
        conflict = self.receipt(quantity=5, key=key, code="IDEMPOTENT-1")
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(InventoryDocument.objects.filter(tenant=self.tenant, idempotency_key=key).count(), 1)

    def test_audit_failure_rolls_back_document_and_lines(self):
        with patch("modules.wms.services.audit", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError):
                self.receipt(code="ROLLBACK-1")
        self.assertFalse(InventoryDocument.objects.filter(document_code="ROLLBACK-1").exists())
        self.assertFalse(InventoryDocumentLine.objects.filter(document__document_code="ROLLBACK-1").exists())

    def test_posted_document_lines_and_movements_are_database_append_only(self):
        response = self.receipt(code="IMMUTABLE-1")
        self.client.post(self.url(f"documents/{response.data['id']}/post"), {}, format="json")
        line = InventoryDocumentLine.objects.get(document_id=response.data["id"])
        movement = StockMovement.objects.get(line=line)
        with self.assertRaises(DatabaseError), transaction.atomic():
            InventoryDocumentLine.objects.filter(pk=line.pk).update(quantity=5)
        with self.assertRaises(DatabaseError), transaction.atomic():
            StockMovement.objects.filter(pk=movement.pk).delete()
        with self.assertRaises(DatabaseError), transaction.atomic():
            InventoryDocument.objects.filter(pk=response.data["id"]).update(status="draft")

    def test_stock_query_is_tenant_scoped_and_returns_history(self):
        response = self.receipt(quantity=7)
        self.client.post(self.url(f"documents/{response.data['id']}/post"), {}, format="json")
        balances = self.client.get(self.url("balances"))
        self.assertEqual(balances.status_code, 200)
        self.assertEqual(balances.data["count"], 1)
        self.assertEqual(balances.data["results"][0]["quantity"], 7)
        self.assertEqual(self.client.get(self.url("balances", self.other_tenant)).status_code, 404)
        movements = self.client.get(self.url("movements"))
        self.assertEqual(movements.data["count"], 1)
        self.assertEqual(movements.data["results"][0]["quantity_delta"], 7)

    def test_package_conversion_and_tenant_relationship_guards(self):
        with self.assertRaises(DatabaseError), transaction.atomic():
            PackageUnit.objects.create(tenant=self.tenant, product=self.other_product, code="FOREIGN", name="Bad", base_quantity=2)
        with self.assertRaises(DatabaseError), transaction.atomic():
            Location.objects.filter(pk=self.location.pk).update(tenant=self.other_tenant)
        with self.assertRaises(DatabaseError), transaction.atomic():
            InventoryDocument.objects.create(tenant=self.tenant, warehouse=self.other_wh, kind="receipt", document_code="BAD", idempotency_key=uuid.uuid4(), payload_digest="x", created_by=self.admin)


class WmsConcurrentPostingTests(TransactionTestCase):
    reset_sequences = True

    def test_concurrent_issues_cannot_oversell_stock(self):
        user1 = get_user_model().objects.create_user(username="concurrent-wms-1")
        user2 = get_user_model().objects.create_user(username="concurrent-wms-2")
        tenant = Tenant.objects.create(name="Concurrent WMS", slug="concurrent-wms")
        admin1 = Membership.objects.create(tenant=tenant, user=user1, role="admin")
        Membership.objects.create(tenant=tenant, user=user2, role="admin")
        product = Product.objects.create(tenant=tenant, code="RACE", name="Race item")
        unit = PackageUnit.objects.create(tenant=tenant, product=product, code="BASE", name="PCS", base_quantity=1, is_base=True)
        warehouse = Warehouse.objects.create(tenant=tenant, code="RACE-WH", name="Race warehouse")
        location = Location.objects.create(tenant=tenant, warehouse=warehouse, code="UNASSIGNED", name="Unassigned", is_default=True)
        receipt = InventoryDocument.objects.create(tenant=tenant, warehouse=warehouse, kind="receipt", document_code="RACE-R", idempotency_key=uuid.uuid4(), payload_digest="r", created_by=admin1)
        line = InventoryDocumentLine.objects.create(tenant=tenant, document=receipt, product=product, package_unit=unit, location=location, quantity=5, conversion_snapshot=1, base_quantity=5)
        receipt.refresh_from_db()
        # Seed only through the same authorized posting service used by HTTP flows.
        from .services import post_document
        class RequestWrapper:
            def __init__(self, user):
                self.user = user
                self.request_id = "seed"
        post_document(RequestWrapper(user1), tenant.pk, receipt.pk)

        docs = []
        for index in (1, 2):
            doc = InventoryDocument.objects.create(tenant=tenant, warehouse=warehouse, kind="issue", document_code=f"RACE-I{index}", idempotency_key=uuid.uuid4(), payload_digest=f"i{index}", created_by=admin1)
            InventoryDocumentLine.objects.create(tenant=tenant, document=doc, product=product, package_unit=unit, location=location, quantity=4, conversion_snapshot=1, base_quantity=4)
            docs.append(doc.pk)
        barrier = Barrier(2)

        def post(document_id, user):
            try:
                class RequestWrapper:
                    def __init__(self, user):
                        self.user = user
                        self.request_id = "race"
                barrier.wait(timeout=10)
                post_document(RequestWrapper(user), tenant.pk, document_id)
                return "posted"
            except Exception:
                return "rejected"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda item: post(item[0], item[1]), [(docs[0], user1), (docs[1], user2)]))
        self.assertEqual(sorted(results), ["posted", "rejected"])
        self.assertEqual(StockBalance.objects.get(tenant=tenant, product=product, warehouse=warehouse, location=location).quantity, 1)
        self.assertEqual(StockMovement.objects.filter(tenant=tenant, document__kind="issue").count(), 1)

