from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.access import membership_for
from .models import InventoryDocument, Location, PackageUnit, Product, StockBalance, StockMovement, Warehouse
from .serializers import (
    DocumentEditInput,
    DocumentInput,
    DocumentOutput,
    LocationInput,
    LocationOutput,
    PackageUnitInput,
    PackageUnitOutput,
    PackageUnitStatusInput,
    ProductInput,
    ProductOutput,
    StockBalanceOutput,
    StockMovementOutput,
    WarehouseInput,
    WarehouseOutput,
)
from .services import (
    cancel_document,
    create_document,
    create_location,
    create_package_unit,
    create_product,
    create_warehouse,
    post_document,
    replace_document_lines,
    set_package_unit_active,
    update_location,
    update_product,
    update_warehouse,
)


class TenantList(generics.ListAPIView):
    def member(self):
        return membership_for(self.request, self.kwargs["tenant_id"])


class ProductList(TenantList):
    serializer_class = ProductOutput

    def get_queryset(self):
        return Product.objects.filter(tenant=self.member().tenant).order_by("code", "id")

    def post(self, request, tenant_id):
        serializer = ProductInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = create_product(request, tenant_id, serializer.validated_data)
        return Response(ProductOutput(product).data, status=201)


class ProductDetail(APIView):
    def get(self, request, tenant_id, product_id):
        member = membership_for(request, tenant_id)
        product = get_object_or_404(Product, tenant=member.tenant, pk=product_id)
        data = ProductOutput(product).data
        data["package_units"] = PackageUnitOutput(product.package_units.all(), many=True).data
        return Response(data)

    def patch(self, request, tenant_id, product_id):
        member = membership_for(request, tenant_id)
        product = get_object_or_404(Product, tenant=member.tenant, pk=product_id)
        serializer = ProductInput(instance=product, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = update_product(request, tenant_id, product_id, dict(serializer.validated_data))
        return Response(ProductOutput(updated).data)


class PackageUnitList(TenantList):
    serializer_class = PackageUnitOutput

    def get_queryset(self):
        member = self.member()
        if not Product.objects.filter(tenant=member.tenant, pk=self.kwargs["product_id"]).exists():
            raise NotFound()
        return PackageUnit.objects.filter(tenant=member.tenant, product_id=self.kwargs["product_id"])

    def post(self, request, tenant_id, product_id):
        serializer = PackageUnitInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        unit = create_package_unit(request, tenant_id, product_id, serializer.validated_data)
        return Response(PackageUnitOutput(unit).data, status=201)


class PackageUnitDetail(APIView):
    def patch(self, request, tenant_id, product_id, package_unit_id):
        serializer = PackageUnitStatusInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        unit = set_package_unit_active(request, tenant_id, product_id, package_unit_id, serializer.validated_data["is_active"])
        return Response(PackageUnitOutput(unit).data)


class WarehouseList(TenantList):
    serializer_class = WarehouseOutput

    def get_queryset(self):
        return Warehouse.objects.filter(tenant=self.member().tenant).order_by("code", "id")

    def post(self, request, tenant_id):
        serializer = WarehouseInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        warehouse = create_warehouse(request, tenant_id, serializer.validated_data)
        return Response(WarehouseOutput(warehouse).data, status=201)


class WarehouseDetail(APIView):
    def get(self, request, tenant_id, warehouse_id):
        member = membership_for(request, tenant_id)
        warehouse = get_object_or_404(Warehouse, tenant=member.tenant, pk=warehouse_id)
        data = WarehouseOutput(warehouse).data
        data["locations"] = LocationOutput(warehouse.locations.all(), many=True).data
        return Response(data)

    def patch(self, request, tenant_id, warehouse_id):
        membership_for(request, tenant_id)
        warehouse = get_object_or_404(Warehouse, tenant_id=tenant_id, pk=warehouse_id)
        serializer = WarehouseInput(instance=warehouse, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = update_warehouse(request, tenant_id, warehouse_id, dict(serializer.validated_data))
        return Response(WarehouseOutput(updated).data)


class LocationList(TenantList):
    serializer_class = LocationOutput

    def get_queryset(self):
        member = self.member()
        if not Warehouse.objects.filter(tenant=member.tenant, pk=self.kwargs["warehouse_id"]).exists():
            raise NotFound()
        return Location.objects.filter(tenant=member.tenant, warehouse_id=self.kwargs["warehouse_id"]).order_by("code", "id")

    def post(self, request, tenant_id, warehouse_id):
        serializer = LocationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        location = create_location(request, tenant_id, warehouse_id, serializer.validated_data)
        return Response(LocationOutput(location).data, status=201)


class LocationDetail(APIView):
    def patch(self, request, tenant_id, location_id):
        membership_for(request, tenant_id)
        location = get_object_or_404(Location, tenant_id=tenant_id, pk=location_id)
        serializer = LocationInput(instance=location, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = update_location(request, tenant_id, location_id, dict(serializer.validated_data))
        return Response(LocationOutput(updated).data)


class DocumentList(TenantList):
    serializer_class = DocumentOutput

    def get_queryset(self):
        return InventoryDocument.objects.filter(tenant=self.member().tenant).select_related("warehouse", "created_by", "posted_by").prefetch_related("lines__product", "lines__package_unit", "lines__location")

    def post(self, request, tenant_id):
        serializer = DocumentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        doc, created = create_document(request, tenant_id, serializer.validated_data)
        return Response(DocumentOutput(doc).data, status=201 if created else 200)


class DocumentDetail(APIView):
    def get(self, request, tenant_id, document_id):
        member = membership_for(request, tenant_id)
        doc = get_object_or_404(InventoryDocument.objects.filter(tenant=member.tenant).select_related("warehouse", "created_by", "posted_by").prefetch_related("lines__product", "lines__package_unit", "lines__location"), pk=document_id)
        return Response(DocumentOutput(doc).data)

    def patch(self, request, tenant_id, document_id):
        serializer = DocumentEditInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        doc = replace_document_lines(request, tenant_id, document_id, serializer.validated_data)
        doc.refresh_from_db()
        doc = InventoryDocument.objects.select_related("warehouse", "created_by", "posted_by").prefetch_related("lines__product", "lines__package_unit", "lines__location").get(pk=doc.pk)
        return Response(DocumentOutput(doc).data)


class DocumentAction(APIView):
    def post(self, request, tenant_id, document_id, action):
        if action not in ("post", "cancel"):
            raise NotFound()
        if request.data not in ({}, None):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Action requests do not accept a payload.")
        doc = post_document(request, tenant_id, document_id) if action == "post" else cancel_document(request, tenant_id, document_id)
        return Response({"id": str(doc.pk), "status": doc.status})


class StockBalanceList(TenantList):
    serializer_class = StockBalanceOutput

    def get_queryset(self):
        member = self.member()
        queryset = StockBalance.objects.filter(tenant=member.tenant, quantity__gt=0).select_related("product", "warehouse", "location")
        for field in ("product_id", "warehouse_id", "location_id"):
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset.order_by("product__code", "warehouse__code", "location__code", "product_id")


class StockMovementList(TenantList):
    serializer_class = StockMovementOutput

    def get_queryset(self):
        member = self.member()
        queryset = StockMovement.objects.filter(tenant=member.tenant).select_related("product", "warehouse", "location", "document", "created_by")
        for field in ("product_id", "warehouse_id", "location_id"):
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset.order_by("-created_at", "-id")

