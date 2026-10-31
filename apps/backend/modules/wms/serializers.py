from rest_framework import serializers
from django.urls import reverse

from .models import (
    InventoryDocument,
    InventoryDocumentLine,
    Location,
    PackageUnit,
    Product,
    StockBalance,
    StockMovement,
    Warehouse,
)


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Unknown field." for key in sorted(unknown)})
        return super().to_internal_value(data)


class ProductInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$", max_length=40)
    name = serializers.CharField(max_length=120)
    base_unit = serializers.RegexField(r"^[A-Za-z][A-Za-z0-9_-]{0,19}$", max_length=20, default="PCS")
    is_active = serializers.BooleanField(default=True)
    version = serializers.IntegerField(min_value=1, required=False)

    def validate_code(self, value):
        return value.strip().upper()

    def validate_base_unit(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        if self.instance is not None:
            if "version" not in attrs:
                raise serializers.ValidationError({"version": "This field is required for updates."})
            for immutable in ("code", "base_unit"):
                if immutable in attrs and attrs[immutable] != getattr(self.instance, immutable):
                    raise serializers.ValidationError({immutable: "This field is immutable after creation."})
        elif "version" in attrs:
            raise serializers.ValidationError({"version": "This field is read-only."})
        return attrs


class ProductOutput(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    def get_image_url(self, product):
        if not product.image:
            return None
        return reverse("wms-product-image", kwargs={"tenant_id": product.tenant_id, "product_id": product.pk})

    class Meta:
        model = Product
        fields = ["id", "code", "name", "base_unit", "is_active", "version", "image_url", "created_at", "updated_at"]


class PackageUnitInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$", max_length=24)
    name = serializers.CharField(max_length=60)
    base_quantity = serializers.IntegerField(min_value=1, max_value=1_000_000)

    def validate_code(self, value):
        return value.strip().upper()


class PackageUnitStatusInput(StrictSerializer):
    is_active = serializers.BooleanField()


class PackageUnitOutput(serializers.ModelSerializer):
    class Meta:
        model = PackageUnit
        fields = ["id", "product_id", "code", "name", "base_quantity", "is_base", "is_active"]


class WarehouseInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$", max_length=40)
    name = serializers.CharField(max_length=120)
    is_active = serializers.BooleanField(default=True)
    version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if self.instance is not None:
            if "version" not in attrs:
                raise serializers.ValidationError({"version": "This field is required for updates."})
            if "code" in attrs and attrs["code"] != self.instance.code:
                raise serializers.ValidationError({"code": "Warehouse code is immutable after creation."})
        elif "version" in attrs:
            raise serializers.ValidationError({"version": "This field is read-only."})
        return attrs

    def validate_code(self, value):
        return value.strip().upper()


class WarehouseOutput(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["id", "code", "name", "is_active", "version", "created_at"]


class LocationInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$", max_length=40)
    name = serializers.CharField(max_length=120)
    is_active = serializers.BooleanField(default=True, required=False)
    version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if self.instance is not None:
            if "version" not in attrs:
                raise serializers.ValidationError({"version": "This field is required for updates."})
            if "code" in attrs and attrs["code"] != self.instance.code:
                raise serializers.ValidationError({"code": "Location code is immutable after creation."})
        elif "version" in attrs:
            raise serializers.ValidationError({"version": "This field is read-only."})
        return attrs

    def validate_code(self, value):
        return value.strip().upper()


class LocationOutput(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ["id", "warehouse_id", "code", "name", "is_default", "is_active", "version"]


class DocumentLineInput(StrictSerializer):
    product_id = serializers.UUIDField()
    package_unit_id = serializers.UUIDField()
    location_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=2_147_483_647)


class DocumentInput(StrictSerializer):
    kind = serializers.ChoiceField(choices=InventoryDocument.Kind.choices)
    warehouse_id = serializers.UUIDField()
    document_code = serializers.RegexField(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$", max_length=40)
    idempotency_key = serializers.UUIDField()
    note = serializers.CharField(max_length=500, allow_blank=True, default="")
    lines = DocumentLineInput(many=True, allow_empty=False)

    def validate_document_code(self, value):
        return value.strip().upper()


class DocumentEditInput(StrictSerializer):
    version = serializers.IntegerField(min_value=1)
    note = serializers.CharField(max_length=500, allow_blank=True, required=False)
    lines = DocumentLineInput(many=True, allow_empty=False)


class DocumentLineOutput(serializers.ModelSerializer):
    product_code = serializers.CharField(source="product.code", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    unit_code = serializers.CharField(source="package_unit.code", read_only=True)
    location_code = serializers.CharField(source="location.code", read_only=True)

    class Meta:
        model = InventoryDocumentLine
        fields = ["id", "product_id", "product_code", "product_name", "package_unit_id", "unit_code",
                  "location_id", "location_code", "quantity", "conversion_snapshot", "base_quantity"]


class DocumentOutput(serializers.ModelSerializer):
    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)
    lines = DocumentLineOutput(many=True, read_only=True)
    created_by_id = serializers.UUIDField(read_only=True)
    posted_by_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = InventoryDocument
        fields = ["id", "kind", "status", "document_code", "warehouse_id", "warehouse_code", "note",
                  "version", "created_at", "posted_at", "created_by_id", "posted_by_id", "lines"]


class StockBalanceOutput(serializers.ModelSerializer):
    product_code = serializers.CharField(source="product.code", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)
    location_code = serializers.CharField(source="location.code", read_only=True)

    class Meta:
        model = StockBalance
        fields = ["product_id", "product_code", "product_name", "warehouse_id", "warehouse_code",
                  "location_id", "location_code", "quantity", "updated_at"]


class StockMovementOutput(serializers.ModelSerializer):
    product_code = serializers.CharField(source="product.code", read_only=True)
    warehouse_code = serializers.CharField(source="warehouse.code", read_only=True)
    location_code = serializers.CharField(source="location.code", read_only=True)
    document_code = serializers.CharField(source="document.document_code", read_only=True)

    class Meta:
        model = StockMovement
        fields = ["id", "product_id", "product_code", "warehouse_id", "warehouse_code", "location_id",
                  "location_code", "document_id", "document_code", "quantity_delta", "created_by_id", "created_at"]

