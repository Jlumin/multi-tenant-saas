from rest_framework.exceptions import NotFound, PermissionDenied
from .models import Membership, Store


def membership_for(request, tenant_id, *, admin=False):
    member = Membership.objects.select_related("tenant").filter(
        tenant_id=tenant_id, user=request.user, is_active=True, tenant__is_active=True,
    ).first()
    if member is None:
        from .services import audit
        audit(request, "access.denied")
        raise NotFound()
    if admin and member.role != Membership.Role.ADMIN:
        from .services import audit
        audit(request, "access.denied", tenant=member.tenant)
        raise PermissionDenied("Tenant administrator role required.")
    return member


def stores_for(member):
    stores = Store.objects.filter(tenant_id=member.tenant_id)
    if member.role != Membership.Role.ADMIN:
        stores = stores.filter(storeaccess__membership=member, is_active=True)
    return stores.order_by("code", "id")
