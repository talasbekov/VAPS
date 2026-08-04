"""PATCH /api/operations/statuses/{id}/ — маршрут поштучной правки статуса.

Вьюха тонкая, поэтому проверяется ровно её зона ответственности: гейт права,
происхождение области видимости (из RBAC, а не из тела запроса), защита
неизменяемых полей, форма 200 и то, что отказы сервиса доезжают до клиента
конвертом раздела, а не 500-й. Сами правила правки (блокировка, гарды,
пересечения) живут в сервисе и покрыты test_status_service.py.

Фикстуры-помощники переиспользуются из соседнего маршрутного теста: сид роли,
клиент с ролью и сотрудник со штатной единицей — общая обвязка обоих
маршрутов, и её расхождение между файлами было бы источником ложной зелени.
"""
from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest, используется по имени аргумента
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db


def url(status_id):
    return f"/api/operations/statuses/{status_id}/"


def make_status(employee, **overrides):
    fields = {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": TODAY + timedelta(days=3),
        "date_end": TODAY + timedelta(days=5),
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": "seed",
    }
    fields.update(overrides)
    return OpsEmployeeStatus.objects.create(**fields)


def patch(api, status_id, body):
    with clock.override(TODAY):
        return api.patch(url(status_id), body, format="json")


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 именно ГЕЙТА права, а не области видимости.

    Оба отказа — 403, и без различения тест гейта зеленел бы от отказа по
    области. Различает форма: гейт поднимает PermissionDenied DRF (обработчик
    раздела чужие исключения не переформатирует → ключ detail), область —
    DomainError → конверт с error_code.
    """
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(APIClient(), status_row.pk, {"comment": "аноним"})
    assert_denied_by_gate(response)
    status_row.refresh_from_db()
    assert status_row.comment == ""


def test_without_status_manage_403(types, division):
    # У роли есть ЧТЕНИЕ статусов, но не запись — сосед по префиксу не должен
    # открывать правку.
    api, _ = client_for("upd-viewer", "VIEWER", ["status.view"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {"comment": "нельзя"})
    assert_denied_by_gate(response)
    status_row.refresh_from_db()
    assert status_row.comment == ""


# ── Успех ────────────────────────────────────────────────────────────────

def test_patch_applies_and_returns_row(types, division):
    api, _ = client_for("upd-ok", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(
        api,
        status_row.pk,
        {
            "comment": "уточнение",
            "document_basis": "Приказ №9",
            "date_end": (TODAY + timedelta(days=6)).isoformat(),
        },
    )
    assert response.status_code == 200
    assert response.data["comment"] == "уточнение"
    assert response.data["document_basis"] == "Приказ №9"
    assert response.data["date_end"] == (TODAY + timedelta(days=6)).isoformat()
    # Выводимое состояние отдаётся сервером: строка начинается через 3 дня.
    assert response.data["state"] == "PLANNED"
    # Ответ не расходится с БД.
    status_row.refresh_from_db()
    assert status_row.comment == "уточнение"
    assert status_row.date_end == TODAY + timedelta(days=6)


def test_patch_can_clear_comment(types, division):
    # Пустая строка — законное значение (снять ошибочный комментарий), а не
    # «поле не прислали»: allow_blank отличает одно от другого.
    api, _ = client_for("upd-clear", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee, comment="ошибочный")
    response = patch(api, status_row.pk, {"comment": ""})
    assert response.status_code == 200
    status_row.refresh_from_db()
    assert status_row.comment == ""


# ── Область видимости ────────────────────────────────────────────────────

def test_foreign_division_403_envelope(types, division):
    from organization_management.apps.divisions.models import Division

    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "upd-scoped", "OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    employee = make_employee(other)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {"comment": "чужое подразделение"})
    # Именно конверт области, а не {detail} гейта: право у оператора ЕСТЬ.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    status_row.refresh_from_db()
    assert status_row.comment == ""


def test_employee_without_staff_unit_403_envelope(types, division):
    # Сотрудник без штатной единицы не принадлежит ничьей области — правка
    # закрыта по умолчанию, как и в пачке.
    api, _ = client_for(
        "upd-noslot", "OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    employee = make_employee(None)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {"comment": "без слота"})
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_scoped_operator_edits_own_division(types, division):
    # Обратная сторона теста области: тот же скоупованный оператор СВОЮ
    # строку правит успешно — иначе отказ выше нельзя отличить от «этот
    # оператор не может ничего».
    api, _ = client_for(
        "upd-own", "OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {"comment": "своё"})
    assert response.status_code == 200


# ── Форма запроса ────────────────────────────────────────────────────────

def test_empty_body_400(types, division):
    api, _ = client_for("upd-empty", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {})
    assert response.status_code == 400


@pytest.mark.parametrize(
    "field, value",
    [
        ("status_type_code", "VACATION"),
        ("employee_id", 12345),
        ("source", "OM_AUTO"),
        ("cancelled_at", "2026-08-04T00:00:00Z"),
    ],
)
def test_immutable_field_400(types, division, field, value):
    # Неизменяемое поле отвергается ЯВНО: молчаливое игнорирование неизвестных
    # ключей (штатное поведение DRF) вернуло бы 200 на несделанную работу.
    api, _ = client_for(f"upd-imm-{field}", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {"comment": "с довеском", field: value})
    assert response.status_code == 400
    assert field in response.data
    status_row.refresh_from_db()
    assert status_row.comment == ""
    assert status_row.status_type_code == "DUTY"


def test_malformed_date_400(types, division):
    api, _ = client_for("upd-baddate", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    response = patch(api, status_row.pk, {"date_end": "не дата"})
    assert response.status_code == 400


# ── Ошибки сервиса доезжают конвертом ────────────────────────────────────

def test_missing_status_404_envelope(types, division):
    api, _ = client_for("upd-404", "ADMIN", ["*"])
    response = patch(api, 999999, {"comment": "призрак"})
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_garbage_id_404_envelope(types, division):
    # Мусор в пути — 404, а не 500 от int() внутри запроса.
    api, _ = client_for("upd-garbage", "ADMIN", ["*"])
    response = patch(api, "abc", {"comment": "мусорный id"})
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_cancelled_status_422_envelope(types, division):
    api, _ = client_for("upd-cancelled", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    with clock.override(TODAY):
        OpsEmployeeStatus.objects.filter(pk=status_row.pk).update(
            cancelled_at=clock.Clock.now(), cancelled_by="7", cancelled_reason="ошибка"
        )
    response = patch(api, status_row.pk, {"comment": "правка отменённого"})
    assert response.status_code == 422
    assert response.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_projection_row_422_envelope(types, division):
    api, _ = client_for("upd-auto", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee, source=OpsEmployeeStatus.Source.OM_AUTO)
    response = patch(api, status_row.pk, {"comment": "ручная правка"})
    assert response.status_code == 422
    assert response.data["error_code"] == "AUTO_STATUS_READONLY"


def test_hard_overlap_422_envelope(types, division):
    api, _ = client_for("upd-hard", "ADMIN", ["*"])
    employee = make_employee(division)
    make_status(
        employee,
        status_type_code="VACATION",
        date_start=TODAY + timedelta(days=10),
        date_end=TODAY + timedelta(days=12),
    )
    status_row = make_status(employee, status_type_code="VACATION")
    response = patch(
        api,
        status_row.pk,
        {"date_end": (TODAY + timedelta(days=11)).isoformat()},
    )
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert "overridable" not in response.data
    status_row.refresh_from_db()
    assert status_row.date_end == TODAY + timedelta(days=5)


def test_soft_overlap_409_envelope(types, division):
    # Мягкий сосед взят ИДУЩИЙ: пересечение с ещё не начавшимся матрица
    # понижает до необязывающего предупреждения, и тест был бы вакуумным.
    # Конверт помечен overridable — обхода у правки нет, но признак несёт
    # сама доменная ошибка; клиенту он говорит «повтори иначе», а не «жми
    # кнопку».
    api, _ = client_for("upd-soft", "ADMIN", ["*"])
    employee = make_employee(division)
    make_status(
        employee,
        status_type_code="STUDY",
        date_start=TODAY,
        date_end=TODAY + timedelta(days=2),
    )
    status_row = make_status(employee)
    response = patch(
        api,
        status_row.pk,
        {"date_start": (TODAY + timedelta(days=1)).isoformat()},
    )
    assert response.status_code == 409
    assert response.data["error_code"] == "STATUS_OVERLAP_WARNING"
    status_row.refresh_from_db()
    assert status_row.date_start == TODAY + timedelta(days=3)


# ── Поверхность метода ───────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["get", "put", "delete"])
def test_other_methods_are_not_served(types, division, method):
    # Правка только частичная: PUT переписал бы неизменяемые поля, DELETE
    # уничтожил бы факт (строки не удаляются, а отменяются), GET — отдельный
    # срез чтения. 405, а не дезориентирующий 403.
    api, _ = client_for(f"upd-method-{method}", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(employee)
    with clock.override(TODAY):
        response = getattr(api, method)(url(status_row.pk), {}, format="json")
    assert response.status_code == 405


def test_date_only_edit_keeps_metadata(types, division):
    # Не присланное поле остаётся прежним: PATCH не обнуляет метаданные
    # молча (иначе правка даты стирала бы основание).
    api, _ = client_for("upd-partial", "ADMIN", ["*"])
    employee = make_employee(division)
    status_row = make_status(
        employee, comment="исходный", document_basis="Приказ №1"
    )
    response = patch(
        api,
        status_row.pk,
        {"date_end": (TODAY + timedelta(days=7)).isoformat()},
    )
    assert response.status_code == 200
    status_row.refresh_from_db()
    assert status_row.comment == "исходный"
    assert status_row.document_basis == "Приказ №1"
    assert status_row.date_end == TODAY + timedelta(days=7)
