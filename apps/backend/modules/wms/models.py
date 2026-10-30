import uuid
from django.db import models


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    base_unit = models.CharField(max_length=20, default="PCS")
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="wms_product_tenant_code_uniq"),
            models.CheckConstraint(condition=~models.Q(code=""), name="wms_product_code_not_empty"),
            models.CheckConstraint(condition=~models.Q(base_unit=""), name="wms_product_base_unit_not_empty"),
        ]
        ordering = ["code", "id"]


class PackageUnit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    product = models.ForeignKey(Product, related_name="package_units", on_delete=models.PROTECT)
    code = models.CharField(max_length=24)
    name = models.CharField(max_length=60)
    base_quantity = models.PositiveIntegerField(default=1)
    is_base = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "code"], name="wms_pack_product_code_uniq"),
            models.UniqueConstraint(fields=["product"], condition=models.Q(is_base=True), name="wms_one_base_pack_per_product"),
            models.CheckConstraint(condition=models.Q(base_quantity__gte=1), name="wms_pack_qty_positive"),
        ]
        ordering = ["base_quantity", "code"]


class Warehouse(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant", "code"], name="wms_wh_tenant_code_uniq")]
        ordering = ["code", "id"]


class Location(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    warehouse = models.ForeignKey(Warehouse, related_name="locations", on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["warehouse", "code"], name="wms_loc_wh_code_uniq"),
            models.UniqueConstraint(fields=["warehouse"], condition=models.Q(is_default=True), name="wms_one_default_loc_per_wh"),
        ]
        ordering = ["warehouse__code", "code", "id"]


class StockBalance(models.Model):
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    location = models.ForeignKey(Location, on_delete=models.PROTECT)
    quantity = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "product", "warehouse", "location"], name="wms_balance_scope_uniq"),
            models.CheckConstraint(condition=models.Q(quantity__gte=0), name="wms_balance_nonnegative"),
        ]
        indexes = [models.Index(fields=["tenant", "product", "warehouse", "location"], name="wms_balance_lookup")]


class InventoryDocument(models.Model):
    class Kind(models.TextChoices):
        RECEIPT = "receipt", "Receipt"
        ISSUE = "issue", "Issue"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"
        CANCELED = "canceled", "Canceled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    kind = models.CharField(max_length=8, choices=Kind.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.DRAFT)
    document_code = models.CharField(max_length=40)
    idempotency_key = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    version = models.PositiveIntegerField(default=1)
    note = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey("platform_core.Membership", related_name="wms_documents_created", on_delete=models.PROTECT)
    posted_by = models.ForeignKey("platform_core.Membership", related_name="wms_documents_posted", null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "document_code"], name="wms_doc_tenant_code_uniq"),
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="wms_doc_idempotency_uniq"),
            models.CheckConstraint(condition=models.Q(kind__in=["receipt", "issue"]), name="wms_doc_kind_valid"),
            models.CheckConstraint(condition=models.Q(status__in=["draft", "posted", "canceled"]), name="wms_doc_status_valid"),
        ]
        ordering = ["-created_at", "-id"]


class InventoryDocumentLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    document = models.ForeignKey(InventoryDocument, related_name="lines", on_delete=models.PROTECT)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    package_unit = models.ForeignKey(PackageUnit, on_delete=models.PROTECT)
    location = models.ForeignKey(Location, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    conversion_snapshot = models.PositiveIntegerField()
    base_quantity = models.PositiveBigIntegerField()

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity__gte=1), name="wms_docline_qty_positive"),
            models.CheckConstraint(condition=models.Q(conversion_snapshot__gte=1), name="wms_docline_conversion_positive"),
            models.CheckConstraint(condition=models.Q(base_quantity__gte=1), name="wms_docline_base_qty_positive"),
        ]


class StockMovement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    document = models.ForeignKey(InventoryDocument, on_delete=models.PROTECT)
    line = models.OneToOneField(InventoryDocumentLine, on_delete=models.PROTECT)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    location = models.ForeignKey(Location, on_delete=models.PROTECT)
    quantity_delta = models.BigIntegerField()
    created_by = models.ForeignKey("platform_core.Membership", on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["tenant", "product", "warehouse", "created_at"], name="wms_move_history_idx")]


class StockReservation(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        CONSUMED = "consumed", "Consumed"
        RELEASED = "released", "Released"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    reference_id = models.UUIDField()
    idempotency_key = models.UUIDField()
    payload_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    created_by = models.ForeignKey("platform_core.Membership", on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "reference_id"], name="wms_res_tenant_ref_uniq"),
            models.UniqueConstraint(fields=["tenant", "idempotency_key"], name="wms_res_tenant_key_uniq"),
            models.CheckConstraint(condition=models.Q(status__in=["active", "consumed", "released"]), name="wms_res_status_valid"),
        ]
        ordering = ["-created_at", "-id"]


class StockReservationLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    reservation = models.ForeignKey(StockReservation, related_name="lines", on_delete=models.PROTECT)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT)
    location = models.ForeignKey(Location, on_delete=models.PROTECT)
    quantity = models.PositiveBigIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["reservation", "product", "location"], name="wms_res_line_scope_uniq"),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="wms_res_line_qty_positive"),
        ]

