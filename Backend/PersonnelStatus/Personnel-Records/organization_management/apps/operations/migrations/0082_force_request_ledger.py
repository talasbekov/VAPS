"""Заявка на сбор сил таблицами (`[МД-06]`, Plane №425, Ш-9 плана P2).

Схема + БЭКФИЛЛ: текущий JSON `force_requests`/`force_allocation` каждого
мероприятия переносится проекцией `ops/forces_ledger.project` (тот же код,
что и у сигнала на живом стенде) — с числом перенесённых строк в выводе.
Обратная миграция снимает таблицы; JSON не трогается ни туда, ни обратно.
"""
import django.db.models.deletion
from types import SimpleNamespace
from django.db import migrations, models


def backfill_forces_ledger(apps, schema_editor):
    from organization_management.apps.ops import forces_ledger

    models = SimpleNamespace(
        OpsForceRequest=apps.get_model("operations", "OpsForceRequest"),
        OpsDepartmentRequest=apps.get_model("operations", "OpsDepartmentRequest"),
        OpsUnitRequest=apps.get_model("operations", "OpsUnitRequest"),
        OpsForceRequestMember=apps.get_model("operations", "OpsForceRequestMember"),
    )
    models.Division = apps.get_model("divisions", "Division")
    models.Employee = apps.get_model("employees", "Employee")
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    events = OpsSecurityEvent.objects.exclude(force_requests=[], force_allocation=[]).order_by("pk")
    forces_ledger.backfill(events, models=models)


class Migration(migrations.Migration):

    dependencies = [
        ('divisions', '0002_summary_node'),
        ('employees', '0002_alter_employeetransferhistory_options'),
        ('operations', '0081_approval_route_steps'),
    ]

    operations = [
        migrations.CreateModel(
            name='OpsForceRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.CharField(blank=True, max_length=100, null=True)),
                ('source_key', models.CharField(max_length=100)),
                ('requested_count', models.PositiveIntegerField()),
                ('sequence', models.PositiveIntegerField()),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='force_request_rows', to='operations.opssecurityevent')),
                ('visit_object', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='force_request_rows', to='operations.opssecurityeventvisitobject')),
            ],
            options={
                'db_table': 'ops_force_requests',
                'ordering': ['event_id', 'source_key', 'sequence'],
                'unique_together': {('event', 'source_key', 'sequence')},
            },
        ),
        migrations.CreateModel(
            name='OpsDepartmentRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.CharField(blank=True, max_length=100, null=True)),
                ('department_key', models.CharField(blank=True, default='', max_length=40)),
                ('allocation_key', models.CharField(max_length=160)),
                ('requested_count', models.PositiveIntegerField()),
                ('allocating_count', models.PositiveIntegerField(blank=True, null=True)),
                ('status', models.CharField(max_length=30)),
                ('due_at', models.DateTimeField(blank=True, null=True)),
                ('sequence', models.PositiveIntegerField()),
                ('department', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='divisions.division')),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='department_request_rows', to='operations.opssecurityevent')),
                ('force_request', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='department_requests', to='operations.opsforcerequest')),
            ],
            options={
                'db_table': 'ops_department_requests',
                'ordering': ['event_id', 'allocation_key', 'sequence'],
                'unique_together': {('event', 'allocation_key', 'sequence')},
            },
        ),
        migrations.CreateModel(
            name='OpsForceRequestMember',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.CharField(blank=True, max_length=100, null=True)),
                ('allocation_key', models.CharField(max_length=160)),
                ('employee_key', models.CharField(max_length=40)),
                ('directorate_key', models.CharField(blank=True, default='', max_length=40)),
                ('status_id', models.PositiveIntegerField(blank=True, null=True)),
                ('added_at', models.DateTimeField()),
                ('removed_at', models.DateTimeField(blank=True, null=True)),
                ('department_request', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='members', to='operations.opsdepartmentrequest')),
                ('directorate', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='divisions.division')),
                ('employee', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='employees.employee')),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='force_member_rows', to='operations.opssecurityevent')),
            ],
            options={
                'db_table': 'ops_force_request_members',
                'ordering': ['event_id', 'allocation_key', 'added_at', 'pk'],
            },
        ),
        migrations.CreateModel(
            name='OpsUnitRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.CharField(blank=True, max_length=100, null=True)),
                ('directorate_key', models.CharField(max_length=160)),
                ('requested_count', models.PositiveIntegerField()),
                ('sequence', models.PositiveIntegerField()),
                ('department_request', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='unit_requests', to='operations.opsdepartmentrequest')),
                ('directorate', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='divisions.division')),
                ('event', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='unit_request_rows', to='operations.opssecurityevent')),
            ],
            options={
                'db_table': 'ops_unit_requests',
                'ordering': ['event_id', 'directorate_key', 'sequence'],
                'unique_together': {('event', 'directorate_key', 'sequence')},
            },
        ),
        migrations.RunPython(backfill_forces_ledger, migrations.RunPython.noop),
    ]
