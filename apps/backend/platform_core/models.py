import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from .images import tenant_asset_path, validate_raster_image


class Tenant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=80, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)


class TenantBranding(models.Model):
    tenant = models.OneToOneField(Tenant, primary_key=True, on_delete=models.PROTECT, related_name="branding")
    brand_name = models.CharField(max_length=120, blank=True)
    storefront_enabled = models.BooleanField(default=False)
    primary_color = models.CharField(max_length=7, default="#17675B", validators=[RegexValidator(r"^#[0-9A-Fa-f]{6}$")])
    accent_color = models.CharField(max_length=7, default="#39746B", validators=[RegexValidator(r"^#[0-9A-Fa-f]{6}$")])
    logo = models.ImageField(upload_to=tenant_asset_path, blank=True, validators=[validate_raster_image])
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(primary_color__regex=r"^#[0-9A-Fa-f]{6}$"), name="platform_brand_primary_hex"),
            models.CheckConstraint(condition=models.Q(accent_color__regex=r"^#[0-9A-Fa-f]{6}$"), name="platform_brand_accent_hex"),
        ]


class Store(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    code = models.SlugField(max_length=40)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["tenant", "code"], name="unique_tenant_store_code")]


class Membership(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Tenant administrator"
        MANAGER = "manager", "Store manager"
        VIEWER = "viewer", "Viewer"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.VIEWER)
    is_active = models.BooleanField(default=True)
    stores = models.ManyToManyField(Store, through="StoreAccess")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "user"], name="unique_tenant_user"),
            models.CheckConstraint(condition=models.Q(role__in=["admin", "manager", "viewer"]), name="valid_membership_role"),
        ]


class StoreAccess(models.Model):
    membership = models.ForeignKey(Membership, on_delete=models.CASCADE)
    store = models.ForeignKey(Store, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["membership", "store"], name="unique_member_store")]

    def clean(self):
        if self.membership.tenant_id != self.store.tenant_id:
            raise ValidationError("Store and membership must belong to the same tenant.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class AuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=60)
    target_id = models.CharField(max_length=80, blank=True)
    request_id = models.CharField(max_length=36, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["tenant", "-created_at"], name="audit_tenant_time")]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Audit events cannot be changed.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Audit events cannot be deleted.")
