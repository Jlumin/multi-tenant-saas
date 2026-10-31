import hashlib
import json

from django.db import IntegrityError, connection, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from platform_core.access import membership_for
from platform_core.models import Tenant
from platform_core.services import audit
from .models import (
    InventoryDocument,
    InventoryDocumentLine,
    Location,
    PackageUnit,
    Product,
    StockBalance,
    StockMovement,
    StockReservation,
    StockReservationLine,
    Warehouse,
)


class Conflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "The resource changed; reload and try again."


def _admin(request, tenant_id):
    member = membership_for(request, tenant_id)
    if member.role != "admin":
        audit(request, "access.denied", tenant=member.tenant)
        raise PermissionDenied("Tenant administrator role required.")
    return member


def _versioned_save(request, instance, data, *, action, version):
    tenant = instance.tenant
    if version != instance.version:
        raise Conflict("This record was changed by someone else. Refresh and retry.")
    for key, value in data.items():
        setattr(instance, key, value)
    instance.version += 1
    try:
        instance.save()
    except IntegrityError as exc:
        raise ValidationError({"code": "Code already exists in this scope."}) from exc
    audit(request, action, tenant=tenant, target=instance.pk)
    return instance


@transaction.atomic
def create_product(request, tenant_id, data):
    member = _admin(request, tenant_id)
    product = Product(tenant=member.tenant, **data)
    try:
        product.save()
        PackageUnit.objects.create(
            tenant=member.tenant, product=product, code="BASE", name=product.base_unit,
            base_quantity=1, is_base=True,
        )
    except IntegrityError as exc:
        raise ValidationError({"code": "Product code already exists in this tenant."}) from exc
    audit(request, "wms.product.created", tenant=member.tenant, target=product.pk)
    return product


@transaction.atomic
def update_product(request, tenant_id, product_id, data):
    member = _admin(request, tenant_id)
    product = get_object_or_404(Product, tenant=member.tenant, pk=product_id)
    if data.get("is_active") is False and StockBalance.objects.filter(tenant=member.tenant, product=product, quantity__gt=0).exists():
        raise ValidationError("A product with stock cannot be deactivated.")
    if data.get("is_active") is False and InventoryDocumentLine.objects.filter(
        tenant=member.tenant, product=product, document__status=InventoryDocument.Status.DRAFT,
    ).exists():
        raise ValidationError("A product on a draft document cannot be deactivated.")
    if data.get("is_active") is False and StockReservationLine.objects.filter(
        tenant=member.tenant, product=product, reservation__status=StockReservation.Status.ACTIVE,
    ).exists():
        raise ValidationError("A product with reserved stock cannot be deactivated.")
    return _versioned_save(request, product, data, action="wms.product.updated", version=data.pop("version"))


@transaction.atomic
def set_product_image(request, tenant_id, product_id, image):
    member = _admin(request, tenant_id)
    product = get_object_or_404(Product.objects.select_for_update(), tenant=member.tenant, pk=product_id)
    old_name = product.image.name if product.image else ""
    storage = product.image.storage
    product.image = image
    product.version += 1
    product.save(update_fields=["image", "version", "updated_at"])
    if old_name:
        transaction.on_commit(lambda: storage.delete(old_name))
    audit(request, "wms.product.image.updated", tenant=member.tenant, target=product.pk)
    return product


@transaction.atomic
def remove_product_image(request, tenant_id, product_id):
    member = _admin(request, tenant_id)
    product = get_object_or_404(Product.objects.select_for_update(), tenant=member.tenant, pk=product_id)
    if product.image:
        old_name = product.image.name
        storage = product.image.storage
        product.image = ""
        product.version += 1
        product.save(update_fields=["image", "version", "updated_at"])
        transaction.on_commit(lambda: storage.delete(old_name))
        audit(request, "wms.product.image.deleted", tenant=member.tenant, target=product.pk)
    return product


@transaction.atomic
def update_warehouse(request, tenant_id, warehouse_id, data):
    member = _admin(request, tenant_id)
    warehouse = get_object_or_404(Warehouse, tenant=member.tenant, pk=warehouse_id)
    if data.get("is_active") is False and StockBalance.objects.filter(tenant=member.tenant, warehouse=warehouse, quantity__gt=0).exists():
        raise ValidationError("A warehouse with stock cannot be deactivated.")
    if data.get("is_active") is False and InventoryDocument.objects.filter(
        tenant=member.tenant, warehouse=warehouse, status=InventoryDocument.Status.DRAFT,
    ).exists():
        raise ValidationError("A warehouse with draft documents cannot be deactivated.")
    if data.get("is_active") is False and StockReservationLine.objects.filter(
        tenant=member.tenant, warehouse=warehouse, reservation__status=StockReservation.Status.ACTIVE,
    ).exists():
        raise ValidationError("A warehouse with reserved stock cannot be deactivated.")
    version = data.pop("version", None)
    return _versioned_save(request, warehouse, data, action="wms.warehouse.updated", version=version)


@transaction.atomic
def update_location(request, tenant_id, location_id, data):
    member = _admin(request, tenant_id)
    location = get_object_or_404(Location, tenant=member.tenant, pk=location_id)
    if location.is_default and data.get("is_active") is False:
        raise ValidationError("The default unassigned location cannot be deactivated.")
    if data.get("is_active") is False and StockBalance.objects.filter(tenant=member.tenant, location=location, quantity__gt=0).exists():
        raise ValidationError("A location with stock cannot be deactivated.")
    if data.get("is_active") is False and InventoryDocumentLine.objects.filter(
        tenant=member.tenant, location=location, document__status=InventoryDocument.Status.DRAFT,
    ).exists():
        raise ValidationError("A location on a draft document cannot be deactivated.")
    if data.get("is_active") is False and StockReservationLine.objects.filter(
        tenant=member.tenant, location=location, reservation__status=StockReservation.Status.ACTIVE,
    ).exists():
        raise ValidationError("A location with reserved stock cannot be deactivated.")
    version = data.pop("version", None)
    return _versioned_save(request, location, data, action="wms.location.updated", version=version)


@transaction.atomic
def create_package_unit(request, tenant_id, product_id, data):
    member = _admin(request, tenant_id)
    product = get_object_or_404(Product, tenant=member.tenant, pk=product_id)
    if not product.is_active:
        raise ValidationError("Cannot add a unit to an inactive product.")
    if data["base_quantity"] > 1_000_000:
        raise ValidationError({"base_quantity": "Must not exceed 1000000."})
    unit = PackageUnit(tenant=member.tenant, product=product, **data)
    try:
        unit.save()
    except IntegrityError as exc:
        raise ValidationError({"code": "Unit code already exists for this product."}) from exc
    audit(request, "wms.package_unit.created", tenant=member.tenant, target=unit.pk)
    return unit


@transaction.atomic
def set_package_unit_active(request, tenant_id, product_id, package_unit_id, active):
    member = _admin(request, tenant_id)
    unit = get_object_or_404(PackageUnit, tenant=member.tenant, product_id=product_id, pk=package_unit_id)
    if unit.is_base and not active:
        raise ValidationError("The base unit cannot be deactivated.")
    if not active and InventoryDocumentLine.objects.filter(tenant=member.tenant, package_unit=unit, document__status=InventoryDocument.Status.DRAFT).exists():
        raise ValidationError("A package unit used by a draft document cannot be deactivated.")
    if unit.is_active != active:
        unit.is_active = active
        unit.save(update_fields=["is_active"])
        action = "wms.package_unit.activated" if active else "wms.package_unit.deactivated"
        audit(request, action, tenant=member.tenant, target=unit.pk)
    return unit


@transaction.atomic
def create_warehouse(request, tenant_id, data):
    member = _admin(request, tenant_id)
    warehouse = Warehouse(tenant=member.tenant, **data)
    try:
        warehouse.save()
        Location.objects.create(
            tenant=member.tenant, warehouse=warehouse, code="UNASSIGNED",
            name="未分配儲位", is_default=True,
        )
    except IntegrityError as exc:
        raise ValidationError({"code": "Warehouse code already exists in this tenant."}) from exc
    audit(request, "wms.warehouse.created", tenant=member.tenant, target=warehouse.pk)
    return warehouse


@transaction.atomic
def create_location(request, tenant_id, warehouse_id, data):
    member = _admin(request, tenant_id)
    warehouse = get_object_or_404(Warehouse, tenant=member.tenant, pk=warehouse_id)
    if not warehouse.is_active:
        raise ValidationError("Cannot add a location to an inactive warehouse.")
    location = Location(tenant=member.tenant, warehouse=warehouse, **data)
    try:
        location.save()
    except IntegrityError as exc:
        raise ValidationError({"code": "Location code already exists in this warehouse."}) from exc
    audit(request, "wms.location.created", tenant=member.tenant, target=location.pk)
    return location


def _normalized_payload(kind, warehouse_id, document_code, note, lines):
    canonical = {
        "kind": kind,
        "warehouse_id": str(warehouse_id),
        "document_code": document_code,
        "note": note,
        "lines": sorted([
            {"product_id": str(line["product_id"]), "package_unit_id": str(line["package_unit_id"]),
             "location_id": str(line["location_id"]), "quantity": line["quantity"]}
            for line in lines
        ], key=lambda item: (item["product_id"], item["location_id"], item["package_unit_id"])),
    }
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _load_document_lines(tenant, warehouse, lines):
    if not lines:
        raise ValidationError({"lines": "At least one line is required."})
    loaded = []
    total = 0
    for index, line in enumerate(lines):
        product = Product.objects.filter(tenant=tenant, pk=line["product_id"], is_active=True).first()
        unit = PackageUnit.objects.filter(tenant=tenant, product_id=line["product_id"], pk=line["package_unit_id"], is_active=True).first()
        location = Location.objects.filter(tenant=tenant, warehouse=warehouse, pk=line["location_id"], is_active=True).first()
        if not product or not unit or not location:
            raise ValidationError({"lines": {index: "Product, unit, or location is unavailable in this warehouse."}})
        if unit.product_id != product.pk:
            raise ValidationError({"lines": {index: "Unit must belong to the selected product."}})
        base_quantity = line["quantity"] * unit.base_quantity
        if base_quantity > 2_147_483_647:
            raise ValidationError({"lines": {index: "Converted quantity exceeds the supported maximum."}})
        total += base_quantity
        loaded.append((line, product, unit, location, base_quantity))
    return loaded


@transaction.atomic
def create_document(request, tenant_id, data):
    member = membership_for(request, tenant_id)
    if member.role == "viewer":
        audit(request, "access.denied", tenant=member.tenant)
        raise PermissionDenied("A manager or tenant administrator role is required.")
    warehouse = Warehouse.objects.filter(tenant=member.tenant, pk=data["warehouse_id"], is_active=True).first()
    if warehouse is None:
        raise NotFound()
    loaded = _load_document_lines(member.tenant, warehouse, data["lines"])
    digest = _normalized_payload(data["kind"], warehouse.pk, data["document_code"], data.get("note", ""), data["lines"])
    existing = InventoryDocument.objects.filter(tenant=member.tenant, idempotency_key=data["idempotency_key"]).first()
    if existing:
        if existing.payload_digest != digest:
            raise Conflict("Idempotency key was already used with a different payload.")
        return existing, False
    try:
        with transaction.atomic():
            doc = InventoryDocument.objects.create(
                tenant=member.tenant, warehouse=warehouse, kind=data["kind"],
                document_code=data["document_code"], idempotency_key=data["idempotency_key"],
                payload_digest=digest, note=data.get("note", ""), created_by=member,
            )
            InventoryDocumentLine.objects.bulk_create([
                InventoryDocumentLine(
                    tenant=member.tenant, document=doc, product=product, package_unit=unit,
                    location=location, quantity=line["quantity"],
                    conversion_snapshot=unit.base_quantity, base_quantity=base_quantity,
                ) for line, product, unit, location, base_quantity in loaded
            ])
    except IntegrityError as exc:
        raise Conflict("Document code or idempotency key already exists.") from exc
    audit(request, f"wms.{doc.kind}.drafted", tenant=member.tenant, target=doc.pk)
    return doc, True


@transaction.atomic
def replace_document_lines(request, tenant_id, document_id, data):
    # Tenant row serializes stock-document edits with posting and avoids mixed line snapshots.
    member = membership_for(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
    member = membership_for(request, tenant_id)
    if member.role == "viewer":
        raise PermissionDenied("A manager or tenant administrator role is required.")
    doc = get_object_or_404(InventoryDocument.objects.select_for_update(), tenant=tenant, pk=document_id)
    if doc.status != InventoryDocument.Status.DRAFT:
        raise Conflict("Only a draft document can be edited.")
    if data.get("version") != doc.version:
        raise Conflict("Document lines changed; reload and retry.")
    loaded = _load_document_lines(tenant, doc.warehouse, data["lines"])
    doc.note = data.get("note", doc.note)
    doc.version += 1
    doc.save(update_fields=["note", "version"])
    doc.lines.all().delete()
    InventoryDocumentLine.objects.bulk_create([
        InventoryDocumentLine(tenant=tenant, document=doc, product=product, package_unit=unit,
                              location=location, quantity=line["quantity"],
                              conversion_snapshot=unit.base_quantity, base_quantity=base_quantity)
        for line, product, unit, location, base_quantity in loaded
    ])
    audit(request, "wms.document.draft_updated", tenant=tenant, target=doc.pk)
    return doc


@transaction.atomic
def cancel_document(request, tenant_id, document_id):
    member = membership_for(request, tenant_id)
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
    member = membership_for(request, tenant_id)
    if member.role == "viewer":
        raise PermissionDenied("A manager or tenant administrator role is required.")
    doc = get_object_or_404(InventoryDocument.objects.select_for_update(), tenant=tenant, pk=document_id)
    if doc.status == InventoryDocument.Status.CANCELED:
        return doc
    if doc.status != InventoryDocument.Status.DRAFT:
        raise Conflict("Posted inventory documents cannot be canceled; use a future correction workflow.")
    doc.status = InventoryDocument.Status.CANCELED
    doc.save(update_fields=["status"])
    audit(request, "wms.document.canceled", tenant=tenant, target=doc.pk)
    return doc


@transaction.atomic
def post_document(request, tenant_id, document_id):
    member = membership_for(request, tenant_id)
    # A tenant-level mutex makes concurrent issue posting serializable, including missing balances.
    tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
    member = _admin(request, tenant_id)
    doc = get_object_or_404(
        InventoryDocument.objects.select_for_update().prefetch_related("lines__product", "lines__location"),
        tenant=tenant, pk=document_id,
    )
    if doc.status == InventoryDocument.Status.POSTED:
        return doc
    if doc.status != InventoryDocument.Status.DRAFT:
        raise Conflict("Only a draft document can be posted.")
    lines = list(doc.lines.select_related("product", "location", "package_unit"))
    if not lines:
        raise ValidationError("An empty document cannot be posted.")
    if not doc.warehouse.is_active or any(not line.product.is_active or not line.location.is_active for line in lines):
        raise ValidationError("Inactive products, warehouses, or locations cannot be posted.")
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('wms.allow_balance_write', 'on', true)")
    for line in lines:
        balance, _ = StockBalance.objects.get_or_create(
            tenant=tenant, product=line.product, warehouse=doc.warehouse, location=line.location,
            defaults={"quantity": 0},
        )
        balance = StockBalance.objects.select_for_update().get(pk=balance.pk)
        delta = line.base_quantity if doc.kind == InventoryDocument.Kind.RECEIPT else -line.base_quantity
        reserved = StockReservationLine.objects.filter(
            tenant=tenant, product=line.product, warehouse=doc.warehouse, location=line.location,
            reservation__status=StockReservation.Status.ACTIVE,
        ).aggregate(total=Sum("quantity"))["total"] or 0
        if balance.quantity + delta < reserved:
            raise ValidationError({"stock": f"Insufficient stock for product {line.product.code}."})
        balance.quantity += delta
        balance.save(update_fields=["quantity", "updated_at"])
        StockMovement.objects.create(
            tenant=tenant, document=doc, line=line, product=line.product,
            warehouse=doc.warehouse, location=line.location, quantity_delta=delta,
            created_by=member,
        )
    doc.status = InventoryDocument.Status.POSTED
    doc.posted_by = member
    doc.posted_at = timezone.now()
    doc.save(update_fields=["status", "posted_by", "posted_at"])
    audit(request, f"wms.{doc.kind}.posted", tenant=tenant, target=doc.pk)
    return doc

