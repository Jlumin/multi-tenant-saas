from django.shortcuts import get_object_or_404
from django.db.models import Q
from rest_framework import generics
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from platform_core.access import membership_for
from platform_core.images import public_image_response
from platform_core.models import Tenant, TenantBranding
from modules.wms import application as wms
from modules.wms.application import available_quantity, product_image_url
from .models import Listing, Order
from .serializers import ListingInput, ListingOutput, OrderInput, OrderOutput
from .services import cancel_order, capture_sandbox_payment, create_listing, create_order


def _enabled_storefront(tenant_slug):
    tenant = get_object_or_404(Tenant, slug=tenant_slug, is_active=True)
    branding = TenantBranding.objects.filter(tenant=tenant, storefront_enabled=True).first()
    if branding is None:
        raise NotFound()
    return tenant, branding


class PublicStorefrontView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "storefront_public"

    def get(self, request, tenant_slug):
        tenant, branding = _enabled_storefront(tenant_slug)
        search = request.query_params.get("q", "").strip()[:80]
        try:
            limit = min(100, max(1, int(request.query_params.get("limit", "24"))))
            offset = max(0, int(request.query_params.get("offset", "0")))
        except ValueError as exc:
            raise ValidationError("limit and offset must be integers.") from exc
        listings = Listing.objects.filter(tenant=tenant, is_active=True)
        if search:
            listings = listings.filter(Q(title__icontains=search) | Q(product_code__icontains=search))
        visible = []
        for listing in listings.order_by("title", "product_code", "id"):
            try:
                wms.sellable_product(
                    tenant_id=tenant.pk, product_id=listing.product_id, warehouse_id=listing.warehouse_id,
                )
            except ValidationError:
                continue
            visible.append(listing)
        total = len(visible)
        rows = []
        for listing in visible[offset:offset + limit]:
            image = wms.storefront_product_image(tenant_id=tenant.pk, product_id=listing.product_id)
            rows.append({
                "listing_id": str(listing.pk),
                "product_code": listing.product_code,
                "title": listing.title,
                "price": listing.price,
                "currency": listing.currency,
                "is_available": available_quantity(
                    tenant_id=tenant.pk, product_id=listing.product_id, warehouse_id=listing.warehouse_id,
                ) > 0,
                "product_image_url": (
                    f"/api/v1/storefronts/{tenant.slug}/products/{listing.product_id}/image/" if image else None
                ),
            })
        response = Response({
            "tenant_slug": tenant.slug,
            "brand_name": branding.brand_name or tenant.name,
            "primary_color": branding.primary_color,
            "accent_color": branding.accent_color,
            "logo_url": f"/api/v1/storefronts/{tenant.slug}/logo/" if branding.logo else None,
            "results": rows,
            "count": total,
            "limit": limit,
            "offset": offset,
        })
        response["Cache-Control"] = "public, max-age=60"
        return response


class PublicStorefrontLogo(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "storefront_public"

    def get(self, request, tenant_slug):
        _, branding = _enabled_storefront(tenant_slug)
        return public_image_response(branding.logo)


class PublicStorefrontProductImage(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "storefront_public"

    def get(self, request, tenant_slug, product_id):
        tenant, _ = _enabled_storefront(tenant_slug)
        warehouse_ids = Listing.objects.filter(
            tenant=tenant, product_id=product_id, is_active=True,
        ).values_list("warehouse_id", flat=True)
        if not warehouse_ids:
            raise NotFound()
        for warehouse_id in warehouse_ids:
            try:
                wms.sellable_product(tenant_id=tenant.pk, product_id=product_id, warehouse_id=warehouse_id)
                break
            except ValidationError:
                continue
        else:
            raise NotFound()
        image = wms.storefront_product_image(tenant_id=tenant.pk, product_id=product_id)
        return public_image_response(image)


class ListingList(generics.ListAPIView):
    serializer_class = ListingOutput

    def get_queryset(self):
        member = membership_for(self.request, self.kwargs["tenant_id"])
        return Listing.objects.filter(tenant=member.tenant).order_by("title", "id")

    def get_serializer(self, *args, **kwargs):
        serializer = super().get_serializer(*args, **kwargs)
        if serializer.instance is not None:
            rows = serializer.instance if isinstance(serializer.instance, (list, tuple)) else list(serializer.instance) if hasattr(serializer.instance, "__iter__") else [serializer.instance]
            for row in rows:
                row.available_quantity = available_quantity(
                    tenant_id=row.tenant_id, product_id=row.product_id, warehouse_id=row.warehouse_id,
                )
                row.product_image_url = product_image_url(tenant_id=row.tenant_id, product_id=row.product_id)
        return serializer

    def post(self, request, tenant_id):
        serializer = ListingInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing = create_listing(request, tenant_id, dict(serializer.validated_data))
        listing.available_quantity = available_quantity(tenant_id=listing.tenant_id, product_id=listing.product_id, warehouse_id=listing.warehouse_id)
        listing.product_image_url = product_image_url(tenant_id=listing.tenant_id, product_id=listing.product_id)
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
