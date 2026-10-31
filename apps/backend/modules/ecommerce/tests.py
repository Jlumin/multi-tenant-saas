import uuid
import base64
import tempfile

from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from platform_core.models import Membership, Tenant, TenantBranding
from modules.crm.models import Customer
from modules.wms.models import Location, PackageUnit, Product, StockBalance, StockMovement, Warehouse, StockReservation
from modules.wms.application import available_quantity
from .models import Listing, Order, Payment


class EcommerceFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin_user = User.objects.create_user(username="shop-admin", password="Test-admin-password-991!")
        cls.viewer_user = User.objects.create_user(username="shop-viewer", password="Test-viewer-password-991!")
        cls.other_user = User.objects.create_user(username="shop-other", password="Test-other-password-991!")
        cls.tenant = Tenant.objects.create(name="Shop Tenant", slug="shop-tenant")
        cls.other_tenant = Tenant.objects.create(name="Other Shop", slug="other-shop")
        cls.admin = Membership.objects.create(tenant=cls.tenant, user=cls.admin_user, role="admin")
        cls.viewer = Membership.objects.create(tenant=cls.tenant, user=cls.viewer_user, role="viewer")
        Membership.objects.create(tenant=cls.other_tenant, user=cls.other_user, role="admin")
        cls.customer = Customer.objects.create(tenant=cls.tenant, code="C-01", name="Shopper", email="shopper@example.com")
        cls.product = Product.objects.create(tenant=cls.tenant, code="PART-01", name="Widget")
        cls.base = PackageUnit.objects.create(tenant=cls.tenant, product=cls.product, code="BASE", name="PCS", base_quantity=1, is_base=True)
        cls.warehouse = Warehouse.objects.create(tenant=cls.tenant, code="WH-A", name="Warehouse A")
        cls.location = Location.objects.create(tenant=cls.tenant, warehouse=cls.warehouse, code="A-01", name="Shelf A1")
        cls.other_warehouse = Warehouse.objects.create(tenant=cls.tenant, code="WH-B", name="Warehouse B")
        cls.other_location = Location.objects.create(tenant=cls.tenant, warehouse=cls.other_warehouse, code="B-01", name="Shelf B1")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)
        self.tenant_path = f"/api/v1/tenants/{self.tenant.pk}/"
        self._receive(self.warehouse, self.location, 10, "RCV-A")
        self._receive(self.other_warehouse, self.other_location, 2, "RCV-B")

    def _receive(self, warehouse, location, qty, code):
        result = self.client.post(self.tenant_path + "wms/documents/", {
            "kind": "receipt", "warehouse_id": str(warehouse.pk), "document_code": code,
            "idempotency_key": str(uuid.uuid4()),
            "lines": [{"product_id": str(self.product.pk), "package_unit_id": str(self.base.pk), "location_id": str(location.pk), "quantity": qty}],
        }, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        posted = self.client.post(self.tenant_path + f"wms/documents/{result.data['id']}/post/", {}, format="json")
        self.assertEqual(posted.status_code, 200, posted.data)

    def _listing(self, warehouse=None, price="12.50", category=""):
        response = self.client.post(self.tenant_path + "ecommerce/listings/", {
            "product_id": str(self.product.pk), "warehouse_id": str((warehouse or self.warehouse).pk),
            "title": "Widget sale", "category": category, "currency": "TWD", "price": price,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def _order(self, listing, quantity=2, key=None):
        return self.client.post(self.tenant_path + "ecommerce/orders/", {
            "customer_id": str(self.customer.pk), "idempotency_key": str(key or uuid.uuid4()),
            "lines": [{"listing_id": listing["id"], "quantity": quantity}],
        }, format="json")

    def test_order_reserves_stock_and_sandbox_capture_consumes_it_once(self):
        listing = self._listing()
        order = self._order(listing, 3)
        self.assertEqual(order.status_code, 201, order.data)
        self.assertEqual(order.data["status"], "pending_payment")
        self.assertEqual(order.data["payment_provider"], "sandbox")
        self.assertEqual(available_quantity(tenant_id=self.tenant.pk, product_id=self.product.pk, warehouse_id=self.warehouse.pk), 7)
        self.assertEqual(StockBalance.objects.get(tenant=self.tenant, product=self.product, warehouse=self.warehouse).quantity, 10)
        capture_path = self.tenant_path + f"ecommerce/orders/{order.data['id']}/capture-sandbox-payment/"
        captured = self.client.post(capture_path, {}, format="json")
        self.assertEqual(captured.status_code, 200, captured.data)
        self.assertEqual(captured.data["status"], "paid")
        self.assertEqual(captured.data["payment_status"], "captured")
        self.assertEqual(StockBalance.objects.get(tenant=self.tenant, product=self.product, warehouse=self.warehouse).quantity, 7)
        self.assertEqual(StockReservation.objects.get(reference_id=order.data["id"]).status, "consumed")
        self.assertEqual(StockMovement.objects.filter(document__note__contains="E-Commerce fulfillment").count(), 1)
        replay = self.client.post(capture_path, {}, format="json")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(StockMovement.objects.filter(document__note__contains="E-Commerce fulfillment").count(), 1)

    def test_unavailable_stock_rejects_whole_order_and_does_not_create_order(self):
        listing = self._listing()
        response = self._order(listing, 11)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(available_quantity(tenant_id=self.tenant.pk, product_id=self.product.pk, warehouse_id=self.warehouse.pk), 10)

    def test_manual_wms_issue_cannot_consume_stock_reserved_for_an_order(self):
        listing = self._listing()
        order = self._order(listing, 8)
        self.assertEqual(order.status_code, 201, order.data)
        issue = self.client.post(self.tenant_path + "wms/documents/", {
            "kind": "issue", "warehouse_id": str(self.warehouse.pk), "document_code": "ISSUE-1",
            "idempotency_key": str(uuid.uuid4()),
            "lines": [{"product_id": str(self.product.pk), "package_unit_id": str(self.base.pk), "location_id": str(self.location.pk), "quantity": 3}],
        }, format="json")
        self.assertEqual(issue.status_code, 201, issue.data)
        posted = self.client.post(self.tenant_path + f"wms/documents/{issue.data['id']}/post/", {}, format="json")
        self.assertEqual(posted.status_code, 400)
        self.assertEqual(StockBalance.objects.get(tenant=self.tenant, product=self.product, warehouse=self.warehouse).quantity, 10)
        listing_response = self.client.get(self.tenant_path + "ecommerce/listings/")
        self.assertEqual(listing_response.status_code, 200)
        self.assertEqual(listing_response.data["results"][0]["available_quantity"], 2)

    def test_cancel_releases_reservation_and_replay_key_is_idempotent(self):
        listing = self._listing()
        key = uuid.uuid4()
        order = self._order(listing, 2, key)
        self.assertEqual(order.status_code, 201)
        replay = self._order(listing, 2, key)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(Order.objects.count(), 1)
        canceled = self.client.post(self.tenant_path + f"ecommerce/orders/{order.data['id']}/cancel/", {}, format="json")
        self.assertEqual(canceled.status_code, 200, canceled.data)
        self.assertEqual(StockReservation.objects.get(reference_id=order.data["id"]).status, "released")
        self.assertEqual(available_quantity(tenant_id=self.tenant.pk, product_id=self.product.pk, warehouse_id=self.warehouse.pk), 10)

    def test_separate_warehouse_listing_is_fulfilled_from_its_own_stock(self):
        listing = self._listing(self.other_warehouse)
        order = self._order(listing, 2)
        self.assertEqual(order.status_code, 201, order.data)
        captured = self.client.post(self.tenant_path + f"ecommerce/orders/{order.data['id']}/capture-sandbox-payment/", {}, format="json")
        self.assertEqual(captured.status_code, 200, captured.data)
        self.assertEqual(StockBalance.objects.get(tenant=self.tenant, product=self.product, warehouse=self.warehouse).quantity, 10)
        self.assertEqual(StockBalance.objects.get(tenant=self.tenant, product=self.product, warehouse=self.other_warehouse).quantity, 0)

    def test_cross_tenant_listing_is_rejected_and_viewers_cannot_write(self):
        response = self.client.post(self.tenant_path + "ecommerce/listings/", {
            "product_id": str(self.product.pk), "warehouse_id": str(self.other_warehouse.pk),
            "title": "No", "currency": "TWD", "price": "1.00", "tenant_id": str(self.other_tenant.pk),
        }, format="json")
        # Unknown request fields are rejected by the strict serializer.
        self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(self.viewer_user)
        self.assertEqual(self.client.get(self.tenant_path + "ecommerce/listings/").status_code, 200)
        self.assertEqual(self.client.get(self.tenant_path + "ecommerce/orders/").status_code, 403)
        self.assertEqual(self.client.post(self.tenant_path + "ecommerce/listings/", {
            "product_id": str(self.product.pk), "warehouse_id": str(self.warehouse.pk), "title": "No", "currency": "TWD", "price": "2.00",
        }, format="json").status_code, 403)
        self.assertEqual(APIClient().get(self.tenant_path + "ecommerce/orders/").status_code, 403)

    def test_idempotency_key_conflict_and_paid_order_cannot_be_canceled(self):
        listing = self._listing()
        key = uuid.uuid4()
        order = self._order(listing, 1, key)
        conflict = self._order(listing, 2, key)
        self.assertEqual(conflict.status_code, 409)
        self.client.post(self.tenant_path + f"ecommerce/orders/{order.data['id']}/capture-sandbox-payment/", {}, format="json")
        canceled = self.client.post(self.tenant_path + f"ecommerce/orders/{order.data['id']}/cancel/", {}, format="json")
        self.assertEqual(canceled.status_code, 409)

    def test_public_storefront_requires_opt_in_and_exposes_only_safe_catalog_fields(self):
        listing = self._listing()
        public = APIClient()
        endpoint = f"/api/v1/storefronts/{self.tenant.slug}/"
        self.assertEqual(public.get(endpoint).status_code, 404)

        brand = TenantBranding.objects.create(
            tenant=self.tenant, brand_name="Shop Tenant Public", primary_color="#114477",
            accent_color="#22AA77", storefront_enabled=True,
            storefront_heading="零件直送", storefront_description="適合你的維修與改裝需求。",
        )
        stock = StockBalance.objects.get(tenant=self.tenant, product=self.product, warehouse=self.warehouse, location=self.location)
        stock.quantity = 0
        stock.save(update_fields=["quantity", "updated_at"])

        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNUyIhmYGBgYmBgYGBgAAAKkwDnCDDOygAAAABJRU5ErkJggg==")
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            logo = self.client.post(f"/api/v1/tenants/{self.tenant.pk}/branding/logo/", {"image": SimpleUploadedFile("brand.png", png, content_type="image/png")}, format="multipart")
            self.assertEqual(logo.status_code, 200, logo.data)
            product_image = self.client.post(f"/api/v1/tenants/{self.tenant.pk}/wms/products/{self.product.pk}/image/", {"image": SimpleUploadedFile("product.png", png, content_type="image/png")}, format="multipart")
            self.assertEqual(product_image.status_code, 200, product_image.data)

            response = public.get(endpoint)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response["Cache-Control"], "public, max-age=60")
            self.assertEqual(response.data["brand_name"], "Shop Tenant Public")
            self.assertEqual(response.data["storefront_heading"], "零件直送")
            self.assertEqual(response.data["storefront_description"], "適合你的維修與改裝需求。")
            self.assertEqual(response.data["logo_url"], f"/api/v1/storefronts/{self.tenant.slug}/logo/")
            self.assertEqual(response.data["count"], 1)
            self.assertEqual(response.data["results"][0]["listing_id"], listing["id"])
            self.assertFalse(response.data["results"][0]["is_available"])
            self.assertEqual(response.data["results"][0]["product_image_url"], f"/api/v1/storefronts/{self.tenant.slug}/products/{self.product.pk}/image/")
            self.assertNotIn("available_quantity", response.data["results"][0])
            self.assertNotIn("customer_email", response.data)
            self.assertEqual(public.get(response.data["logo_url"]).status_code, 200)
            image = public.get(response.data["results"][0]["product_image_url"])
            self.assertEqual(image.status_code, 200)
            self.assertEqual(image["Cache-Control"], "public, max-age=300")

            # A different enabled tenant must not be able to expose this tenant's product image.
            TenantBranding.objects.create(tenant=self.other_tenant, storefront_enabled=True)
            other_catalog = public.get(f"/api/v1/storefronts/{self.other_tenant.slug}/")
            self.assertEqual(other_catalog.status_code, 200)
            self.assertEqual(other_catalog.data["count"], 0)
            self.assertEqual(other_catalog.data["brand_name"], self.other_tenant.name)
            self.assertEqual(other_catalog.data["storefront_heading"], "為你挑選的好物")
            cross_tenant_image = public.get(
                f"/api/v1/storefronts/{self.other_tenant.slug}/products/{self.product.pk}/image/",
            )
            self.assertEqual(cross_tenant_image.status_code, 404)

            brand.storefront_enabled = False
            brand.save(update_fields=["storefront_enabled", "updated_at"])
            self.assertEqual(public.get(endpoint).status_code, 404)
            self.assertEqual(public.get(f"/api/v1/storefronts/{self.tenant.slug}/products/{self.product.pk}/image/").status_code, 404)

    def test_public_storefront_search_is_limited_to_active_listings(self):
        listing = self._listing()
        TenantBranding.objects.create(tenant=self.tenant, storefront_enabled=True)
        response = APIClient().get(f"/api/v1/storefronts/{self.tenant.slug}/?q=missing")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)
        Listing.objects.filter(pk=listing["id"]).update(is_active=False)
        self.assertEqual(APIClient().get(f"/api/v1/storefronts/{self.tenant.slug}/").data["count"], 0)

    def test_public_storefront_lists_and_filters_categories(self):
        self._listing(category="底盤零件")
        self._listing(self.other_warehouse, category="電裝")
        TenantBranding.objects.create(tenant=self.tenant, storefront_enabled=True)
        public = APIClient()
        endpoint = f"/api/v1/storefronts/{self.tenant.slug}/"
        all_items = public.get(endpoint)
        self.assertEqual(all_items.data["categories"], ["底盤零件", "電裝"])
        filtered = public.get(endpoint, {"category": "電裝"})
        self.assertEqual(filtered.data["count"], 1)
        self.assertEqual(filtered.data["results"][0]["category"], "電裝")
        self.assertEqual(filtered.data["categories"], ["底盤零件", "電裝"])
        too_long = public.get(endpoint, {"category": "x" * 81})
        self.assertEqual(too_long.status_code, 400)

    def test_public_storefront_is_rate_limited(self):
        TenantBranding.objects.create(tenant=self.tenant, storefront_enabled=True)
        cache.clear()
        try:
            public = APIClient()
            endpoint = f"/api/v1/storefronts/{self.tenant.slug}/"
            for _ in range(60):
                self.assertEqual(public.get(endpoint).status_code, 200)
            self.assertEqual(public.get(endpoint).status_code, 429)
        finally:
            cache.clear()
