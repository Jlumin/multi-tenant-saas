from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import generics, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from .access import membership_for, stores_for
from .images import private_image_response
from .models import AuditEvent, Membership, Tenant, TenantBranding
from .serializers import AuditSerializer, ImageUploadInput, MemberInput, MembershipSerializer, StoreSerializer
from .services import audit, save_member, save_store


class BrandingInput(serializers.Serializer):
    brand_name = serializers.CharField(max_length=120, allow_blank=True, trim_whitespace=True, required=False)
    primary_color = serializers.RegexField(r"^#[0-9A-Fa-f]{6}$", required=False)
    accent_color = serializers.RegexField(r"^#[0-9A-Fa-f]{6}$", required=False)

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields) if isinstance(self.initial_data, dict) else set()
        if unknown:
            raise serializers.ValidationError({key: "Unknown field." for key in sorted(unknown)})
        if not attrs:
            raise serializers.ValidationError("At least one branding setting is required.")
        for key in ("primary_color", "accent_color"):
            if key in attrs:
                attrs[key] = attrs[key].upper()
        return attrs


def _branding_payload(request, tenant, branding):
    return {
        "tenant_id": str(tenant.pk),
        "brand_name": branding.brand_name or tenant.name,
        "primary_color": branding.primary_color,
        "accent_color": branding.accent_color,
        "logo_url": f"/api/v1/tenants/{tenant.pk}/branding/logo/" if branding.logo else None,
    }


class TenantBrandingView(APIView):
    def get(self, request, tenant_id):
        member = membership_for(request, tenant_id)
        branding = TenantBranding.objects.filter(tenant=member.tenant).first()
        if branding is None:
            branding = TenantBranding(tenant=member.tenant, brand_name=member.tenant.name)
        return Response(_branding_payload(request, member.tenant, branding))

    @transaction.atomic
    def patch(self, request, tenant_id):
        member = membership_for(request, tenant_id, admin=True)
        tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
        serializer = BrandingInput(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        branding, _ = TenantBranding.objects.get_or_create(tenant=tenant, defaults={"brand_name": tenant.name})
        for field, value in serializer.validated_data.items():
            setattr(branding, field, value)
        branding.save()
        audit(request, "tenant.branding.updated", tenant=tenant, target=tenant.pk)
        return Response(_branding_payload(request, tenant, branding))


class TenantBrandLogoView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, tenant_id):
        member = membership_for(request, tenant_id)
        branding = TenantBranding.objects.filter(tenant=member.tenant).first()
        return private_image_response(branding.logo if branding else None)

    @transaction.atomic
    def post(self, request, tenant_id):
        member = membership_for(request, tenant_id, admin=True)
        tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
        serializer = ImageUploadInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        branding, _ = TenantBranding.objects.get_or_create(tenant=tenant, defaults={"brand_name": tenant.name})
        old_name = branding.logo.name if branding.logo else ""
        branding.logo = serializer.validated_data["image"]
        branding.save(update_fields=["logo", "updated_at"])
        if old_name:
            transaction.on_commit(lambda: branding.logo.storage.delete(old_name))
        audit(request, "tenant.branding.logo.updated", tenant=tenant, target=tenant.pk)
        return Response(_branding_payload(request, tenant, branding))

    @transaction.atomic
    def delete(self, request, tenant_id):
        member = membership_for(request, tenant_id, admin=True)
        tenant = Tenant.objects.select_for_update().get(pk=member.tenant_id)
        branding = TenantBranding.objects.filter(tenant=tenant).first()
        if branding and branding.logo:
            old_name = branding.logo.name
            storage = branding.logo.storage
            branding.logo = ""
            branding.save(update_fields=["logo", "updated_at"])
            transaction.on_commit(lambda: storage.delete(old_name))
            audit(request, "tenant.branding.logo.deleted", tenant=tenant, target=tenant.pk)
        return Response(status=204)


class LoginThrottle(AnonRateThrottle):
    rate = "10/min"


class CSRFView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]

    @transaction.atomic
    def post(self, request):
        if not isinstance(request.data, dict):
            raise ValidationError("Invalid login payload.")
        username, password = request.data.get("username"), request.data.get("password")
        if not isinstance(username, str) or not isinstance(password, str) or len(username) > 150 or len(password) > 1024:
            raise ValidationError("Invalid login payload.")
        user = authenticate(request, username=username, password=password)
        if user is None:
            audit(request, "auth.login_failed")
            return Response({"error": {"code": "invalid_credentials", "details": "Invalid username or password.", "request_id": request.request_id}}, status=400)
        audit(request, "auth.login", target=user.pk, actor=user)
        login(request, user)
        return Response({"csrfToken": get_token(request), "username": user.username})


class LogoutView(APIView):
    @transaction.atomic
    def post(self, request):
        audit(request, "auth.logout", target=request.user.pk)
        logout(request)
        return Response({"status": "logged_out"})


class MeView(APIView):
    def get(self, request):
        members = Membership.objects.filter(user=request.user, is_active=True, tenant__is_active=True).select_related("tenant").order_by("tenant__slug")
        return Response({"username": request.user.username, "memberships": [
            {"tenant_id": str(m.tenant_id), "tenant_name": m.tenant.name, "role": m.role}
            for m in members
        ]})


class StoreList(generics.ListAPIView):
    serializer_class = StoreSerializer

    def get_queryset(self):
        return stores_for(membership_for(self.request, self.kwargs["tenant_id"]))

    def post(self, request, tenant_id):
        membership_for(request, tenant_id, admin=True)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        store = save_store(request, tenant_id, serializer.validated_data)
        return Response(StoreSerializer(store).data, status=201)


class StoreDetail(APIView):
    def get(self, request, tenant_id, store_id):
        from django.shortcuts import get_object_or_404
        member = membership_for(request, tenant_id)
        return Response(StoreSerializer(get_object_or_404(stores_for(member), pk=store_id)).data)

    def patch(self, request, tenant_id, store_id):
        membership_for(request, tenant_id, admin=True)
        serializer = StoreSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(StoreSerializer(save_store(request, tenant_id, serializer.validated_data, store_id)).data)


class MemberList(generics.ListAPIView):
    serializer_class = MembershipSerializer

    def get_queryset(self):
        membership_for(self.request, self.kwargs["tenant_id"], admin=True)
        return Membership.objects.filter(tenant_id=self.kwargs["tenant_id"]).select_related("user").prefetch_related("stores").order_by("created_at", "id")

    def post(self, request, tenant_id):
        membership_for(request, tenant_id, admin=True)
        serializer = MemberInput(data=request.data, context={"creating": True})
        serializer.is_valid(raise_exception=True)
        return Response(MembershipSerializer(save_member(request, tenant_id, serializer.validated_data)).data, status=201)


class MemberDetail(APIView):
    def patch(self, request, tenant_id, member_id):
        membership_for(request, tenant_id, admin=True)
        serializer = MemberInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(MembershipSerializer(save_member(request, tenant_id, serializer.validated_data, member_id)).data)


class AuditList(generics.ListAPIView):
    serializer_class = AuditSerializer

    def get_queryset(self):
        membership_for(self.request, self.kwargs["tenant_id"], admin=True)
        return AuditEvent.objects.filter(tenant_id=self.kwargs["tenant_id"])
