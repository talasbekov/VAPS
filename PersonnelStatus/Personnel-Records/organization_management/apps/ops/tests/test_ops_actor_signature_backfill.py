"""Бэкфилл уже записанных подписей: логин → фамилия (Plane №484).

🔴 ЗАЧЕМ ПРОБА У МИГРАЦИИ. Прецедент проекта — `0030_backfill_event_owner_name`
— пробы не имел, и проверить, что бэкфилл действительно сработал (а не только
накатился), было нечем. Здесь правило «новый тест — красная проба» применено к
самой миграции: функция зовётся напрямую с боевым реестром моделей, потому что
исторические модели этих таблиц ничем от нынешних не отличаются (миграция
меняет только данные).

Что стережётся:

1. логин, за которым стоит кадровая запись, заменяется фамилией — в обоих
   полях, а не только в том, о котором говорит карточка;
2. подпись, которая логином НЕ является («—», уже проставленное ФИО, логин
   учётки без кадровой записи), не трогается: выдумывать за неё имя нечем.
"""
import importlib

import pytest
from django.apps import apps as django_apps

# Модуль миграции зовётся с цифры — обычным `import` его имя не записать.
_0098 = importlib.import_module(
    "organization_management.apps.operations.migrations"
    ".0098_backfill_actor_display_signatures"
)
from organization_management.apps.operations.models_event import (
    OpsPlacementDocumentVersion,
    OpsVisitObjectDeputy,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    chief_for,  # noqa: F401
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def visit(manager):  # noqa: F811
    """Объект посещения — родитель обеих таблиц с подписями."""
    from organization_management.apps.operations.models_event import (
        OpsSecurityEventVisitObject,
    )

    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба бэкфилла подписей",
            "objectId": str(obj.pk),
            "businessDate": "2026-12-31",
            "kind": "INTERNAL",
            "chiefEmployeeId": str(chief_for(manager).pk),
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    return OpsSecurityEventVisitObject.objects.get(event_id=created.json()["id"])


def test_a_login_behind_a_personnel_record_becomes_the_surname(
    visit, django_user_model
):
    """Красная на мутации «сделать `backfill_signatures` пустой»: в полях
    останутся логины."""
    author = django_user_model.objects.create_user(username="sig-author", password="x")
    employee = make_employee(last_name="Ниязов", first_name="Пётр")
    employee.user = author
    employee.save(update_fields=["user"])
    version = OpsPlacementDocumentVersion.objects.create(
        visit_object=visit, number=1, created_by="sig-author"
    )
    deputy = OpsVisitObjectDeputy.objects.create(
        visit_object=visit,
        employee_id=employee.pk,
        employee_name="Ниязов П.",
        assigned_by="sig-author",
    )

    _0098.backfill_signatures(django_apps, None)

    version.refresh_from_db()
    deputy.refresh_from_db()
    assert version.created_by == "Ниязов П."
    assert deputy.assigned_by == "Ниязов П.", "второе видимое поле забыто"


def test_what_is_not_a_login_is_left_alone(visit, django_user_model):
    """Опознание — по совпадению с `username` ЖИВОЙ учётки, за которой стоит
    кадровая запись. Всё прочее миграция не трогает."""
    django_user_model.objects.create_user(username="sig-bare", password="x")
    rows = {
        name: OpsPlacementDocumentVersion.objects.create(
            visit_object=visit, number=number, created_by=name
        )
        for number, name in enumerate(("—", "Абаев А.", "sig-bare", ""), start=10)
    }

    _0098.backfill_signatures(django_apps, None)

    for name, row in rows.items():
        row.refresh_from_db()
        assert row.created_by == name, f"подпись {name!r} переписана без основания"
