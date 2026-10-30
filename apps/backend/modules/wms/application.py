"""Public service contracts consumed by other business modules. No caller writes WMS tables."""
import hashlib
import json
import uuid
from django.urls import reverse

from django.db import IntegrityError, connection, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from platform_core.models import Membership, Tenant
from platform_core.services import audit
from .models import (
    InventoryDocument, InventoryDocumentLine, Location, PackageUnit, Product,
    StockBalance, StockMovement, StockReservation, StockReservationLine, Warehouse,
)


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "The resource changed; reload and try again."


def sellable_product(*, tenant_id, product_id, warehouse_id):
    product = Product.objects.filter(tenant_id=tenant_id, pk=product_id, is_active=True).first()
    warehouse = Warehouse.objects.filter(tenant_id=tenant_id, pk=warehouse_id, is_active=True).first()
    if not product or not warehouse:
        raise ValidationError("Product or warehouse is unavailable in this tenant.")
    return {"product_id": product.pk, "product_code": product.code, "product_name": product.name,
            "base_unit": product.base_unit, "warehouse_id": warehouse.pk, "warehouse_code": warehouse.code}


def product_image_url(*, tenant_id, product_id):
    product = Product.objects.filter(tenant_id=tenant_id, pk=product_id, is_active=True).only("id", "tenant_id", "image").first()
    if not product or not product.image:
        return None
    return reverse("wms-product-image", kwargs={"tenant_id": tenant_id, "product_id": product_id})


def storefront_product_image(*, tenant_id, product_id):
    """Return an active tenant product image file for an authorized storefront contract caller."""
    product = Product.objects.filter(tenant_id=tenant_id, pk=product_id, is_active=True).only("id", "image").first()
    return product.image if product and product.image else None


def available_quantity(*, tenant_id, product_id, warehouse_id):
    quantity = StockBalance.objects.filter(tenant_id=tenant_id, product_id=product_id, warehouse_id=warehouse_id).aggregate(total=Sum("quantity"))["total"] or 0
    reserved = StockReservationLine.objects.filter(
        tenant_id=tenant_id, product_id=product_id, warehouse_id=warehouse_id,
        reservation__status=StockReservation.Status.ACTIVE,
    ).aggregate(total=Sum("quantity"))["total"] or 0
    return max(0, quantity - reserved)


def _reservation_digest(lines):
    canonical = sorted([
        {"product_id": str(item["product_id"]), "warehouse_id": str(item["warehouse_id"]), "quantity": int(item["quantity"])}
        for item in lines
    ], key=lambda row: (row["product_id"], row["warehouse_id"]))
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@transaction.atomic
def reserve_stock(*, tenant_id, reference_id, idempotency_key, lines, actor, expires_at=None):
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id, is_active=True)
    if not Membership.objects.filter(pk=actor.pk, tenant=tenant, is_active=True, role="admin", user__is_active=True).exists():
        raise PermissionDenied("Tenant administrator role required for stock reservation.")
    if not lines:
        raise ValidationError({"lines": "At least one line is required."})
    digest = _reservation_digest(lines)
    existing = StockReservation.objects.filter(tenant=tenant, reference_id=reference_id).first()
    if existing:
        if existing.idempotency_key != idempotency_key or existing.payload_digest != digest:
            raise Conflict("Reservation reference was already used with different data.")
        return existing
    if StockReservation.objects.filter(tenant=tenant, idempotency_key=idempotency_key).exists():
        raise Conflict("Idempotency key was already used with a different reference.")
    requested = {}
    for item in lines:
        key = (str(item["product_id"]), str(item["warehouse_id"]))
        quantity = item["quantity"]
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1:
            raise ValidationError("Reservation quantity must be a positive integer.")
        requested[key] = requested.get(key, 0) + quantity
    allocations = {}
    provisional = {}
    for (product_id, warehouse_id), quantity in requested.items():
        product = Product.objects.filter(tenant=tenant, pk=product_id, is_active=True).first()
        warehouse = Warehouse.objects.filter(tenant=tenant, pk=warehouse_id, is_active=True).first()
        if not product or not warehouse:
            raise ValidationError("Product or warehouse is unavailable in this tenant.")
        # Same-warehouse fulfillment is deliberate; there is no implicit inter-warehouse transfer.
        balances = list(StockBalance.objects.select_for_update().filter(
            tenant=tenant, product=product, warehouse=warehouse, quantity__gt=0,
        ).select_related("location").order_by("location__code", "location_id"))
        remaining = quantity
        for balance in balances:
            already_reserved = StockReservationLine.objects.filter(
                tenant=tenant, product=product, location=balance.location,
                reservation__status=StockReservation.Status.ACTIVE,
            ).aggregate(total=Sum("quantity"))["total"] or 0
            scope = (str(product.pk), str(warehouse.pk), str(balance.location_id))
            take = min(remaining, max(0, balance.quantity - already_reserved - provisional.get(scope, 0)))
            if take:
                allocations[scope] = (product, warehouse, balance.location, allocations.get(scope, (None, None, None, 0))[3] + take)
                provisional[scope] = provisional.get(scope, 0) + take
                remaining -= take
            if not remaining:
                break
        if remaining:
            raise ValidationError({"stock": f"Insufficient available stock for product {product.code} in warehouse {warehouse.code}."})
    try:
        reservation = StockReservation.objects.create(
            tenant=tenant, reference_id=reference_id, idempotency_key=idempotency_key,
            payload_digest=digest, created_by=actor, expires_at=expires_at,
        )
        StockReservationLine.objects.bulk_create([
            StockReservationLine(tenant=tenant, reservation=reservation, product=product,
                                 warehouse=warehouse, location=location, quantity=quantity)
            for product, warehouse, location, quantity in allocations.values()
        ])
    except IntegrityError as exc:
        raise Conflict("Reservation conflicts with an existing request.") from exc
    audit(None, "wms.stock.reserved", tenant=tenant, target=reservation.pk, actor=actor.user)
    return reservation


@transaction.atomic
def release_reservation(*, tenant_id, reference_id, actor):
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id, is_active=True)
    if not Membership.objects.filter(pk=actor.pk, tenant=tenant, is_active=True, role="admin", user__is_active=True).exists():
        raise PermissionDenied("Tenant administrator role required to release stock.")
    reservation = get_object_or_404(StockReservation.objects.select_for_update(), tenant=tenant, reference_id=reference_id)
    if reservation.status == StockReservation.Status.ACTIVE:
        reservation.status = StockReservation.Status.RELEASED
        reservation.save(update_fields=["status", "updated_at"])
        audit(None, "wms.stock.reservation_released", tenant=tenant, target=reservation.pk, actor=actor.user)
    return reservation


@transaction.atomic
def consume_reservation(*, tenant_id, reference_id, actor):
    tenant = Tenant.objects.select_for_update().get(pk=tenant_id, is_active=True)
    if not Membership.objects.filter(pk=actor.pk, tenant=tenant, is_active=True, role="admin", user__is_active=True).exists():
        raise PermissionDenied("Tenant administrator role required to consume reserved stock.")
    reservation = get_object_or_404(
        StockReservation.objects.select_for_update().prefetch_related("lines__product", "lines__warehouse", "lines__location"),
        tenant=tenant, reference_id=reference_id,
    )
    if reservation.status == StockReservation.Status.CONSUMED:
        return reservation
    if reservation.status != StockReservation.Status.ACTIVE:
        raise Conflict("Only active stock reservations can be consumed.")
    lines = list(reservation.lines.select_related("product", "warehouse", "location"))
    if not lines:
        raise ValidationError("Reservation has no stock allocation.")
    doc_key = uuid.uuid5(uuid.NAMESPACE_URL, f"sme-cloud:wms:reservation:{tenant.pk}:{reference_id}")
    by_warehouse = {}
    for allocation in lines:
        by_warehouse.setdefault(allocation.warehouse_id, []).append(allocation)
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('wms.allow_balance_write', 'on', true)")
    for warehouse_id, allocations in by_warehouse.items():
        warehouse = allocations[0].warehouse
        suffix = warehouse.pk.hex[:8]
        doc = InventoryDocument.objects.create(
            tenant=tenant, warehouse=warehouse, kind=InventoryDocument.Kind.ISSUE,
            document_code=f"WEB-{str(reference_id).replace('-', '')[:24]}-{suffix}",
            idempotency_key=uuid.uuid5(uuid.NAMESPACE_URL, f"{doc_key}:{warehouse_id}"),
            payload_digest=reservation.payload_digest, note=f"E-Commerce fulfillment {reference_id}", created_by=actor,
        )
        document_lines = []
        for allocation in allocations:
            base = PackageUnit.objects.get(tenant=tenant, product=allocation.product, is_base=True, is_active=True)
            document_lines.append(InventoryDocumentLine(
                tenant=tenant, document=doc, product=allocation.product, package_unit=base,
                location=allocation.location, quantity=allocation.quantity,
                conversion_snapshot=1, base_quantity=allocation.quantity,
            ))
        InventoryDocumentLine.objects.bulk_create(document_lines)
        for line in document_lines:
            balance = StockBalance.objects.select_for_update().get(
                tenant=tenant, product=line.product, warehouse=doc.warehouse, location=line.location,
            )
            if balance.quantity < line.base_quantity:
                raise ValidationError("Reserved stock is no longer physically available.")
            balance.quantity -= line.base_quantity
            balance.save(update_fields=["quantity", "updated_at"])
            StockMovement.objects.create(
                tenant=tenant, document=doc, line=line, product=line.product,
                warehouse=doc.warehouse, location=line.location, quantity_delta=-line.base_quantity,
                created_by=actor,
            )
        doc.status = InventoryDocument.Status.POSTED
        doc.posted_by = actor
        doc.posted_at = timezone.now()
        doc.save(update_fields=["status", "posted_by", "posted_at"])
        audit(None, "wms.ecommerce.issue.posted", tenant=tenant, target=doc.pk, actor=actor.user)
    reservation.status = StockReservation.Status.CONSUMED
    reservation.save(update_fields=["status", "updated_at"])
    return reservation
