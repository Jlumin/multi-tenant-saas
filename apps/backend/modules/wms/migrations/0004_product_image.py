import platform_core.images
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("platform_core", "0003_tenant_branding"), ("wms", "0003_stock_reservations")]

    operations = [
        migrations.AddField(
            model_name="product",
            name="image",
            field=models.ImageField(blank=True, upload_to=platform_core.images.tenant_asset_path, validators=[platform_core.images.validate_raster_image]),
        ),
    ]
