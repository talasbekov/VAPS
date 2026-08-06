"""POST /api/operations/statuses/{id}/extend/ — продление статуса.

Второй сервис, у которого не было маршрута. Продление — отдельная операция, а не
частный случай правки: оно монотонно (укорачивание — это досрочное завершение) и
пишет в журнал своё событие.

Отдельная нить — ПРОТОКОЛ ОБХОДА мягкого конфликта. Он здесь тот же, что у правки
и у разрешения заглушки, и это проверяется явно: оператор, научившийся обходить
пересечение в одном месте раздела, не должен заново выяснять правила в другом.

Конфликтующая строка в этих пробах УЖЕ НАЧАЛАСЬ, и это не деталь: пересечение с
ещё не начавшейся строкой раздел считает неблокирующим предупреждением (FR-10),
и на такой фикстуре обходить было бы нечего — первый проход файла на этом и
попался.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

END = TODAY + timedelta(days=5)
LONGER = TODAY + timedelta(days=9)


def url(status_id):
    return f"/api/operations/statuses/{status_id}/extend/"


def make_status(employee, code="DUTY", start=None, end=None):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=TODAY - timedelta(days=2) if start is None else start,
        date_end=END if end is None else end,
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def extend(api, status_id, body=None, at=TODAY):
    with clock.override(at):
        return api.post(
            url(status_id),
            {"new_date_end": LONGER.isoformat()} if body is None else body,
            format="json",
        )


def operator(name="extend-op", scope=None):
    return client_for(name, "ORGD", ["status.manage"], scope)


# ── Гейт права и область ─────────────────────────────────────────────────


def test_anonymous_is_refused(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))

    assert extend(APIClient(), status_row.pk).status_code == 403


def test_an_authenticated_user_without_the_permission_is_refused(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = client_for("no-perm-ext", "ORGD", ["status.view"])

    assert extend(api, status_row.pk).status_code == 403


def test_the_manage_permission_is_enough(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert extend(api, status_row.pk).status_code == 200


def test_a_status_of_a_foreign_division_is_refused(types, division):  # noqa: F811
    other = Division.objects.create(name="Чужое управление")
    theirs = make_status(make_employee(other))
    api, _ = operator(scope=division.id)

    response = extend(api, theirs.pk)

    theirs.refresh_from_db()
    assert response.status_code == 403
    assert theirs.date_end == END


def test_a_status_inside_the_scope_is_extended(types, division):  # noqa: F811
    """Иначе отказ выше объяснялся бы отсутствием права вообще, а не областью."""
    mine = make_status(make_employee(division))
    api, _ = operator(scope=division.id)

    assert extend(api, mine.pk).status_code == 200


def test_a_get_is_a_method_error_not_a_denial(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert api.get(url(status_row.pk)).status_code == 405


# ── Что делает операция ──────────────────────────────────────────────────


def test_the_interval_moves_to_the_new_end(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    extend(api, status_row.pk)

    status_row.refresh_from_db()
    assert status_row.date_end == LONGER


def test_an_already_finished_status_can_still_be_extended(types, division):  # noqa: F811
    """Отпуск, который на деле длился дольше: полуинтервал просто съезжает
    вправо, факты остаются своими."""
    finished = make_status(
        make_employee(division),
        start=TODAY - timedelta(days=10),
        end=TODAY - timedelta(days=3),
    )
    api, _ = operator()

    response = extend(
        api, finished.pk, {"new_date_end": (TODAY - timedelta(days=1)).isoformat()}
    )

    finished.refresh_from_db()
    assert response.status_code == 200
    assert finished.date_end == TODAY - timedelta(days=1)


def test_the_operation_writes_its_own_journal_event(types, division):  # noqa: F811
    """Продление рассказывает в журнале свою историю: STATUS_EXTENDED, а не
    STATUS_UPDATED."""
    status_row = make_status(make_employee(division))
    api, _ = operator()

    extend(api, status_row.pk)

    assert OpsAuditLog.objects.filter(
        action=audit_service.STATUS_EXTENDED, entity_id=status_row.pk
    ).count() == 1
    assert OpsAuditLog.objects.filter(action=audit_service.STATUS_UPDATED).count() == 0


def test_the_signature_comes_from_authentication(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, user = operator()

    extend(api, status_row.pk, {"new_date_end": LONGER.isoformat(), "actor": "999"})

    entry = OpsAuditLog.objects.get(action=audit_service.STATUS_EXTENDED)
    assert entry.actor_user_id == str(user.pk)


# ── Монотонность ─────────────────────────────────────────────────────────


def test_a_date_that_shortens_the_interval_is_refused(types, division):  # noqa: F811
    """«Продление», которое укорачивает, — это досрочное завершение чужим
    путём: у него другие правила и другое событие журнала."""
    status_row = make_status(make_employee(division))
    api, _ = operator()

    response = extend(
        api, status_row.pk, {"new_date_end": (END - timedelta(days=1)).isoformat()}
    )

    assert response.status_code == 422


def test_the_same_date_is_refused_too(types, division):  # noqa: F811
    """Продление, которое ничего не продлевает, — ошибка вызывающего, а не
    успешная пустая операция."""
    status_row = make_status(make_employee(division))
    api, _ = operator()

    response = extend(api, status_row.pk, {"new_date_end": END.isoformat()})

    assert response.status_code == 422


# ── Протокол обхода мягкого конфликта ────────────────────────────────────


def _blocking_neighbour(employee):
    """Мягко конфликтующая строка — обязательно УЖЕ НАЧАВШАЯСЯ.

    Первый проход ставил её сразу за концом продлеваемой, то есть в будущем, и
    конфликта не возникало вовсе: пересечение со строкой, которая ещё не
    началась, раздел считает НЕБЛОКИРУЮЩИМ предупреждением (FR-10) — планы
    двигаются, и запрещать их пересечение заранее значило бы мешать
    планированию. Отсюда начало в прошлом: только оно даёт настоящий мягкий
    конфликт, который и обходят.
    """
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="STUDY",
        date_start=TODAY - timedelta(days=1),
        date_end=LONGER,
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )


def test_a_soft_conflict_answers_with_a_conflict_and_leaves_the_row_alone(
    types, division  # noqa: F811
):
    employee = make_employee(division)
    status_row = make_status(employee)
    _blocking_neighbour(employee)
    api, _ = operator()

    response = extend(api, status_row.pk)

    status_row.refresh_from_db()
    assert response.status_code == 409
    assert status_row.date_end == END


def test_the_conflict_can_be_overridden_with_a_reason(types, division):  # noqa: F811
    """Тот же протокол, что у правки и разрешения заглушки: override + причина
    в КОРНЕ тела."""
    employee = make_employee(division)
    status_row = make_status(employee)
    _blocking_neighbour(employee)
    api, _ = operator()

    response = extend(
        api,
        status_row.pk,
        {
            "new_date_end": LONGER.isoformat(),
            "override": True,
            "override_reason": "решение руководителя",
        },
    )

    status_row.refresh_from_db()
    assert response.status_code == 200
    assert status_row.date_end == LONGER


def test_an_override_without_a_reason_is_refused_on_the_form(types, division):  # noqa: F811
    """Обход без объяснения неотличим от продавливания.

    Отказ проверяется ПО ФОРМЕ ответа, а не по коду: сервис отвергает то же
    самое и тем же кодом 400, поэтому «получили 400» не показало бы, кто
    отказал. Владелец на HTTP-границе — форма (тот же уговор, что у причины
    отмены), и её отказ называет ПОЛЕ прямо в корне.

    Формы ответа у двух отказов РАЗНЫЕ, и это свойство раздела, а не случайность:
    доменный отказ уходит конвертом {error_code, message, details, ...}, а
    отказ формы — штатным ответом DRF ({поле: [сообщения]}), потому что
    обработчик раздела чужие ошибки намеренно не переписывает. Проба со снятой
    проверкой формы роняет запрос в сервис, и в корне появляется error_code
    вместо имени поля.
    """
    employee = make_employee(division)
    status_row = make_status(employee)
    _blocking_neighbour(employee)
    api, _ = operator()

    response = extend(
        api,
        status_row.pk,
        {"new_date_end": LONGER.isoformat(), "override": True, "override_reason": "  "},
    )

    body = response.json()
    assert response.status_code == 400
    assert "override_reason" in body
    assert "error_code" not in body


def test_the_service_refuses_a_reasonless_override_too(types, division):  # noqa: F811
    """Второй владелец правила — сервис, и он не декорация: маршрут не
    единственный вход, и пачки с оркестраторами приходят мимо формы.

    Проверяется прямым вызовом, а не через HTTP: через HTTP до сервиса не
    добраться — форма отвечает раньше.
    """
    from organization_management.apps.operations.exceptions import DomainError
    from organization_management.apps.operations.status_service import extend_status

    employee = make_employee(division)
    status_row = make_status(employee)

    with pytest.raises(DomainError) as exc:
        with clock.override(TODAY):
            extend_status(
                status_row,
                actor="7",
                new_date_end=LONGER,
                override=True,
                override_reason="   ",
            )

    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.detail == {"field": "override_reason"}


def test_the_override_flag_alone_does_not_extend_a_clean_row_differently(
    types, division  # noqa: F811
):
    """Обход не меняет исход там, где конфликта нет: он снимает препятствие, а
    не делает операцию другой."""
    status_row = make_status(make_employee(division))
    api, _ = operator()

    response = extend(
        api,
        status_row.pk,
        {
            "new_date_end": LONGER.isoformat(),
            "override": True,
            "override_reason": "на всякий случай",
        },
    )

    status_row.refresh_from_db()
    assert response.status_code == 200
    assert status_row.date_end == LONGER


# ── Форма тела и отказы ──────────────────────────────────────────────────


def test_the_new_end_is_required(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert extend(api, status_row.pk, {}).status_code == 400


def test_an_unreadable_date_is_a_form_error(types, division):  # noqa: F811
    status_row = make_status(make_employee(division))
    api, _ = operator()

    assert extend(api, status_row.pk, {"new_date_end": "потом"}).status_code == 400


def test_a_missing_status_is_not_found(types, division):  # noqa: F811
    api, _ = operator()

    assert extend(api, 10**9).status_code == 404


def test_a_junk_id_answers_the_same_way_as_a_missing_one(types, division):  # noqa: F811
    api, _ = operator()

    assert extend(api, "abc").status_code == 404
