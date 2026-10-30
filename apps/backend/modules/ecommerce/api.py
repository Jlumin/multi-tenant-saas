from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.access import membership_for
from modules.wms.application import available_quantity
from .models import Listing, Order
from .serializers import ListingInput, ListingOutput, OrderInput, OrderOutput
from .services import cancel_order, capture_sandbox_payment, create_listing, create_order


class ListingList(generics.ListAPIView):
    serializer_class = ListingOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        return Listing.objects.filter(tenant=member.tenant).order_by("title", "id")

    def get_serializer(self, *args, **kwargs):
        serializer = super().get_serializer(*args, **kwargs)
        if serializer.instance is not None:
            rows = serializer.instance if isinstance(serializer.instance, (list, tuple)) else [serializer.instance]
            for row in rows:
                row.available_quantity = available_quantity(
                    tenant_id=row.tenant_id, product_id=row.product_id, warehouse_id=row.warehouse_id,
                )
        return serializer

    def post(self, request, tenant_id):
        serializer = ListingInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing = create_listing(request, tenant_id, dict(serializer.validated_data))
        listing.available_quantity = available_quantity(tenant_id=listing.tenant_id, product_id=listing.product_id, warehouse_id=listing.warehouse_id)
        return Response(ListingOutput(listing).data, status=201)


class OrderList(generics.ListAPIView):
    serializer_class = OrderOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        if member.role == "viewer":
            from rest_framework.exceptions import PermissionDenied
            from platform_core.services import audit
            audit(self.request, "access.denied", tenant=member.tenant)
            raise PermissionDenied("Order customer data requires a manager or tenant administrator role.")
        queryset = Order.objects.filter(tenant=member.tenant).select_related("payment").prefetch_related("lines")
        status = self.request.query_params.get("status")
        if status:
            queryset = queryset.filter(status=status)
        return queryset.order_by("-created_at", "-id")

    def post(self, request, tenant_id):
        serializer = OrderInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        order, created = create_order(request, tenant_id, dict(serializer.validated_data))
        order = Order.objects.select_related("payment").prefetch_related("lines").get(pk=order.pk)
        return Response(OrderOutput(order).data, status=201 if created else 200)


class OrderAction(APIView):
    def post(self, request, tenant_id, order_id, action):
        if action not in ("capture-sandbox-payment", "cancel"):
            raise NotFound()
        if request.data not in ({}, None):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Action requests do not accept a payload.")
        order = capture_sandbox_payment(request, tenant_id, order_id) if action == "capture-sandbox-payment" else cancel_order(request, tenant_id, order_id)
        order = Order.objects.select_related("payment").prefetch_related("lines").get(pk=order.pk)
        return Response(OrderOutput(order).data)
