import json
from datetime import date
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
import uuid
from django.contrib.auth import get_user_model
from django.test import LiveServerTestCase, override_settings
from .models import Membership, Tenant


@override_settings(SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False)
class SessionHTTPTests(LiveServerTestCase):
    def test_real_http_csrf_login_tenant_access_and_logout(self):
        user = get_user_model().objects.create_user(username="http-test", password="HTTP-only-test-pass-429!")
        tenant = Tenant.objects.create(name="HTTP tenant", slug="http-tenant")
        membership = Membership.objects.create(tenant=tenant, user=user, role="admin")
        client = build_opener(HTTPCookieProcessor(CookieJar()))

        def request(path, payload=None, token=None):
            headers = {"Content-Type": "application/json"}
            if token:
                headers["X-CSRFToken"] = token
            req = Request(self.live_server_url + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
            with client.open(req, timeout=10) as response:
                return json.load(response)

        token = request("/api/v1/auth/csrf/")["csrfToken"]
        with self.assertRaises(HTTPError) as blocked:
            request("/api/v1/auth/login/", {"username": "http-test", "password": "HTTP-only-test-pass-429!"})
        self.assertEqual(blocked.exception.code, 403)
        blocked.exception.close()
        login = request("/api/v1/auth/login/", {"username": "http-test", "password": "HTTP-only-test-pass-429!"}, token)
        self.assertEqual(request("/api/v1/auth/me/")["username"], "http-test")
        created = request(f"/api/v1/tenants/{tenant.pk}/stores/", {"name": "HTTP store", "code": "http"}, login["csrfToken"])
        self.assertEqual(created["code"], "http")
        self.assertEqual(request(f"/api/v1/tenants/{tenant.pk}/stores/")["count"], 1)
        base = f"/api/v1/tenants/{tenant.pk}/wms"
        product = request(f"{base}/products/", {"code": "HTTP-PART", "name": "HTTP part"}, login["csrfToken"])
        warehouse = request(f"{base}/warehouses/", {"code": "HTTP-WH", "name": "HTTP warehouse"}, login["csrfToken"])
        warehouse_detail = request(f"{base}/warehouses/{warehouse['id']}/")
        package = request(f"{base}/products/{product['id']}/units/")["results"][0]
        location = warehouse_detail["locations"][0]
        document = request(f"{base}/documents/", {
            "kind": "receipt", "warehouse_id": warehouse["id"], "document_code": "HTTP-RECEIPT",
            "idempotency_key": str(uuid.uuid4()),
            "lines": [{"product_id": product["id"], "package_unit_id": package["id"], "location_id": location["id"], "quantity": 2}],
        }, login["csrfToken"])
        posted = request(f"{base}/documents/{document['id']}/post/", {}, login["csrfToken"])
        self.assertEqual(posted["status"], "posted")
        self.assertEqual(request(f"{base}/balances/")["results"][0]["quantity"], 2)
        hr = f"/api/v1/tenants/{tenant.pk}/hr"
        employee = request(f"{hr}/employees/", {
            "code": "HTTP-HR", "display_name": "HTTP Employee", "membership_id": str(membership.pk),
        }, login["csrfToken"])
        shift = request(f"{hr}/shifts/", {
            "code": "HTTP-DAY", "name": "Day", "start_time": "09:00", "end_time": "18:00", "timezone_name": "Asia/Taipei",
        }, login["csrfToken"])
        assignment = request(f"{hr}/assignments/", {
            "employee_id": employee["id"], "shift_id": shift["id"], "work_date": date.today().isoformat(),
        }, login["csrfToken"])
        with self.assertRaises(HTTPError) as csrf_blocked:
            request(f"{hr}/assignments/{assignment['id']}/clock-in/", {"idempotency_key": str(uuid.uuid4())})
        self.assertEqual(csrf_blocked.exception.code, 403)
        csrf_blocked.exception.close()
        punched = request(f"{hr}/assignments/{assignment['id']}/clock-in/", {
            "idempotency_key": str(uuid.uuid4()),
        }, login["csrfToken"])
        self.assertEqual(punched["kind"], "clock_in")
        request("/api/v1/auth/logout/", {}, login["csrfToken"])
        with self.assertRaises(HTTPError) as denied:
            request("/api/v1/auth/me/")
        self.assertEqual(denied.exception.code, 403)
        denied.exception.close()
