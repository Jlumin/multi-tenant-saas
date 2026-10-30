from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.exceptions import APIException

from platform_core.access import membership_for
from platform_core.models import Tenant
from platform_core.services import audit
from .models import ConsentEvent, Customer


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "The resource changed; reload and try again."


def _writer(request, tenant_id):
    member = membership_for(request, tenant_id)
    if member.role == "viewer":
        audit(request, "access.denied", tenant=member.tenant)
        raise PermissionDenied("A manager or tenant administrator role is required.")
    return member


def reader_for(request, tenant_id):
    member = membership_for(request, tenant_id)
    if member.role == "viewer":
        audit(request, "access.denied", tenant=member.tenant)
        raise PermissionDenied("CRM customer personal data requires a manager or tenant administrator role.")
    return member


@transaction.atomic
def create_customer(request, tenant_id, data):
    member = _writer(request, tenant_id)
    customer = Customer(tenant=member.tenant, **data)
    try:
        customer.save()
    except IntegrityError as exc:
        raise ValidationError({"code": "Customer code already exists in this tenant."}) from exc
    audit(request, "crm.customer.created", tenant=member.tenant, target=customer.pk)
    return customer


@transaction.atomic
def update_customer(request, tenant_id, customer_id, data):
    member = _writer(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
    customer = get_object_or_404(Customer, tenant=tenant, pk=customer_id)
    version = data.pop("version")
    if version != customer.version:
        raise Conflict("This customer was changed by someone else. Refresh and retry.")
    if customer.is_active and data.get("is_active") is False:
        # Keep history and identifiers; deactivation is a reversible soft state.
        pass
    for key, value in data.items():
        setattr(customer, key, value)
    customer.version += 1
    try:
        customer.save()
    except IntegrityError as exc:
        raise ValidationError({"code": "Customer code already exists in this tenant."}) from exc
    audit(request, "crm.customer.updated", tenant=tenant, target=customer.pk)
    return customer


@transaction.atomic
def record_consent(request, tenant_id, customer_id, data):
    member = _writer(request, tenant_id)
    customer = get_object_or_404(Customer, tenant=member.tenant, pk=customer_id)
    if not customer.is_active:
        raise ValidationError("Consent cannot be recorded for an inactive customer.")
    event = ConsentEvent.objects.create(
        tenant=member.tenant, customer=customer, recorded_by=member, **data,
    )
    audit(request, "crm.consent.recorded", tenant=member.tenant, target=event.pk)
    return event
