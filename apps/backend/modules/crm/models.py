import uuid

from django.db import models
from django.db.models import Q


class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    email = models.EmailField(max_length=254, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    is_active = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="crm_customer_tenant_code_uniq"),
            models.CheckConstraint(condition=~Q(code=""), name="crm_customer_code_not_empty"),
            models.CheckConstraint(condition=~Q(name=""), name="crm_customer_name_not_empty"),
        ]
        ordering = ["code", "id"]


class ConsentEvent(models.Model):
    class Purpose(models.TextChoices):
        MARKETING_EMAIL = "marketing_email", "Marketing email"
        MARKETING_SMS = "marketing_sms", "Marketing SMS"
        TERMS = "terms", "Terms acceptance"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("platform_core.Tenant", on_delete=models.PROTECT)
    customer = models.ForeignKey(Customer, related_name="consent_events", on_delete=models.PROTECT)
    purpose = models.CharField(max_length=24, choices=Purpose.choices)
    granted = models.BooleanField()
    policy_version = models.CharField(max_length=40)
    recorded_by = models.ForeignKey("platform_core.Membership", on_delete=models.PROTECT)
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(purpose__in=["marketing_email", "marketing_sms", "terms"]), name="crm_consent_purpose_valid"),
            models.CheckConstraint(condition=~Q(policy_version=""), name="crm_consent_policy_not_empty"),
        ]
        ordering = ["-recorded_at", "-id"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Consent events are append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Consent events cannot be deleted.")
