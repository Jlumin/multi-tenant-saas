"""Public CRM application contracts for cross-module use."""
from rest_framework.exceptions import ValidationError

from .models import Customer


def customer_snapshot(*, tenant_id, customer_id):
    customer = Customer.objects.filter(tenant_id=tenant_id, pk=customer_id, is_active=True).first()
    if customer is None:
        raise ValidationError("Customer is unavailable in this tenant.")
    return {"customer_id": customer.pk, "name": customer.name, "email": customer.email}
