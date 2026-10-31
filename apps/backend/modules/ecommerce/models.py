import uuid

from django.db import models
from django.db.models import Q


class Listing(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    product_id = models.UUIDField()
    warehouse_id = models.UUIDField()
    product_code = models.CharField(max_length=40)
    title = models.CharField(max_length=160)
    category = models.CharField(max_length=80, blank=True, default="")
    currency = models.CharField(max_length=3, default="TWD")
    price = models.DecimalField(max_digits=12, decimal_places=2)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "product_id", "warehouse_id"], name="ecom_listing_scope_uniq"),
            models.CheckConstraint(condition=Q(price__gte=0), name="ecom_listing_price_nonnegative"),
            models.CheckConstraint(condition=~Q(title=""), name="ecom_listing_title_not_empty"),
        ]
        ordering = ["title", "id"]


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING_PAYMENT = "pending_payment", "Pending payment"
        PAID = "paid", "Paid"
        CANCELED = "canceled", "Canceled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    customer_id = models.UUIDField()
    customer_name = models.CharField(max_length=120)
    customer_email = models.EmailField(max_length=254, blank=True)
    order_code = models.CharField(max_length=40)
    idempotency_key = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_PAYMENT)
    currency = models.CharField(max_length=3)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    created_by = models.ForeignKey("platform_core.Membership", on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "order_code"], name="ecom_order_tenant_code_uniq"),
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="ecom_order_tenant_key_uniq"),
            models.CheckConstraint(condition=Q(status__in=["pending_payment", "paid", "canceled"]), name="ecom_order_status_valid"),
            models.CheckConstraint(condition=Q(total_amount__gte=0), name="ecom_order_amount_nonnegative"),
        ]
        ordering = ["-created_at", "-id"]


class OrderLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    order = models.ForeignKey(Order, related_name="lines", on_delete=models.PROTECT)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT)
    product_id = models.UUIDField()
    warehouse_id = models.UUIDField()
    product_code = models.CharField(max_length=40)
    title = models.CharField(max_length=160)
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="ecom_orderline_qty_positive"),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name="ecom_orderline_price_nonnegative"),
            models.CheckConstraint(condition=Q(line_total__gte=0), name="ecom_orderline_total_nonnegative"),
        ]


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CAPTURED = "captured", "Captured"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    order = models.OneToOneField(Order, related_name="payment", on_delete=models.PROTECT)
    provider = models.CharField(max_length=20, default="sandbox")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3)
    idempotency_key = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)
    captured_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="ecom_payment_tenant_key_uniq"),
            models.CheckConstraint(condition=Q(provider="sandbox"), name="ecom_payment_sandbox_only"),
            models.CheckConstraint(condition=Q(status__in=["pending", "captured"]), name="ecom_payment_status_valid"),
            models.CheckConstraint(condition=Q(amount__gte=0), name="ecom_payment_amount_nonnegative"),
        ]
