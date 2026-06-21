# Story 2.1: перенос строк django_content_type для RBAC-моделей operations → ops_rbac.
#
# UPDATE (а не пересоздание) сохраняет ContentType.id → ссылки auth_permission /
# аудита / GenericFK по content_type_id остаются целы, дублей и осиротевших
# operations-строк нет. На свежей БД фильтр ничего не находит (content types ещё
# не созданы — post_migrate отрабатывает после миграций) → no-op.
#
# Collision-safe: перед relabel удаляем строку, уже стоящую в целевом app_label.
# На штатном первом переносе её нет (no-op, оригинальный id сохраняется UPDATE-ом).
# Она появляется лишь в сценарии частичного отката: post_migrate, видя «живые»
# ops_rbac-модели без content_type, создаёт ИХ ЗАНОВО с новым id — этот дубль и
# мешал бы повторному forward (UNIQUE app_label+model). Удаляя его, мы освобождаем
# имя и переотносим ИСХОДНУЮ строку (с оригинальным id), а каскад убирает только
# спорные auth_permission, созданные post_migrate для дубля. Делает обе стороны
# идемпотентными и переживающими round-trip forward→reverse→forward.
#
# Harden (review 2.1): delete целевой строки происходит ТОЛЬКО при наличии
# исходной строки на промоушен (guard source.exists()) и логирует число
# удалённых строк (+каскад) — standalone-CT не затирается вслепую, reverse аудируем.

from django.db import migrations

RBAC_MODELS = [
    "role",
    "permission",
    "userrole",
    "rolepermission",
    "temporarydutypermission",
]


def _relabel(apps, from_label, to_label):
    ContentType = apps.get_model("contenttypes", "ContentType")
    for model in RBAC_MODELS:
        source = ContentType.objects.filter(app_label=from_label, model=model)
        if not source.exists():
            # No source row → nothing to relabel; never blind-delete a
            # standalone target content type (and its auth_permission cascade).
            continue
        dupe = ContentType.objects.filter(app_label=to_label, model=model)
        deleted, _ = dupe.delete()
        if deleted:
            print(
                f"  [ops_rbac.0002] {model}: removed {deleted} stale "
                f"{to_label} content_type row(s) (+cascade) before relabel"
            )
        source.update(app_label=to_label)


def forward(apps, schema_editor):
    _relabel(apps, "operations", "ops_rbac")


def reverse(apps, schema_editor):
    _relabel(apps, "ops_rbac", "operations")


class Migration(migrations.Migration):

    dependencies = [
        ("ops_rbac", "0001_initial"),
        ("operations", "0006_remove_rbac_models_state"),
    ]

    operations = [
        migrations.RunPython(forward, reverse, elidable=True),
    ]
