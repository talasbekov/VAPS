from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('operations', '0153_assistant_connection_check')]
    operations = [migrations.AddField(
        model_name='opsassistantconnection', name='api_key_format',
        field=models.CharField(choices=[('plain', 'Прежнее хранение'), ('fernet-v1', 'Зашифровано')],
                               default='plain', editable=False, max_length=16),
    )]
