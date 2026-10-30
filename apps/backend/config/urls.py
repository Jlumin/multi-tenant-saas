from django.urls import path
from platform_core.views import live, ready
from platform_core import api
from modules.wms import api as wms_api
from modules.crm import api as crm_api
from modules.ecommerce import api as ecommerce_api
from modules.hr import api as hr_api
from modules.restaurant import api as restaurant_api

urlpatterns = [path("api/v1/health/live/", live), path("api/v1/health/ready/", ready)]
urlpatterns += [
    path("api/v1/auth/csrf/", api.CSRFView.as_view()),
    path("api/v1/auth/login/", api.LoginView.as_view()),
    path("api/v1/auth/logout/", api.LogoutView.as_view()),
    path("api/v1/auth/me/", api.MeView.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/stores/", api.StoreList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/stores/<uuid:store_id>/", api.StoreDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/members/", api.MemberList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/members/<uuid:member_id>/", api.MemberDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/audit/", api.AuditList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/branding/", api.TenantBrandingView.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/branding/logo/", api.TenantBrandLogoView.as_view(), name="tenant-brand-logo"),
]
urlpatterns += [
    path("api/v1/tenants/<uuid:tenant_id>/hr/employees/", hr_api.EmployeeList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/employees/<uuid:employee_id>/", hr_api.EmployeeDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/shifts/", hr_api.ShiftList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/assignments/", hr_api.AssignmentList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/assignments/<uuid:assignment_id>/<str:action>/", hr_api.AttendancePunch.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/corrections/", hr_api.CorrectionList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/corrections/<uuid:correction_id>/<str:action>/", hr_api.CorrectionDecision.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/hr/events/", hr_api.AttendanceEventList.as_view()),
]
urlpatterns += [
    path("api/v1/tenants/<uuid:tenant_id>/restaurant/categories/", restaurant_api.CategoryList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/restaurant/items/", restaurant_api.ItemList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/restaurant/items/<uuid:item_id>/", restaurant_api.ItemDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/stores/<uuid:store_id>/restaurant/tables/", restaurant_api.TableList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/restaurant/tables/<uuid:table_id>/", restaurant_api.TableDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/restaurant/tables/<uuid:table_id>/<str:action>/", restaurant_api.TableDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/stores/<uuid:store_id>/restaurant/orders/", restaurant_api.StoreOrderList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/restaurant/orders/<uuid:order_id>/<str:action>/", restaurant_api.StoreOrderAction.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/stores/<uuid:store_id>/restaurant/pos-shift/", restaurant_api.StoreShift.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/stores/<uuid:store_id>/restaurant/pos-shift/<str:action>/", restaurant_api.StoreShift.as_view()),
    path("api/v1/restaurant/qr/<str:token>/menu/", restaurant_api.QrMenu.as_view()),
    path("api/v1/restaurant/qr/<str:token>/orders/", restaurant_api.QrOrder.as_view()),
    path("api/v1/restaurant/qr/<str:token>/code.svg", restaurant_api.QrCode.as_view()),
]
urlpatterns += [
    path("api/v1/tenants/<uuid:tenant_id>/ecommerce/listings/", ecommerce_api.ListingList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/ecommerce/orders/", ecommerce_api.OrderList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/ecommerce/orders/<uuid:order_id>/<str:action>/", ecommerce_api.OrderAction.as_view()),
]
urlpatterns += [
    path("api/v1/tenants/<uuid:tenant_id>/crm/customers/", crm_api.CustomerList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/crm/customers/<uuid:customer_id>/", crm_api.CustomerDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/crm/customers/<uuid:customer_id>/consents/", crm_api.CustomerConsentList.as_view()),
]
urlpatterns += [
    path("api/v1/tenants/<uuid:tenant_id>/wms/products/", wms_api.ProductList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/products/<uuid:product_id>/", wms_api.ProductDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/products/<uuid:product_id>/image/", wms_api.ProductImage.as_view(), name="wms-product-image"),
    path("api/v1/tenants/<uuid:tenant_id>/wms/products/<uuid:product_id>/units/", wms_api.PackageUnitList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/products/<uuid:product_id>/units/<uuid:package_unit_id>/", wms_api.PackageUnitDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/warehouses/", wms_api.WarehouseList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/warehouses/<uuid:warehouse_id>/", wms_api.WarehouseDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/warehouses/<uuid:warehouse_id>/locations/", wms_api.LocationList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/locations/<uuid:location_id>/", wms_api.LocationDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/documents/", wms_api.DocumentList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/documents/<uuid:document_id>/", wms_api.DocumentDetail.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/documents/<uuid:document_id>/<str:action>/", wms_api.DocumentAction.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/balances/", wms_api.StockBalanceList.as_view()),
    path("api/v1/tenants/<uuid:tenant_id>/wms/movements/", wms_api.StockMovementList.as_view()),
]
