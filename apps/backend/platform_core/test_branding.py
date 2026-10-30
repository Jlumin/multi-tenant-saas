import base64
from io import BytesIO
import tempfile
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from PIL import Image

from .models import Membership, Tenant, TenantBranding


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNUyIhmYGBgYmBgYGBgAAAKkwDnCDDOygAAAABJRU5ErkJggg==")


class TenantBrandingApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin_user = User.objects.create_user(username="brand-admin", password="Brand-admin-pass-991!")
        cls.manager_user = User.objects.create_user(username="brand-manager", password="Brand-manager-pass-991!")
        cls.other_user = User.objects.create_user(username="brand-other", password="Brand-other-pass-991!")
        cls.tenant = Tenant.objects.create(name="Brand Tenant A", slug="brand-tenant-a")
        cls.other_tenant = Tenant.objects.create(name="Brand Tenant B", slug="brand-tenant-b")
        Membership.objects.create(tenant=cls.tenant, user=cls.admin_user, role=Membership.Role.ADMIN)
        Membership.objects.create(tenant=cls.tenant, user=cls.manager_user, role=Membership.Role.MANAGER)
        Membership.objects.create(tenant=cls.other_tenant, user=cls.other_user, role=Membership.Role.ADMIN)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin_user)
        self.base = f"/api/v1/tenants/{self.tenant.pk}"

    def test_brand_defaults_are_tenant_scoped_and_read_does_not_create_data(self):
        response = self.client.get(f"{self.base}/branding/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["brand_name"], self.tenant.name)
        self.assertEqual(response.data["primary_color"], "#17675B")
        self.assertIsNone(response.data["logo_url"])
        self.assertFalse(TenantBranding.objects.filter(tenant=self.tenant).exists())
        self.assertEqual(self.client.get(f"/api/v1/tenants/{self.other_tenant.pk}/branding/").status_code, 404)

    def test_brand_settings_validate_colors_unknown_fields_and_require_admin(self):
        response = self.client.patch(f"{self.base}/branding/", {"brand_name": "Acme Parts", "primary_color": "#00aa77"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["brand_name"], "Acme Parts")
        self.assertEqual(response.data["primary_color"], "#00AA77")
        self.assertEqual(self.client.patch(f"{self.base}/branding/", {"primary_color": "red"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"{self.base}/branding/", {"tenant_id": str(self.tenant.pk)}, format="json").status_code, 400)
        self.client.force_authenticate(self.manager_user)
        self.assertEqual(self.client.patch(f"{self.base}/branding/", {"brand_name": "No"}, format="json").status_code, 403)

    def test_logo_upload_read_replace_delete_and_tenant_isolation(self):
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            url = f"{self.base}/branding/logo/"
            upload = SimpleUploadedFile("../../brand.png", PNG, content_type="image/png")
            response = self.client.post(url, {"image": upload}, format="multipart")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(response.data["logo_url"].startswith(url))
            stored = TenantBranding.objects.get(tenant=self.tenant).logo.name
            self.assertTrue(stored.startswith(f"tenants/{self.tenant.pk}/brand/"))
            image = self.client.get(url)
            self.assertEqual(image.status_code, 200)
            self.assertEqual(image["Content-Type"], "image/png")
            self.assertIn("private", image["Cache-Control"])
            self.client.force_authenticate(self.manager_user)
            self.assertEqual(self.client.get(url).status_code, 200)
            self.assertEqual(self.client.delete(url).status_code, 403)
            self.client.force_authenticate(self.other_user)
            self.assertEqual(self.client.get(url).status_code, 404)
            self.client.force_authenticate(self.admin_user)
            invalid = self.client.post(url, {"image": SimpleUploadedFile("not.png", b"not an image", content_type="image/png")}, format="multipart")
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(self.client.delete(url).status_code, 204)
            self.assertFalse(TenantBranding.objects.get(tenant=self.tenant).logo)

    def test_logo_upload_requires_authentication_and_csrf_for_session(self):
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            client = APIClient(enforce_csrf_checks=True)
            csrf = client.get("/api/v1/auth/csrf/").data["csrfToken"]
            login = client.post("/api/v1/auth/login/", {"username": "brand-admin", "password": "Brand-admin-pass-991!"}, format="json", HTTP_X_CSRFTOKEN=csrf)
            self.assertEqual(login.status_code, 200, login.data)
            url = f"{self.base}/branding/logo/"
            upload = {"image": SimpleUploadedFile("brand.png", PNG, content_type="image/png")}
            self.assertEqual(client.post(url, upload, format="multipart").status_code, 403)
            csrf = login.data["csrfToken"]
            upload = {"image": SimpleUploadedFile("brand.png", PNG, content_type="image/png")}
            self.assertEqual(client.post(url, upload, format="multipart", HTTP_X_CSRFTOKEN=csrf).status_code, 200)

    def test_logo_upload_rejects_oversized_file_and_dimensions(self):
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            url = f"{self.base}/branding/logo/"
            too_large = self.client.post(
                url,
                {"image": SimpleUploadedFile("large.png", PNG + (b"x" * (5 * 1024 * 1024)), content_type="image/png")},
                format="multipart",
            )
            self.assertEqual(too_large.status_code, 400, too_large.data)

            image_bytes = BytesIO()
            Image.new("RGB", (4097, 1), "white").save(image_bytes, format="PNG")
            too_wide = self.client.post(
                url,
                {"image": SimpleUploadedFile("wide.png", image_bytes.getvalue(), content_type="image/png")},
                format="multipart",
            )
            self.assertEqual(too_wide.status_code, 400, too_wide.data)
