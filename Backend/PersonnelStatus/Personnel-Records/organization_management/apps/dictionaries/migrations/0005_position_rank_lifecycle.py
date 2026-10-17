"""Жизненный цикл должностей и званий (UC-REF-001, подпроект 2)."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("dictionaries", "0004_position_rank_name_kk")]

    operations = [
        migrations.AddField(model_name="position", name="is_active",
                            field=models.BooleanField(db_index=True, default=True)),
        migrations.AddField(model_name="position", name="inactive_since",
                            field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="position", name="supersedes",
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                                    related_name="superseded_by", to="dictionaries.position")),
        migrations.AddField(model_name="rank", name="is_active",
                            field=models.BooleanField(db_index=True, default=True)),
        migrations.AddField(model_name="rank", name="inactive_since",
                            field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="rank", name="supersedes",
                            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                                    related_name="superseded_by", to="dictionaries.rank")),
    ]
