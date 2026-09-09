from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0115_force_campaign_pool_members")]

    operations = [
        migrations.RemoveConstraint(
            model_name="opsforcecampaignpoolmember",
            name="unique_force_campaign_pool_member",
        ),
        migrations.AddField(
            model_name="opsforcecampaignpoolmember",
            name="kind_code",
            field=models.CharField(default="PHYSICAL_SQUAD", max_length=60),
        ),
        migrations.AddField(
            model_name="opsforcecampaignpoolmember",
            name="source_allocation_id",
            field=models.CharField(blank=True, default="", max_length=160),
        ),
        migrations.AddField(
            model_name="opsforcecampaignpoolmember",
            name="removed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="opsforcecampaignpoolmember",
            constraint=models.UniqueConstraint(
                condition=models.Q(("removed_at__isnull", True)),
                fields=("campaign", "employee_key"),
                name="unique_force_campaign_pool_member",
            ),
        ),
    ]
