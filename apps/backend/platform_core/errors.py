from django.http import JsonResponse
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None:
        response.data = {"error": {
            "code": getattr(exc, "default_code", "request_error"),
            "details": response.data,
            "request_id": getattr(context["request"], "request_id", ""),
        }}
    return response


def csrf_failure(request, reason=""):
    return JsonResponse({"error": {"code": "csrf_failed", "details": "CSRF verification failed.",
                                   "request_id": getattr(request, "request_id", "")}}, status=403)
