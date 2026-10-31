import hashlib
import json
import secrets
import uuid
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from platform_core import application as platform
from platform_core.access import membership_for
from platform_core.models import Tenant
from platform_core.services import audit
from .models import MenuCategory, MenuItem, Order, OrderEvent, OrderLine, PaymentEvent, PosShift, Table


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "The resource changed; reload and try again."


def _store_member(request, tenant_id, store_id):
    member = membership_for(request, tenant_id)
    platform.validate_store_reference(tenant_id=member.tenant_id, store_id=store_id)
    if not platform.membership_can_access_store(membership_id=member.pk, store_id=store_id):
        audit(request, "access.denied", tenant=member.tenant, target=store_id)
        raise PermissionDenied("This account is not assigned to the selected active store.")
    return member


def _manager(member):
    if member.role == "viewer":
        raise PermissionDenied("A store manager or tenant administrator role is required.")


def _admin(member):
    if member.role != "admin":
        raise PermissionDenied("Tenant administrator role required.")


def _new_token():
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()


@transaction.atomic
def create_table(request, tenant_id, data):
    member = membership_for(request, tenant_id)
    _manager(member)
    platform.validate_store_reference(tenant_id=member.tenant_id, store_id=data["store_id"])
    if not platform.membership_can_access_store(membership_id=member.pk, store_id=data["store_id"]):
        raise PermissionDenied("This account is not assigned to the selected active store.")
    token, digest = _new_token()
    try:
        table = Table.objects.create(tenant=member.tenant, qr_token_digest=digest, **data)
    except IntegrityError as exc:
        raise ValidationError("Table code already exists in this store.") from exc
    audit(request, "restaurant.table.created", tenant=member.tenant, target=table.pk)
    return table, token


@transaction.atomic
def rotate_table_token(request, tenant_id, table_id):
    member = membership_for(request, tenant_id)
    table = get_object_or_404(Table, tenant=member.tenant, pk=table_id)
    _store_member(request, tenant_id, table.store_id)
    _manager(member)
    token, digest = _new_token()
    table.qr_token_digest = digest
    table.save(update_fields=["qr_token_digest"])
    audit(request, "restaurant.table.qr_rotated", tenant=member.tenant, target=table.pk)
    return table, token


@transaction.atomic
def set_table_active(request, tenant_id, table_id, is_active):
    member = membership_for(request, tenant_id)
    table = get_object_or_404(Table, tenant=member.tenant, pk=table_id)
    _store_member(request, tenant_id, table.store_id)
    _manager(member)
    table.is_active = is_active
    table.save(update_fields=["is_active"])
    audit(request, "restaurant.table.updated", tenant=member.tenant, target=table.pk)
    return table


@transaction.atomic
def create_category(request, tenant_id, data):
    member = membership_for(request, tenant_id)
    _admin(member)
    try:
        category = MenuCategory.objects.create(tenant=member.tenant, **data)
    except IntegrityError as exc:
        raise ValidationError("Menu category code already exists in this tenant.") from exc
    audit(request, "restaurant.menu_category.created", tenant=member.tenant, target=category.pk)
    return category


@transaction.atomic
def create_item(request, tenant_id, data):
    member = membership_for(request, tenant_id)
    _admin(member)
    category = get_object_or_404(MenuCategory, tenant=member.tenant, pk=data["category_id"])
    values = dict(data)
    values["category"] = category
    del values["category_id"]
    try:
        item = MenuItem.objects.create(tenant=member.tenant, **values)
    except IntegrityError as exc:
        raise ValidationError("Menu item code already exists in this tenant.") from exc
    audit(request, "restaurant.menu_item.created", tenant=member.tenant, target=item.pk)
    return item


@transaction.atomic
def update_item(request, tenant_id, item_id, data):
    member = membership_for(request, tenant_id)
    _admin(member)
    item = get_object_or_404(MenuItem, tenant=member.tenant, pk=item_id)
    data = dict(data)
    if "category_id" in data:
        data["category"] = get_object_or_404(MenuCategory, tenant=member.tenant, pk=data.pop("category_id"))
    for key, value in data.items():
        setattr(item, key, value)
    if item.category.tenant_id != member.tenant_id:
        raise ValidationError("Menu category must belong to this tenant.")
    item.save()
    audit(request, "restaurant.menu_item.updated", tenant=member.tenant, target=item.pk)
    return item


def _order_digest(store_id, table_id, source, lines, note):
    normalized = sorted([
        {"menu_item_id": str(line["menu_item_id"]), "quantity": int(line["quantity"]), "note": line.get("note", "")}
        for line in lines
    ], key=lambda line: line["menu_item_id"])
    raw = json.dumps({"store_id": str(store_id), "table_id": str(table_id) if table_id else None, "source": source, "lines": normalized, "note": note}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _create_order(*, tenant, store_id, table, source, actor_membership_id, data):
    digest = _order_digest(store_id, table.pk if table else None, source, data["lines"], data.get("note", ""))
    existing = Order.objects.filter(tenant=tenant, idempotency_key=data["idempotency_key"]).first()
    if existing:
        if existing.payload_digest != digest:
            raise Conflict("Idempotency key was already used with different order data.")
        return existing, False
    normalized = {}
    for line in data["lines"]:
        key = str(line["menu_item_id"])
        if key in normalized:
            normalized[key]["quantity"] += line["quantity"]
            normalized[key]["note"] = "; ".join(filter(None, [normalized[key]["note"], line.get("note", "")]))[:200]
        else:
            normalized[key] = {**line, "note": line.get("note", "")}
    items = {str(item.pk): item for item in MenuItem.objects.select_for_update().filter(
        tenant=tenant, pk__in=normalized, is_active=True, category__is_active=True,
    ).select_related("category")}
    if len(items) != len(normalized):
        raise ValidationError("One or more menu items are unavailable.")
    lines = []
    total = Decimal("0.00")
    for item_id, line in normalized.items():
        item = items[item_id]
        line_total = item.price * line["quantity"]
        total += line_total
        lines.append(OrderLine(
            tenant=tenant, menu_item=item, item_code=item.code, item_name=item.name,
            quantity=line["quantity"], unit_price=item.price, line_total=line_total,
            note=line.get("note", ""),
        ))
    order = Order.objects.create(
        tenant=tenant, store_id=store_id, table=table, source=source,
        order_code=f"R-{uuid.uuid4().hex[:12].upper()}", total_amount=total,
        note=data.get("note", ""), idempotency_key=data["idempotency_key"],
        payload_digest=digest, created_by_membership_id=actor_membership_id,
    )
    for line in lines:
        line.order = order
    OrderLine.objects.bulk_create(lines)
    OrderEvent.objects.create(tenant=tenant, order=order, event_type="order_placed", to_status=Order.Status.PLACED, actor_membership_id=actor_membership_id)
    return order, True


@transaction.atomic
def create_qr_order(token, data):
    digest = hashlib.sha256(token.encode()).hexdigest()
    table = Table.objects.select_for_update().select_related("tenant").filter(qr_token_digest=digest, is_active=True, tenant__is_active=True).first()
    if table is None:
        from rest_framework.exceptions import NotFound
        raise NotFound("This table QR code is inactive or invalid.")
    if _open_shift(table.tenant_id, table.store_id) is None:
        raise ValidationError("This restaurant is not accepting orders right now.")
    order, created = _create_order(tenant=table.tenant, store_id=table.store_id, table=table, source=Order.Source.QR, actor_membership_id=None, data=data)
    if created:
        audit(None, "restaurant.qr_order.created", tenant=table.tenant, target=order.pk)
    return order, created


def qr_menu(token):
    digest = hashlib.sha256(token.encode()).hexdigest()
    table = Table.objects.select_related("tenant").filter(qr_token_digest=digest, is_active=True, tenant__is_active=True).first()
    if table is None:
        from rest_framework.exceptions import NotFound
        raise NotFound("This table QR code is inactive or invalid.")
    categories = MenuCategory.objects.filter(tenant=table.tenant, is_active=True).prefetch_related("items")
    return table, categories, _open_shift(table.tenant_id, table.store_id) is not None


def _open_shift(tenant_id, store_id):
    return PosShift.objects.filter(tenant_id=tenant_id, store_id=store_id, closed_at__isnull=True).first()


def current_shift(request, tenant_id, store_id):
    member = _store_member(request, tenant_id, store_id)
    return _open_shift(member.tenant_id, store_id)


@transaction.atomic
def open_shift(request, tenant_id, store_id, opening_float):
    member = _store_member(request, tenant_id, store_id)
    _manager(member)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id, is_active=True)
    if _open_shift(tenant.pk, store_id):
        raise Conflict("A POS shift is already open for this store.")
    shift = PosShift.objects.create(tenant=tenant, store_id=store_id, opened_by_membership_id=member.pk, opening_float=opening_float)
    audit(request, "restaurant.pos_shift.opened", tenant=tenant, target=shift.pk)
    return shift


@transaction.atomic
def close_shift(request, tenant_id, store_id, closing_cash):
    member = _store_member(request, tenant_id, store_id)
    _manager(member)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id, is_active=True)
    shift = PosShift.objects.select_for_update().filter(tenant=tenant, store_id=store_id, closed_at__isnull=True).first()
    if shift is None:
        raise Conflict("There is no open POS shift for this store.")
    pending = Order.objects.filter(tenant=tenant, store_id=store_id, payment_status=Order.PaymentStatus.UNPAID).exclude(status=Order.Status.CANCELLED).exists()
    if pending:
        raise ValidationError("Close or settle open POS orders before shift handover.")
    receipts = shift.payment_events.filter(kind=PaymentEvent.Kind.CASH_RECEIVED).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
    refunds = shift.payment_events.filter(kind=PaymentEvent.Kind.CASH_REFUND).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
    expected = shift.opening_float + receipts - refunds
    shift.closing_cash = closing_cash
    shift.cash_variance = closing_cash - expected
    shift.closed_by_membership_id = member.pk
    shift.closed_at = timezone.now()
    shift.save(update_fields=["closing_cash", "cash_variance", "closed_by_membership_id", "closed_at"])
    audit(request, "restaurant.pos_shift.closed", tenant=tenant, target=shift.pk)
    return shift


@transaction.atomic
def create_pos_order(request, tenant_id, store_id, data):
    member = _store_member(request, tenant_id, store_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id, is_active=True)
    if _open_shift(tenant.pk, store_id) is None:
        raise ValidationError("Open a POS shift before creating a staff order.")
    table = None
    if data.get("table_id"):
        table = get_object_or_404(Table, tenant=tenant, store_id=store_id, pk=data["table_id"], is_active=True)
    order, created = _create_order(tenant=tenant, store_id=store_id, table=table, source=Order.Source.POS, actor_membership_id=member.pk, data=data)
    if created:
        audit(request, "restaurant.pos_order.created", tenant=tenant, target=order.pk)
    return order, created


@transaction.atomic
def order_action(request, tenant_id, order_id, action):
    member = membership_for(request, tenant_id)
    order = get_object_or_404(Order.objects.select_for_update().select_related("tenant"), tenant_id=member.tenant_id, pk=order_id)
    _store_member(request, tenant_id, order.store_id)
    if _open_shift(member.tenant_id, order.store_id) is None:
        raise ValidationError("Open a POS shift before processing restaurant orders.")
    transitions = {
        Order.Status.PLACED: {"accept": Order.Status.ACCEPTED, "cancel": Order.Status.CANCELLED},
        Order.Status.ACCEPTED: {"prepare": Order.Status.PREPARING, "cancel": Order.Status.CANCELLED},
        Order.Status.PREPARING: {"ready": Order.Status.READY},
        Order.Status.READY: {"serve": Order.Status.SERVED},
    }
    target = transitions.get(order.status, {}).get(action)
    if target is None:
        raise Conflict("This order cannot make the requested status transition.")
    if target == Order.Status.CANCELLED and order.payment_status != Order.PaymentStatus.UNPAID:
        raise ValidationError("Refund received cash before cancelling a paid order.")
    before = order.status
    order.status = target
    order.save(update_fields=["status", "updated_at"])
    OrderEvent.objects.create(tenant=order.tenant, order=order, event_type=f"order_{action}", from_status=before, to_status=target, actor_membership_id=member.pk)
    audit(request, f"restaurant.order.{action}", tenant=order.tenant, target=order.pk)
    return order


@transaction.atomic
def cash_payment(request, tenant_id, order_id, idempotency_key):
    member = membership_for(request, tenant_id)
    order = get_object_or_404(Order.objects.select_for_update().select_related("tenant"), tenant_id=member.tenant_id, pk=order_id)
    _store_member(request, tenant_id, order.store_id)
    existing = PaymentEvent.objects.filter(tenant=order.tenant, idempotency_key=idempotency_key).first()
    if existing:
        if existing.order_id != order.pk or existing.kind != PaymentEvent.Kind.CASH_RECEIVED:
            raise Conflict("Payment idempotency key was used for a different operation.")
        return existing
    shift = PosShift.objects.select_for_update().filter(tenant=order.tenant, store_id=order.store_id, closed_at__isnull=True).first()
    if shift is None:
        raise ValidationError("Open a POS shift before receiving cash.")
    if order.status == Order.Status.CANCELLED or order.payment_status != Order.PaymentStatus.UNPAID:
        raise Conflict("Only an unpaid active order can be paid.")
    event = PaymentEvent.objects.create(tenant=order.tenant, order=order, shift=shift, kind=PaymentEvent.Kind.CASH_RECEIVED, amount=order.total_amount, idempotency_key=idempotency_key, actor_membership_id=member.pk)
    order.payment_status = Order.PaymentStatus.PAID
    order.save(update_fields=["payment_status", "updated_at"])
    OrderEvent.objects.create(tenant=order.tenant, order=order, event_type="cash_received", actor_membership_id=member.pk, detail=str(event.amount))
    audit(request, "restaurant.payment.cash_received", tenant=order.tenant, target=order.pk)
    return event


@transaction.atomic
def cash_refund(request, tenant_id, order_id, *, amount, reason, idempotency_key):
    member = membership_for(request, tenant_id)
    if member.role == "viewer":
        raise PermissionDenied("A store manager or tenant administrator role is required to refund.")
    order = get_object_or_404(Order.objects.select_for_update().select_related("tenant"), tenant_id=member.tenant_id, pk=order_id)
    _store_member(request, tenant_id, order.store_id)
    existing = PaymentEvent.objects.filter(tenant=order.tenant, idempotency_key=idempotency_key).first()
    if existing:
        if existing.order_id != order.pk or existing.kind != PaymentEvent.Kind.CASH_REFUND or existing.amount != amount:
            raise Conflict("Payment idempotency key was used for a different operation.")
        return existing
    shift = PosShift.objects.select_for_update().filter(tenant=order.tenant, store_id=order.store_id, closed_at__isnull=True).first()
    if shift is None:
        raise ValidationError("Open a POS shift before refunding cash.")
    received = order.payment_events.filter(kind=PaymentEvent.Kind.CASH_RECEIVED).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
    refunded = order.payment_events.filter(kind=PaymentEvent.Kind.CASH_REFUND).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
    if received == 0 or amount > received - refunded:
        raise ValidationError("Refund amount exceeds the remaining cash received.")
    event = PaymentEvent.objects.create(tenant=order.tenant, order=order, shift=shift, kind=PaymentEvent.Kind.CASH_REFUND, amount=amount, idempotency_key=idempotency_key, actor_membership_id=member.pk, reason=reason)
    remaining = received - refunded - amount
    order.payment_status = Order.PaymentStatus.REFUNDED if remaining == 0 else Order.PaymentStatus.PARTIALLY_REFUNDED
    order.save(update_fields=["payment_status", "updated_at"])
    OrderEvent.objects.create(tenant=order.tenant, order=order, event_type="cash_refunded", actor_membership_id=member.pk, detail=f"{amount}: {reason}")
    audit(request, "restaurant.payment.cash_refunded", tenant=order.tenant, target=order.pk)
    return event
