from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from .models import AuditEvent, Membership, Store, StoreAccess, Tenant


def audit(request, action, *, tenant=None, target="", actor=None):
    return AuditEvent.objects.create(
        tenant=tenant, actor=actor or (request.user if request and request.user.is_authenticated else None),
        action=action, target_id=str(target), request_id=getattr(request, "request_id", ""),
    )


def assigned_stores(tenant, ids):
    stores = list(Store.objects.filter(tenant=tenant, id__in=ids))
    if len(stores) != len(set(ids)):
        raise ValidationError({"store_ids": "Invalid store selection."})
    return stores


@transaction.atomic
def save_member(request, tenant_id, data, member_id=None):
    # Serialize membership changes per tenant, including concurrent last-admin changes.
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id)
    from .access import membership_for
    membership_for(request, tenant_id, admin=True)
    stores = assigned_stores(tenant, data.get("store_ids", [])) if "store_ids" in data else None
    if member_id:
        member = get_object_or_404(Membership, pk=member_id, tenant=tenant)
        if member.role == Membership.Role.ADMIN and member.is_active:
            losing_admin = data.get("role", member.role) != Membership.Role.ADMIN or not data.get("is_active", member.is_active)
            other_admins = Membership.objects.filter(tenant=tenant, role=Membership.Role.ADMIN, is_active=True, user__is_active=True).exclude(pk=member.pk)
            if losing_admin and not other_admins.exists():
                raise ValidationError("The last active tenant administrator cannot be removed.")
        member.role = data.get("role", member.role)
        member.is_active = data.get("is_active", member.is_active)
        action = "membership.updated"
    else:
        try:
            with transaction.atomic():
                user = get_user_model().objects.create_user(username=data["username"], password=data["password"])
        except IntegrityError as exc:
            raise ValidationError({"username": "Account cannot be created with this username."}) from exc
        member = Membership(tenant=tenant, user=user, role=data.get("role", Membership.Role.VIEWER), is_active=data.get("is_active", True))
        action = "membership.created"
    member.save()
    if stores is not None:
        StoreAccess.objects.filter(membership=member).delete()
        for store in stores:
            StoreAccess.objects.create(membership=member, store=store)
    audit(request, action, tenant=tenant, target=member.pk)
    return member


@transaction.atomic
def save_store(request, tenant_id, data, store_id=None):
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id)
    from .access import membership_for
    membership_for(request, tenant_id, admin=True)
    store = get_object_or_404(Store, tenant=tenant, pk=store_id) if store_id else Store(tenant=tenant)
    for key, value in data.items():
        setattr(store, key, value)
    try:
        with transaction.atomic():
            store.save()
    except IntegrityError as exc:
        raise ValidationError({"code": "Store code already exists in this tenant."}) from exc
    audit(request, "store.updated" if store_id else "store.created", tenant=tenant, target=store.pk)
    return store
