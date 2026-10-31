from io import BytesIO
from urllib.parse import urlencode

import qrcode
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from qrcode.image.svg import SvgPathImage
from rest_framework import generics
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from django.conf import settings
from platform_core.access import membership_for
from .models import MenuCategory, MenuItem, Order, Table
from .serializers import (
    ItemOutput, MenuCategoryInput, CategoryOutput, MenuItemInput, OrderInput, OrderOutput,
    PaymentInput, PaymentOutput, RefundInput, ShiftCloseInput, ShiftOpenInput, ShiftOutput,
    TableInput, TableOutput,
)
from .services import (
    cash_payment, cash_refund, close_shift, create_category, create_item, create_pos_order,
    create_qr_order, create_table, current_shift, open_shift, order_action, qr_menu,
    rotate_table_token, set_table_active, update_item,
)


def _qr_links(request, token):
    url = settings.FRONTEND_ORIGIN + "/?" + urlencode({"qr": token})
    return {"qr_url": url, "qr_code_url": f"/api/v1/restaurant/qr/{token}/code.svg"}


class CategoryList(generics.ListAPIView):
    serializer_class = CategoryOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        return MenuCategory.objects.filter(tenant=member.tenant).order_by("sort_order", "name", "id")

    def post(self, request, tenant_id):
        serializer = MenuCategoryInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = create_category(request, tenant_id, dict(serializer.validated_data))
        return Response(CategoryOutput(row).data, status=201)


class ItemList(generics.ListAPIView):
    serializer_class = ItemOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        return MenuItem.objects.filter(tenant=member.tenant).select_related("category").order_by("category__sort_order", "sort_order", "name", "id")

    def post(self, request, tenant_id):
        serializer = MenuItemInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = create_item(request, tenant_id, dict(serializer.validated_data))
        return Response(ItemOutput(row).data, status=201)


class ItemDetail(APIView):
    def patch(self, request, tenant_id, item_id):
        member = membership_for(request, tenant_id)
        if member.role != "admin":
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Tenant administrator role required.")
        serializer = MenuItemInput(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        row = update_item(request, tenant_id, item_id, dict(serializer.validated_data))
        return Response(ItemOutput(row).data)


class TableList(generics.ListAPIView):
    serializer_class = TableOutput

    def get_queryset(self):
        from platform_core import application as platform
        member = membership_for(self.request, self.kwargs["tenant_id"])
        store_id = self.kwargs["store_id"]
        platform.validate_store_reference(tenant_id=member.tenant_id, store_id=store_id)
        if not platform.membership_can_access_store(membership_id=member.pk, store_id=store_id):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("This account is not assigned to the selected active store.")
        return Table.objects.filter(tenant=member.tenant, store_id=store_id).order_by("code", "id")

    def post(self, request, tenant_id, store_id):
        serializer = TableInput(data={**request.data, "store_id": str(store_id)})
        serializer.is_valid(raise_exception=True)
        table, token = create_table(request, tenant_id, dict(serializer.validated_data))
        return Response({**TableOutput(table).data, "qr_token": token, **_qr_links(request, token)}, status=201)


class TableDetail(APIView):
    def patch(self, request, tenant_id, table_id):
        if set(request.data) != {"is_active"} or not isinstance(request.data.get("is_active"), bool):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"is_active": "Provide only a boolean is_active value."})
        table = set_table_active(request, tenant_id, table_id, request.data["is_active"])
        return Response(TableOutput(table).data)

    def post(self, request, tenant_id, table_id, action):
        if action != "rotate-qr":
            raise NotFound()
        table, token = rotate_table_token(request, tenant_id, table_id)
        return Response({**TableOutput(table).data, "qr_token": token, **_qr_links(request, token)})


class StoreOrderList(generics.ListAPIView):
    serializer_class = OrderOutput

    def get_queryset(self):
        from platform_core import application as platform
        member = membership_for(self.request, self.kwargs["tenant_id"])
        store_id = self.kwargs["store_id"]
        platform.validate_store_reference(tenant_id=member.tenant_id, store_id=store_id)
        if not platform.membership_can_access_store(membership_id=member.pk, store_id=store_id):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("This account is not assigned to the selected active store.")
        return Order.objects.filter(tenant=member.tenant, store_id=store_id).prefetch_related("lines").order_by("-created_at", "-id")

    def post(self, request, tenant_id, store_id):
        serializer = OrderInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        row, created = create_pos_order(request, tenant_id, store_id, dict(serializer.validated_data))
        row = Order.objects.prefetch_related("lines").get(pk=row.pk)
        return Response(OrderOutput(row).data, status=201 if created else 200)


class StoreShift(APIView):
    def get(self, request, tenant_id, store_id):
        shift = current_shift(request, tenant_id, store_id)
        return Response(ShiftOutput(shift).data if shift else None)

    def post(self, request, tenant_id, store_id, action):
        if action == "open":
            serializer = ShiftOpenInput(data=request.data)
            serializer.is_valid(raise_exception=True)
            shift = open_shift(request, tenant_id, store_id, serializer.validated_data["opening_float"])
        elif action == "close":
            serializer = ShiftCloseInput(data=request.data)
            serializer.is_valid(raise_exception=True)
            shift = close_shift(request, tenant_id, store_id, serializer.validated_data["closing_cash"])
        else:
            raise NotFound()
        return Response(ShiftOutput(shift).data, status=201 if action == "open" else 200)


class StoreOrderAction(APIView):
    def post(self, request, tenant_id, order_id, action):
        if action in ("accept", "prepare", "ready", "serve", "cancel"):
            order = order_action(request, tenant_id, order_id, action)
        elif action == "pay-cash":
            serializer = PaymentInput(data=request.data)
            serializer.is_valid(raise_exception=True)
            event = cash_payment(request, tenant_id, order_id, serializer.validated_data["idempotency_key"])
            return Response(PaymentOutput(event).data, status=201)
        elif action == "refund-cash":
            serializer = RefundInput(data=request.data)
            serializer.is_valid(raise_exception=True)
            event = cash_refund(request, tenant_id, order_id, **dict(serializer.validated_data))
            return Response(PaymentOutput(event).data, status=201)
        else:
            raise NotFound()
        order = Order.objects.prefetch_related("lines").get(pk=order.pk)
        return Response(OrderOutput(order).data)


class QrMenu(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "restaurant_qr"

    def get(self, request, token):
        table, categories, accepting_orders = qr_menu(token)
        return Response({"table_name": table.name, "accepting_orders": accepting_orders, "categories": [{
            **CategoryOutput(category).data,
            "items": ItemOutput([item for item in category.items.all() if item.is_active], many=True).data,
        } for category in categories]})


@method_decorator(csrf_protect, name="dispatch")
class QrOrder(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "restaurant_qr"

    def post(self, request, token):
        serializer = OrderInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order, created = create_qr_order(token, dict(serializer.validated_data))
        order = Order.objects.prefetch_related("lines").get(pk=order.pk)
        return Response(OrderOutput(order).data, status=201 if created else 200)


class QrCode(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "restaurant_qr"

    def get(self, request, token):
        from hashlib import sha256
        digest = sha256(token.encode()).hexdigest()
        if not Table.objects.filter(qr_token_digest=digest, is_active=True, tenant__is_active=True).exists():
            raise NotFound("This table QR code is inactive or invalid.")
        target = settings.FRONTEND_ORIGIN + "/?" + urlencode({"qr": token})
        image = qrcode.make(target, image_factory=SvgPathImage, box_size=5, border=4)
        buffer = BytesIO()
        image.save(buffer)
        response = HttpResponse(buffer.getvalue(), content_type="image/svg+xml")
        response["Cache-Control"] = "no-store"
        response["Referrer-Policy"] = "no-referrer"
        return response
