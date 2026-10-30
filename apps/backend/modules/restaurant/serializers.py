from decimal import Decimal

from rest_framework import serializers

from .models import MenuCategory, MenuItem, Order, OrderLine, PaymentEvent, PosShift, Table


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Unknown field." for key in sorted(unknown)})
        return super().to_internal_value(data)


class TableInput(StrictSerializer):
    store_id = serializers.UUIDField()
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{1,32}$")
    name = serializers.CharField(max_length=80, trim_whitespace=True)


class MenuCategoryInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{1,32}$")
    name = serializers.CharField(max_length=80, trim_whitespace=True)
    sort_order = serializers.IntegerField(min_value=0, max_value=32767, required=False, default=0)
    is_active = serializers.BooleanField(required=False, default=True)


class MenuItemInput(StrictSerializer):
    category_id = serializers.UUIDField()
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{1,32}$")
    name = serializers.CharField(max_length=120, trim_whitespace=True)
    description = serializers.CharField(max_length=300, allow_blank=True, required=False, default="", trim_whitespace=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"))
    sort_order = serializers.IntegerField(min_value=0, max_value=32767, required=False, default=0)
    is_active = serializers.BooleanField(required=False, default=True)


class OrderLineInput(StrictSerializer):
    menu_item_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=99)
    note = serializers.CharField(max_length=200, allow_blank=True, required=False, default="", trim_whitespace=True)


class OrderInput(StrictSerializer):
    idempotency_key = serializers.UUIDField()
    lines = OrderLineInput(many=True, allow_empty=False, max_length=30)
    note = serializers.CharField(max_length=300, allow_blank=True, required=False, default="", trim_whitespace=True)


class ShiftOpenInput(StrictSerializer):
    opening_float = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), default=Decimal("0.00"))


class ShiftCloseInput(StrictSerializer):
    closing_cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class PaymentInput(StrictSerializer):
    idempotency_key = serializers.UUIDField()


class RefundInput(StrictSerializer):
    idempotency_key = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(max_length=300, trim_whitespace=True)


class TableOutput(serializers.ModelSerializer):
    class Meta:
        model = Table
        fields = ["id", "store_id", "code", "name", "is_active", "created_at"]
        read_only_fields = fields


class CategoryOutput(serializers.ModelSerializer):
    class Meta:
        model = MenuCategory
        fields = ["id", "code", "name", "sort_order", "is_active"]
        read_only_fields = fields


class ItemOutput(serializers.ModelSerializer):
    category_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = MenuItem
        fields = ["id", "category_id", "code", "name", "description", "price", "currency", "sort_order", "is_active"]
        read_only_fields = fields


class LineOutput(serializers.ModelSerializer):
    class Meta:
        model = OrderLine
        fields = ["id", "menu_item_id", "item_code", "item_name", "quantity", "unit_price", "line_total", "note"]
        read_only_fields = fields


class OrderOutput(serializers.ModelSerializer):
    table_code = serializers.CharField(source="table.code", allow_null=True, read_only=True)
    lines = LineOutput(many=True, read_only=True)

    class Meta:
        model = Order
        fields = ["id", "store_id", "table_id", "table_code", "source", "order_code", "status", "payment_status", "currency", "total_amount", "note", "created_at", "lines"]
        read_only_fields = fields


class ShiftOutput(serializers.ModelSerializer):
    class Meta:
        model = PosShift
        fields = ["id", "store_id", "opened_by_membership_id", "opening_float", "opened_at", "closed_by_membership_id", "closing_cash", "cash_variance", "closed_at"]
        read_only_fields = fields


class PaymentOutput(serializers.ModelSerializer):
    class Meta:
        model = PaymentEvent
        fields = ["id", "order_id", "shift_id", "kind", "amount", "reason", "created_at"]
        read_only_fields = fields
