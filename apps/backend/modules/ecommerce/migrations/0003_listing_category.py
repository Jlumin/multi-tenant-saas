from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("ecommerce", "0002_database_guards")]

    operations = [
        migrations.AddField(
            model_name="listing",
            name="category",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
    ]
