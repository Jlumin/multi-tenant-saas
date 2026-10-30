import django.core.validators
import django.db.models.deletion
import platform_core.images
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("platform_core", "0002_database_guards")]

    operations = [
        migrations.CreateModel(
            name="TenantBranding",
            fields=[
                ("brand_name", models.CharField(blank=True, max_length=120)),
                ("primary_color", models.CharField(default="#17675B", max_length=7, validators=[django.core.validators.RegexValidator(r"^#[0-9A-Fa-f]{6}$")])),
                ("accent_color", models.CharField(default="#39746B", max_length=7, validators=[django.core.validators.RegexValidator(r"^#[0-9A-Fa-f]{6}$")])),
                ("logo", models.ImageField(blank=True, upload_to=platform_core.images.tenant_asset_path, validators=[platform_core.images.validate_raster_image])),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("tenant", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, primary_key=True, related_name="branding", serialize=False, to="platform_core.tenant")),
            ],
        ),
        migrations.AddConstraint(model_name="tenantbranding", constraint=models.CheckConstraint(condition=models.Q(("primary_color__regex", r"^#[0-9A-Fa-f]{6}$")), name="platform_brand_primary_hex")),
        migrations.AddConstraint(model_name="tenantbranding", constraint=models.CheckConstraint(condition=models.Q(("accent_color__regex", r"^#[0-9A-Fa-f]{6}$")), name="platform_brand_accent_hex")),
    ]
