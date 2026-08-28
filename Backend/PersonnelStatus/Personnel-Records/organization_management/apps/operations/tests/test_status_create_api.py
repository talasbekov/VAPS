"""POST /api/operations/statuses/ — создание ОДНОГО статуса.

Маршрута не было, а сервис был — со всеми проверками и с протоколом обхода
мягкого пересечения. Дыра была не косметической: массовый путь обхода не имеет и
сам отправляет оператора «разводить такие строки поштучно», а идти было некуда.
Оператор, у которого пачка упёрлась в мягкое пересечение, не мог записать статус
ВООБЩЕ НИКАК.

Отсюда и главная нить файла — обход. Всё остальное (границы интервала, жёсткие
пересечения, поправка сданного дня) живёт в сервисе и покрыто его тестами; здесь
проверяется зона вьюхи: гейт, область, форма тела, подпись и перевод отказов.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.tests.test_status_participation import (
    participation_catalog,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

URL = "/api/operations/statuses/"


def body(employee, code="DUTY", start=None, end=None, **extra):
    payload = {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": (TODAY if start is None else start).isoformat(),
        "date_end": (TODAY + timedelta(days=2) if end is None else end).isoformat(),
    }
    payload.update(extra)
    return payload


def post(api, payload):
    with clock.override(TODAY):
        return api.post(URL, payload, format="json")


def operator(name="single-op", scope=None):
    return client_for(name, "ORGD", ["status.manage"], scope)


# ── Гейт и область ───────────────────────────────────────────────────────


def test_anonymous_is_refused(types, division):  # noqa: F811
    assert post(APIClient(), body(make_employee(division))).status_code == 403


def test_the_read_permission_is_not_enough(types, division):  # noqa: F811
    """Создание — правка чужой строки, и права на чтение для неё мало."""
    api, _ = client_for("single-reader", "ORGD", ["status.view"])

    assert post(api, body(make_employee(division))).status_code == 403


def test_the_manage_permission_is_enough(types, division):  # noqa: F811
    api, _ = operator()

    assert post(api, body(make_employee(division))).status_code == 201


def test_an_employee_of_a_foreign_division_is_refused(types, division):  # noqa: F811
    other = Division.objects.create(name="Чужое управление")
    theirs = make_employee(other)
    api, _ = operator(scope=division.id)

    response = post(api, body(theirs))

    assert response.status_code == 403
    assert OpsEmployeeStatus.objects.count() == 0


def test_an_employee_inside_the_scope_is_served(types, division):  # noqa: F811
    """Иначе отказ выше объяснялся бы отсутствием права вообще, а не областью."""
    api, _ = operator(scope=division.id)

    assert post(api, body(make_employee(division))).status_code == 201


# ── Что создаётся ────────────────────────────────────────────────────────


def test_the_row_carries_what_was_asked_for(types, division):  # noqa: F811
    employee = make_employee(division)
    api, _ = operator()

    post(api, body(employee, code="STUDY"))

    row = OpsEmployeeStatus.objects.get()
    assert row.employee_id == employee.id
    assert row.status_type_code == "STUDY"
    assert row.date_start == TODAY


def test_the_author_comes_from_authentication_and_not_from_the_body(
    types, division  # noqa: F811
):
    employee = make_employee(division)
    api, user = operator()

    post(api, body(employee, created_by="999", actor="999"))

    assert OpsEmployeeStatus.objects.get().created_by == str(user.pk)


def test_the_source_is_the_operator_and_not_a_projection(types, division):  # noqa: F811
    """Строки проекции пишет не этот путь: помеченная иначе, она попала бы под
    правила автоматических статусов, которые оператор не правит."""
    api, _ = operator()

    post(api, body(make_employee(division)))

    assert OpsEmployeeStatus.objects.get().source == OpsEmployeeStatus.Source.USER


# ── Обход мягкого пересечения — то, ради чего маршрут и заведён ──────────


def _with_existing_soft(division):
    """Сотрудник, у которого УЖЕ идёт мягко пересекающийся статус."""
    employee = make_employee(division)
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="STUDY",
        date_start=TODAY - timedelta(days=1),
        date_end=TODAY + timedelta(days=5),
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )
    return employee


def test_a_soft_overlap_is_refused_and_advertised_as_overridable(types, division):  # noqa: F811
    """Признак несёт сам ответ: клиент не должен угадывать обходимость по коду.

    Это то, чего массовый путь дать не может, — и ровно поэтому маршрут нужен.
    """
    api, _ = operator()

    response = post(api, body(_with_existing_soft(division)))

    assert response.status_code == 409
    assert response.json()["error_code"] == "STATUS_OVERLAP_WARNING"
    assert response.json()["overridable"] is True


def test_the_overlap_can_be_overridden_with_a_reason(types, division):  # noqa: F811
    """Тупик закрыт: оператор доводит работу до конца."""
    employee = _with_existing_soft(division)
    api, _ = operator()

    response = post(
        api,
        body(employee, override=True, override_reason="решение руководителя"),
    )

    assert response.status_code == 201
    assert OpsEmployeeStatus.objects.filter(employee_id=employee.id).count() == 2


def test_an_override_without_a_reason_is_refused_by_the_form(types, division):  # noqa: F811
    """Обход без объяснения неотличим от продавливания. Отказ формы называет
    ПОЛЕ — это владелец правила на HTTP-границе."""
    api, _ = operator()

    response = post(
        api, body(_with_existing_soft(division), override=True, override_reason="  ")
    )

    assert response.status_code == 400
    assert "override_reason" in response.json()


def test_a_hard_overlap_is_not_overridable_at_all(types, division):  # noqa: F811
    """Жёсткое пересечение не обходится ничем, и признака у него быть не должно
    — иначе клиент предложил бы кнопку, за которой ничего нет."""
    employee = make_employee(division)
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="VACATION",
        date_start=TODAY - timedelta(days=1),
        date_end=TODAY + timedelta(days=5),
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )
    api, _ = operator()

    response = post(
        api,
        body(employee, code="VACATION", override=True, override_reason="всё равно"),
    )

    assert response.status_code == 422
    assert "overridable" not in response.json()


# ── Форма тела ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "missing", ["employee_id", "status_type_code", "date_start", "date_end"]
)
def test_every_required_field_is_required(types, division, missing):  # noqa: F811
    api, _ = operator()
    payload = body(make_employee(division))
    payload.pop(missing)

    assert post(api, payload).status_code == 400


def test_an_unknown_status_type_is_a_domain_refusal(types, division):  # noqa: F811
    """Не 400: форма верна, а вот такого типа в справочнике нет — это состояние
    данных, и код у него свой."""
    api, _ = operator()

    response = post(api, body(make_employee(division), code="НЕТ_ТАКОГО"))

    assert response.status_code == 422
    assert response.json()["error_code"] == "INVALID_STATUS_TYPE"


def test_a_delete_on_the_collection_is_still_not_served(types, division):  # noqa: F811
    """Появление создания не открыло прочих глаголов: удаления у статусов нет —
    строки отменяют, а не стирают."""
    api, _ = operator()

    assert api.delete(URL).status_code == 405


# ── Мероприятия статуса (Plane №274, Ш-4) ────────────────────────────────
#
# ПОЧЕМУ ПРОБА ЗДЕСЬ, А НЕ В test_status_participation.py. Тот файл целиком
# бьёт по СЕРВИСУ — и был зелёным ровно в тот момент, когда ручка теряла
# мероприятия полностью: поле `participations` стояло в сериализаторе
# МАССОВОГО создания, а одиночный его не объявлял. DRF молча выбрасывает
# необъявленное поле, вьюха читала `data.get("participations")` → None, сервис
# честно понимал None как «не трогать» и не писал ничего. Тело запроса верное,
# ответ 201, в базе пусто. Сервисные пробы такое не видят по построению.
#
# Стережёт мутацию: снять `participations` со StatusCreateSerializer.


def test_the_single_route_carries_participations_to_the_database(
    types, division, participation_catalog  # noqa: F811
):
    api, _ = operator()
    employee = make_employee(division)
    event_id = 4101

    response = post(api, body(employee, participations=[
        {"event_id": event_id, "kind_code": "SCREENING_GROUP", "role_code": "SCREENER"},
    ]))

    assert response.status_code == 201, response.data
    rows = OpsStatusParticipation.objects.filter(status_id=response.data["id"])
    assert [(r.event_id, r.kind_code, r.role_code) for r in rows] == [
        (event_id, "SCREENING_GROUP", "SCREENER"),
    ]
    # Ответ ручки несёт их же: клиент рисует карточку по нему, а не по base.
    assert response.data["participations"] == [
        {"event_id": event_id, "kind_code": "SCREENING_GROUP", "role_code": "SCREENER"},
    ]


def test_a_status_without_participations_stays_empty(
    types, division, participation_catalog  # noqa: F811
):
    """Ключа нет — строк нет; поле необязательное и не выдумывает мероприятий."""
    api, _ = operator()

    response = post(api, body(make_employee(division)))

    assert response.status_code == 201, response.data
    assert not OpsStatusParticipation.objects.filter(status_id=response.data["id"]).exists()
    assert response.data["participations"] == []


def test_a_role_from_another_group_is_refused_by_the_route(
    types, division, participation_catalog  # noqa: F811
):
    """Отказ сервиса доезжает до клиента причиной, а не 500."""
    api, _ = operator()
    event_id = 4102

    response = post(api, body(make_employee(division), participations=[
        {"event_id": event_id, "kind_code": "PHYSICAL_SQUAD", "role_code": "SCREENER"},
    ]))

    assert response.status_code == 400, response.data
    assert "participations.0.role_code" in str(response.data)
