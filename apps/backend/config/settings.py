import os
from pathlib import Path

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:4200").rstrip("/")
CSRF_TRUSTED_ORIGINS = [
    origin.strip() for origin in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if origin.strip()
]
SECURE_SSL_REDIRECT = os.getenv("DJANGO_SECURE_SSL_REDIRECT", "0") == "1"
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.getenv("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", "0") == "1"
SECURE_HSTS_PRELOAD = os.getenv("DJANGO_SECURE_HSTS_PRELOAD", "0") == "1"
# Only enable behind a reverse proxy that overwrites this header and is the sole
# network path to Django. Never trust a client-supplied forwarding header.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if os.getenv("DJANGO_TRUST_PROXY_SSL", "0") == "1" else None
SECURE_REFERRER_POLICY = "same-origin"
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions",
    "rest_framework", "platform_core",
    "modules.wms", "modules.ecommerce", "modules.crm", "modules.hr", "modules.restaurant",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "platform_core.middleware.RequestIDMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
STATIC_URL = "/static/"
MEDIA_ROOT = Path(os.getenv("DJANGO_MEDIA_ROOT", "/app/media"))
FILE_UPLOAD_MAX_MEMORY_SIZE = 1_000_000
DATA_UPLOAD_MAX_MEMORY_SIZE = 5_800_000
DATA_UPLOAD_MAX_NUMBER_FILES = 1
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.environ["POSTGRES_DB"], "USER": os.environ["POSTGRES_USER"],
    "PASSWORD": os.environ["POSTGRES_PASSWORD"],
    "HOST": os.getenv("POSTGRES_HOST", "localhost"), "PORT": os.getenv("POSTGRES_PORT", "5432"),
    "CONN_MAX_AGE": 0,
    "OPTIONS": {"connect_timeout": 5},
}}
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "platform_core.errors.exception_handler",
    "DEFAULT_PAGINATION_CLASS": "platform_core.pagination.BoundedPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_RATES": {"restaurant_qr": "20/minute"},
}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
CSRF_FAILURE_VIEW = "platform_core.errors.csrf_failure"
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 28800
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "Asia/Taipei"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
