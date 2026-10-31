import uuid

from django.db import models
from django.db.models import Q


class Table(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    store_id = models.UUIDField()
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=80)
    qr_token_digest = models.CharField(max_length=64, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant", "store_id", "code"], name="rest_table_store_code_uniq")]
        ordering = ["store_id", "code", "id"]


class MenuCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=80)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant", "code"], name="rest_category_code_uniq")]
        ordering = ["sort_order", "name", "id"]


class MenuItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    category = models.ForeignKey(MenuCategory, related_name="items", on_delete=models.PROTECT)
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default="TWD")
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="rest_item_code_uniq"),
            models.CheckConstraint(condition=Q(price__gte=0), name="rest_item_price_nonnegative"),
        ]
        ordering = ["sort_order", "name", "id"]


class PosShift(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    store_id = models.UUIDField()
    opened_by_membership_id = models.UUIDField()
    opening_float = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_by_membership_id = models.UUIDField(null=True, blank=True)
    closing_cash = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cash_variance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "store_id"], condition=Q(closed_at__isnull=True), name="rest_one_open_shift_store_uniq"),
            models.CheckConstraint(condition=Q(opening_float__gte=0), name="rest_shift_float_nonnegative"),
        ]
        ordering = ["-opened_at", "id"]


class Order(models.Model):
    class Source(models.TextChoices):
        QR = "qr", "QR guest"
        POS = "pos", "Staff POS"

    class Status(models.TextChoices):
        PLACED = "placed", "Placed"
        ACCEPTED = "accepted", "Accepted"
        PREPARING = "preparing", "Preparing"
        READY = "ready", "Ready"
        SERVED = "served", "Served"
        CANCELLED = "cancelled", "Cancelled"

    class PaymentStatus(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PAID = "paid", "Paid"
        PARTIALLY_REFUNDED = "partially_refunded", "Partially refunded"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    store_id = models.UUIDField()
    table = models.ForeignKey(Table, null=True, blank=True, related_name="orders", on_delete=models.PROTECT)
    source = models.CharField(max_length=8, choices=Source.choices)
    order_code = models.CharField(max_length=24)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLACED)
    payment_status = models.CharField(max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)
    currency = models.CharField(max_length=3, default="TWD")
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=300, blank=True)
    idempotency_key = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    created_by_membership_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "order_code"], name="rest_order_code_uniq"),
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="rest_order_idem_uniq"),
            models.CheckConstraint(condition=Q(total_amount__gte=0), name="rest_order_total_nonnegative"),
        ]
        ordering = ["-created_at", "-id"]


class OrderLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    order = models.ForeignKey(Order, related_name="lines", on_delete=models.PROTECT)
    menu_item = models.ForeignKey(MenuItem, on_delete=models.PROTECT)
    item_code = models.CharField(max_length=32)
    item_name = models.CharField(max_length=120)
    quantity = models.PositiveSmallIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="rest_line_qty_positive"),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name="rest_line_price_nonnegative"),
        ]


class OrderEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    order = models.ForeignKey(Order, related_name="events", on_delete=models.PROTECT)
    event_type = models.CharField(max_length=32)
    from_status = models.CharField(max_length=12, blank=True)
    to_status = models.CharField(max_length=12, blank=True)
    actor_membership_id = models.UUIDField(null=True, blank=True)
    detail = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class PaymentEvent(models.Model):
    class Kind(models.TextChoices):
        CASH_RECEIVED = "cash_received", "Cash received"
        CASH_REFUND = "cash_refund", "Cash refund"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT, related_name="+")
    order = models.ForeignKey(Order, related_name="payment_events", on_delete=models.PROTECT)
    shift = models.ForeignKey(PosShift, related_name="payment_events", on_delete=models.PROTECT)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    idempotency_key = models.UUIDField()
    actor_membership_id = models.UUIDField()
    reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="rest_payment_idem_uniq"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="rest_payment_amount_positive"),
        ]
        ordering = ["created_at", "id"]
