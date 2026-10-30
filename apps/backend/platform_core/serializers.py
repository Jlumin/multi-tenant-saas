from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models import AuditEvent, Membership, Store


class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = ["id", "name", "code", "is_active"]
        extra_kwargs = {"name": {"required": True}, "code": {"required": True}}


class MembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    store_ids = serializers.PrimaryKeyRelatedField(source="stores", many=True, read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "username", "role", "is_active", "store_ids"]


class MemberInput(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False, required=False)
    role = serializers.ChoiceField(choices=Membership.Role.choices, required=False)
    is_active = serializers.BooleanField(required=False)
    store_ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=100)

    def validate_username(self, value):
        user = get_user_model()(username=value)
        try:
            user._meta.get_field("username").run_validators(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        return value

    def validate(self, attrs):
        if self.context.get("creating"):
            if not attrs.get("username") or "password" not in attrs:
                raise serializers.ValidationError("Username and password are required.")
            try:
                validate_password(attrs["password"], get_user_model()(username=attrs["username"]))
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": exc.messages}) from exc
        elif "username" in attrs or "password" in attrs:
            raise serializers.ValidationError("Identity cannot be changed through membership updates.")
        return attrs


class AuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = ["id", "actor_id", "action", "target_id", "request_id", "created_at"]
