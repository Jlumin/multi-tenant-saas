from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("platform_core", "0004_public_storefront")]

    operations = [
        migrations.AddField(
            model_name="tenantbranding",
            name="storefront_heading",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="tenantbranding",
            name="storefront_description",
            field=models.CharField(blank=True, max_length=240),
        ),
    ]
