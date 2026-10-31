from unittest.mock import patch
from django.db.utils import OperationalError
from django.test import SimpleTestCase


class HealthTests(SimpleTestCase):
    def test_liveness_is_public_and_does_not_need_database(self):
        response = self.client.get("/api/v1/health/live/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    @patch("platform_core.views.connection")
    def test_readiness_success(self, connection):
        self.assertEqual(self.client.get("/api/v1/health/ready/").status_code, 200)
        connection.cursor.return_value.__enter__.return_value.execute.assert_called_once_with("SELECT 1")

    @patch("platform_core.views.connection")
    def test_readiness_hides_database_errors(self, connection):
        connection.cursor.side_effect = OperationalError("secret connection details")
        response = self.client.get("/api/v1/health/ready/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable"})

    def test_business_routes_are_not_exposed(self):
        for module in ("wms", "ecommerce", "crm", "hr", "restaurant"):
            self.assertEqual(self.client.get(f"/api/v1/{module}/").status_code, 404)
