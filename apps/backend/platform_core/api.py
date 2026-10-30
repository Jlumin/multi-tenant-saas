from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from django.db import transaction
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from .access import membership_for, stores_for
from .models import AuditEvent, Membership
from .serializers import AuditSerializer, MemberInput, MembershipSerializer, StoreSerializer
from .services import audit, save_member, save_store


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
