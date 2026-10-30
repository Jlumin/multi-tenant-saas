"""Public platform identity contracts for business modules."""
from rest_framework.exceptions import ValidationError

from .access import membership_for
from .models import Membership
from .models import Store, StoreAccess


def current_membership(*, request, tenant_id):
    member = membership_for(request, tenant_id)
    return {"id": member.pk, "tenant_id": member.tenant_id, "user_id": member.user_id, "role": member.role}


def validate_membership_reference(*, tenant_id, membership_id):
    member = Membership.objects.filter(
        tenant_id=tenant_id, pk=membership_id, is_active=True,
        tenant__is_active=True, user__is_active=True,
    ).first()
    if member is None:
        raise ValidationError({"membership_id": "An active account in this tenant is required."})
    return {"id": member.pk, "tenant_id": member.tenant_id, "user_id": member.user_id, "role": member.role}


def validate_store_reference(*, tenant_id, store_id):
    store = Store.objects.filter(tenant_id=tenant_id, pk=store_id, is_active=True, tenant__is_active=True).first()
    if store is None:
        raise ValidationError({"store_id": "An active store in this tenant is required."})
    return {"id": store.pk, "tenant_id": store.tenant_id, "code": store.code, "name": store.name}


def membership_can_access_store(*, membership_id, store_id):
    member = Membership.objects.filter(pk=membership_id, is_active=True, user__is_active=True, tenant__is_active=True).first()
    if member is None:
        return False
    if member.role == Membership.Role.ADMIN:
        return Store.objects.filter(pk=store_id, tenant_id=member.tenant_id, is_active=True).exists()
    return StoreAccess.objects.filter(membership=member, store_id=store_id, store__tenant_id=member.tenant_id, store__is_active=True).exists()
