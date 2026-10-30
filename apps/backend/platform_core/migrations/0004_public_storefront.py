from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("platform_core", "0003_tenant_branding")]

    operations = [
        migrations.AddField(
            model_name="tenantbranding",
            name="storefront_enabled",
            field=models.BooleanField(default=False),
        ),
    ]
