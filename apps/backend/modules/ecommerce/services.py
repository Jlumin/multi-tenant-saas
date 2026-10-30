import hashlib
import json
import uuid

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from platform_core.access import membership_for
from platform_core.models import Tenant
from platform_core.services import audit
from modules.crm.application import customer_snapshot
from modules.wms import application as wms
from .models import Listing, Order, OrderLine, Payment


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "The resource changed; reload and try again."


def _owner(request, tenant_id):
    member = membership_for(request, tenant_id)
    if member.role != "admin":
        audit(request, "access.denied", tenant=member.tenant)
        raise PermissionDenied("Tenant administrator role required for E-Commerce operations.")
    return member


@transaction.atomic
def create_listing(request, tenant_id, data):
    member = _owner(request, tenant_id)
    product = wms.sellable_product(tenant_id=member.tenant_id, product_id=data["product_id"], warehouse_id=data["warehouse_id"])
    try:
        listing = Listing.objects.create(
            tenant=member.tenant, product_id=product["product_id"], warehouse_id=product["warehouse_id"],
            product_code=product["product_code"], title=data["title"], currency=data["currency"], price=data["price"],
        )
    except IntegrityError as exc:
        raise ValidationError("This WMS product already has a listing for the selected warehouse.") from exc
    audit(request, "ecommerce.listing.created", tenant=member.tenant, target=listing.pk)
    return listing


def _order_digest(customer_id, lines):
    payload = {"customer_id": str(customer_id), "lines": sorted(
        [{"listing_id": str(line["listing_id"]), "quantity": line["quantity"]} for line in lines],
        key=lambda row: row["listing_id"],
    )}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@transaction.atomic
def create_order(request, tenant_id, data):
    member = _owner(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id, is_active=True)
    digest = _order_digest(data["customer_id"], data["lines"])
    existing = Order.objects.filter(tenant=tenant, idempotency_key=data["idempotency_key"]).first()
    if existing:
        if existing.payload_digest != digest:
            raise Conflict("Idempotency key was already used with different order data.")
        return existing, False
    customer = customer_snapshot(tenant_id=tenant.pk, customer_id=data["customer_id"])
    normalized = {}
    for item in data["lines"]:
        key = str(item["listing_id"])
        normalized[key] = normalized.get(key, 0) + item["quantity"]
    listing_map = {
        str(listing.pk): listing for listing in Listing.objects.filter(
            tenant=tenant, pk__in=normalized.keys(), is_active=True,
        )
    }
    if len(listing_map) != len(normalized):
        raise ValidationError("One or more listings are unavailable in this tenant.")
    listings = [listing_map[key] for key in sorted(normalized)]
    currencies = {listing.currency for listing in listings}
    if len(currencies) != 1:
        raise ValidationError("An order can contain only one currency.")
    total = sum((listing.price * normalized[str(listing.pk)] for listing in listings), start=0)
    order = Order.objects.create(
        tenant=tenant, customer_id=customer["customer_id"], customer_name=customer["name"], customer_email=customer["email"],
        order_code=f"ORD-{uuid.uuid4().hex[:24].upper()}", idempotency_key=data["idempotency_key"], payload_digest=digest,
        currency=next(iter(currencies)), total_amount=total, created_by=member,
    )
    lines = []
    reserve_lines = []
    for listing in listings:
        quantity = normalized[str(listing.pk)]
        lines.append(OrderLine(
            tenant=tenant, order=order, listing=listing, product_id=listing.product_id, warehouse_id=listing.warehouse_id,
            product_code=listing.product_code, title=listing.title, quantity=quantity,
            unit_price=listing.price, line_total=listing.price * quantity,
        ))
        reserve_lines.append({"product_id": listing.product_id, "warehouse_id": listing.warehouse_id, "quantity": quantity})
    OrderLine.objects.bulk_create(lines)
    wms.reserve_stock(
        tenant_id=tenant.pk, reference_id=order.pk, idempotency_key=data["idempotency_key"],
        lines=reserve_lines, actor=member,
    )
    Payment.objects.create(
        tenant=tenant, order=order, amount=total, currency=order.currency,
        idempotency_key=uuid.uuid5(uuid.NAMESPACE_URL, f"ecommerce-payment:{tenant.pk}:{order.pk}"),
    )
    audit(request, "ecommerce.order.created", tenant=tenant, target=order.pk)
    return order, True


@transaction.atomic
def cancel_order(request, tenant_id, order_id):
    member = _owner(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id, is_active=True)
    order = get_object_or_404(Order.objects.select_for_update(), tenant=tenant, pk=order_id)
    if order.status == Order.Status.CANCELED:
        return order
    if order.status != Order.Status.PENDING_PAYMENT:
        raise Conflict("Only an unpaid order can be canceled in this phase.")
    wms.release_reservation(tenant_id=tenant.pk, reference_id=order.pk, actor=member)
    order.status = Order.Status.CANCELED
    order.save(update_fields=["status", "updated_at"])
    audit(request, "ecommerce.order.canceled", tenant=tenant, target=order.pk)
    return order


@transaction.atomic
def capture_sandbox_payment(request, tenant_id, order_id):
    member = _owner(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id, is_active=True)
    order = get_object_or_404(Order.objects.select_for_update(), tenant=tenant, pk=order_id)
    if order.status == Order.Status.PAID and order.payment.status == Payment.Status.CAPTURED:
        return order
    if order.status != Order.Status.PENDING_PAYMENT or order.payment.status != Payment.Status.PENDING:
        raise Conflict("Only pending sandbox payments can be captured.")
    wms.consume_reservation(tenant_id=tenant.pk, reference_id=order.pk, actor=member)
    order.payment.status = Payment.Status.CAPTURED
    order.payment.captured_at = timezone.now()
    order.payment.save(update_fields=["status", "captured_at"])
    order.status = Order.Status.PAID
    order.save(update_fields=["status", "updated_at"])
    audit(request, "ecommerce.payment.sandbox_captured", tenant=tenant, target=order.pk)
    return order
