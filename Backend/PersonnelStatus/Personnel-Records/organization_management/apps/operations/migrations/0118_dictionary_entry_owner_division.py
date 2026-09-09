from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("divisions", "0002_summary_node"),
        ("operations", "0117_ops_reader_event_view"),
    ]

    operations = [
        migrations.AddField(
            model_name="opsdictionaryentry",
            name="owner_division",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name="+",
                to="divisions.division",
            ),
        ),
    ]
