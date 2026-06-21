# Story 2.1: state-only перенос RBAC в app ops_rbac.
# Пять таблиц (ops_roles / ops_permissions / ops_user_roles / ops_role_permissions
# / ops_temporary_duty_permissions) уже созданы миграциями operations/0001-0005.
# CreateModel обёрнуты в SeparateDatabaseAndState с database_operations=[] —
# меняется ТОЛЬКО состояние Django, никакого CREATE/DDL (db_table неизменны).

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        # нужно для data-миграции 0002 (UPDATE django_content_type)
        ("contenttypes", "__first__"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="Permission",
                    fields=[
                        (
                            "code",
                            models.CharField(
                                max_length=100, primary_key=True, serialize=False
                            ),
                        ),
                        ("name", models.CharField(max_length=255)),
                        ("description", models.TextField(blank=True, null=True)),
                        ("is_active", models.BooleanField(default=True)),
                    ],
                    options={
                        "db_table": "ops_permissions",
                    },
                ),
                migrations.CreateModel(
                    name="Role",
                    fields=[
                        (
                            "code",
                            models.CharField(
                                max_length=50, primary_key=True, serialize=False
                            ),
                        ),
                        ("name", models.CharField(max_length=255)),
                        ("description", models.TextField(blank=True, null=True)),
                        ("is_active", models.BooleanField(default=True)),
                    ],
                    options={
                        "db_table": "ops_roles",
                    },
                ),
                migrations.CreateModel(
                    name="TemporaryDutyPermission",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        ("user_id", models.CharField(max_length=100)),
                        ("employee_id", models.UUIDField(blank=True, null=True)),
                        (
                            "duty_role_code",
                            models.CharField(
                                choices=[
                                    ("OMD", "ОМД"),
                                    ("ORGD", "ОРГД"),
                                    ("HQ_DUTY", "Дежурный по штабу"),
                                    ("OBJECT_SENIOR_DUTY", "Старший по объекту"),
                                ],
                                max_length=50,
                            ),
                        ),
                        ("scope_division_id", models.UUIDField(blank=True, null=True)),
                        ("event_id", models.UUIDField(blank=True, null=True)),
                        ("starts_at", models.DateTimeField()),
                        ("ends_at", models.DateTimeField()),
                        ("is_active", models.BooleanField(default=True)),
                        ("created_by", models.CharField(max_length=100)),
                    ],
                    options={
                        "db_table": "ops_temporary_duty_permissions",
                        "indexes": [
                            models.Index(
                                fields=["user_id", "is_active", "starts_at", "ends_at"],
                                name="idx_ops_temp_duty_user",
                            )
                        ],
                    },
                ),
                migrations.CreateModel(
                    name="RolePermission",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        (
                            "created_by",
                            models.CharField(blank=True, max_length=100, null=True),
                        ),
                        (
                            "permission_code",
                            models.ForeignKey(
                                db_column="permission_code",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="permission_roles",
                                to="ops_rbac.permission",
                            ),
                        ),
                        (
                            "role_code",
                            models.ForeignKey(
                                db_column="role_code",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="role_permissions",
                                to="ops_rbac.role",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "ops_role_permissions",
                        "constraints": [
                            models.UniqueConstraint(
                                fields=("role_code", "permission_code"),
                                name="unique_role_permission",
                            )
                        ],
                    },
                ),
                migrations.CreateModel(
                    name="UserRole",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(
                                auto_created=True,
                                primary_key=True,
                                serialize=False,
                                verbose_name="ID",
                            ),
                        ),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        (
                            "created_by",
                            models.CharField(blank=True, max_length=100, null=True),
                        ),
                        ("user_id", models.CharField(max_length=100)),
                        ("scope_division_id", models.UUIDField(blank=True, null=True)),
                        ("is_active", models.BooleanField(default=True)),
                        (
                            "role_code",
                            models.ForeignKey(
                                db_column="role_code",
                                on_delete=django.db.models.deletion.PROTECT,
                                related_name="user_roles",
                                to="ops_rbac.role",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "ops_user_roles",
                        "indexes": [
                            models.Index(
                                fields=["user_id", "is_active"],
                                name="idx_ops_user_roles_user",
                            )
                        ],
                        "constraints": [
                            models.UniqueConstraint(
                                fields=("user_id", "role_code", "scope_division_id"),
                                name="unique_user_role_scope",
                            )
                        ],
                    },
                ),
            ],
        ),
    ]
