from rest_framework import serializers

from .models import Listing, Order, OrderLine


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Unknown field." for key in sorted(unknown)})
        return super().to_internal_value(data)


class ListingInput(StrictSerializer):
    product_id = serializers.UUIDField()
    warehouse_id = serializers.UUIDField()
    title = serializers.CharField(max_length=160, trim_whitespace=True)
    category = serializers.CharField(max_length=80, trim_whitespace=True, allow_blank=True, required=False, default="")
    currency = serializers.RegexField(r"^[A-Z]{3}$", default="TWD")
    price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)


class ListingOutput(serializers.ModelSerializer):
    available_quantity = serializers.IntegerField(read_only=True)
    product_image_url = serializers.CharField(read_only=True, allow_null=True)

    class Meta:
        model = Listing
        fields = ["id", "product_id", "warehouse_id", "product_code", "title", "category", "currency", "price", "available_quantity", "product_image_url", "is_active", "version", "created_at"]
        read_only_fields = fields


class OrderLineInput(StrictSerializer):
    listing_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=2_147_483_647)


class OrderInput(StrictSerializer):
    customer_id = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    lines = OrderLineInput(many=True, allow_empty=False, max_length=100)


class OrderLineOutput(serializers.ModelSerializer):
    class Meta:
        model = OrderLine
        fields = ["id", "product_code", "title", "warehouse_id", "quantity", "unit_price", "line_total"]
        read_only_fields = fields


class OrderOutput(serializers.ModelSerializer):
    lines = OrderLineOutput(many=True, read_only=True)
    payment_status = serializers.CharField(source="payment.status", read_only=True)
    payment_provider = serializers.CharField(source="payment.provider", read_only=True)

    class Meta:
        model = Order
        fields = ["id", "order_code", "customer_id", "customer_name", "customer_email", "status", "currency", "total_amount", "payment_status", "payment_provider", "created_at", "lines"]
        read_only_fields = fields
