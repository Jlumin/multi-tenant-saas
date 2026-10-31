from rest_framework import serializers

from .models import ConsentEvent, Customer


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({key: "Unknown field." for key in sorted(unknown)})
        return super().to_internal_value(data)


class CustomerInput(StrictSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{1,40}$", required=False)
    name = serializers.CharField(max_length=120, required=False, trim_whitespace=True)
    email = serializers.EmailField(max_length=254, allow_blank=True, required=False)
    phone = serializers.CharField(max_length=40, allow_blank=True, required=False, trim_whitespace=True)
    is_active = serializers.BooleanField(required=False)
    version = serializers.IntegerField(min_value=1, required=False, write_only=True)

    def validate(self, attrs):
        if self.instance is None and not {"code", "name"}.issubset(attrs):
            raise serializers.ValidationError("code and name are required.")
        if self.instance is not None and "code" in attrs:
            raise serializers.ValidationError({"code": "Customer code is immutable after creation."})
        if self.instance is not None and "version" not in attrs:
            raise serializers.ValidationError({"version": "This field is required for updates."})
        if not self.partial and not attrs:
            raise serializers.ValidationError("At least one field is required.")
        return attrs


class CustomerOutput(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "code", "name", "email", "phone", "is_active", "version", "created_at", "updated_at"]
        read_only_fields = fields


class ConsentInput(StrictSerializer):
    purpose = serializers.ChoiceField(choices=ConsentEvent.Purpose.choices)
    granted = serializers.BooleanField()
    policy_version = serializers.RegexField(r"^[A-Za-z0-9._-]{1,40}$")


class ConsentOutput(serializers.ModelSerializer):
    class Meta:
        model = ConsentEvent
        fields = ["id", "purpose", "granted", "policy_version", "recorded_at"]
        read_only_fields = fields
