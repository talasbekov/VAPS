from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('staff_unit', '0001_initial')]
    operations = [
        migrations.AddField(model_name='staffunit', name='external_id', field=models.CharField(blank=True, default=None, max_length=100, null=True, unique=True)),
        migrations.AddField(model_name='staffunit', name='import_order', field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='staffunit', name='position_category', field=models.CharField(blank=True, default='', max_length=100)),
    ]
