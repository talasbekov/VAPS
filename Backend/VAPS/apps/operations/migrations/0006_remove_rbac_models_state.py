# Story 2.1: state-only удаление RBAC-моделей из app operations.
# Пять моделей переехали в ops_rbac (см. ops_rbac/0001_initial). Здесь снимается
# ТОЛЬКО состояние Django из operations — database_operations=[], никакого DROP.
# Зависимость от ops_rbac/0001 гарантирует: состояние сперва создаётся в ops_rbac,
# затем удаляется отсюда (одна и та же db_table не должна «висеть» в двух app-state
# дольше необходимого; финальный makemigrations --check видит только ops_rbac).

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0005_created_by"),
        ("ops_rbac", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RemoveField(
                    model_name='rolepermission',
                    name='permission_code',
                ),
                migrations.RemoveField(
                    model_name='rolepermission',
                    name='role_code',
                ),
                migrations.RemoveField(
                    model_name='userrole',
                    name='role_code',
                ),
                migrations.DeleteModel(
                    name='TemporaryDutyPermission',
                ),
                migrations.DeleteModel(
                    name='Permission',
                ),
                migrations.DeleteModel(
                    name='RolePermission',
                ),
                migrations.DeleteModel(
                    name='Role',
                ),
                migrations.DeleteModel(
                    name='UserRole',
                ),
            ],
        ),
    ]
