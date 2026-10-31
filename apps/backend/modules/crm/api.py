from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.access import membership_for
from .models import ConsentEvent, Customer
from .serializers import ConsentInput, ConsentOutput, CustomerInput, CustomerOutput
from .services import create_customer, reader_for, record_consent, update_customer


class CustomerList(generics.ListAPIView):
    serializer_class = CustomerOutput

    def member(self):
        return membership_for(self.request, self.kwargs["tenant_id"])

    def get_queryset(self):
        queryset = Customer.objects.filter(tenant=reader_for(self.request, self.kwargs["tenant_id"]).tenant)
        search = self.request.query_params.get("search", "").strip()
        if search:
            from django.db.models import Q
            queryset = queryset.filter(Q(code__icontains=search) | Q(name__icontains=search) | Q(email__icontains=search) | Q(phone__icontains=search))
        return queryset.order_by("code", "id")

    def post(self, request, tenant_id):
        serializer = CustomerInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        customer = create_customer(request, tenant_id, dict(serializer.validated_data))
        return Response(CustomerOutput(customer).data, status=201)


class CustomerDetail(APIView):
    def get(self, request, tenant_id, customer_id):
        member = reader_for(request, tenant_id)
        customer = get_object_or_404(Customer, tenant=member.tenant, pk=customer_id)
        result = CustomerOutput(customer).data
        result["consents"] = ConsentOutput(customer.consent_events.all(), many=True).data
        return Response(result)

    def patch(self, request, tenant_id, customer_id):
        member = reader_for(request, tenant_id)
        customer = get_object_or_404(Customer, tenant=member.tenant, pk=customer_id)
        serializer = CustomerInput(instance=customer, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = update_customer(request, tenant_id, customer_id, dict(serializer.validated_data))
        return Response(CustomerOutput(updated).data)


class CustomerConsentList(generics.ListAPIView):
    serializer_class = ConsentOutput

    def get_queryset(self):
        member = reader_for(self.request, self.kwargs["tenant_id"])
        if not Customer.objects.filter(tenant=member.tenant, pk=self.kwargs["customer_id"]).exists():
            from rest_framework.exceptions import NotFound
            raise NotFound()
        return ConsentEvent.objects.filter(tenant=member.tenant, customer_id=self.kwargs["customer_id"])

    def post(self, request, tenant_id, customer_id):
        serializer = ConsentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = record_consent(request, tenant_id, customer_id, dict(serializer.validated_data))
        return Response(ConsentOutput(event).data, status=201)
