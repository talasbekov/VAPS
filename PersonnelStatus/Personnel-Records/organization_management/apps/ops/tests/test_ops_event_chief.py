"""Старший наряда бюллетеня: наследование объектом и правка после создания.

Plane №190, постановка заказчика дословно: «При создании бюллетени выбираешь
старшего наряда, но после создания бюллетени обьект не имеет старшего, даже
если обьект не выбран то должна быть возможность добавлять старшего наряда».

Две разные жалобы в одной строке, и пробы разведены по ним:

1. старший, названный в окне создания, не доезжал до объекта посещения,
   который тем же окном и заводился — человек назначал старшего и тут же
   видел «старший не назначен»;
2. изменить старшего после создания было нечем вовсе, а у ОМ без объекта не
   помогал и обходной путь через старшего объекта — объекта нет.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops import security_events as event_service

pytestmark = pytest.mark.django_db


def _employee(**fields):
    from organization_management.apps.employees.models import Employee

    return Employee.objects.create(**fields)


@pytest.fixture
def chief():
    return _employee(
        personnel_number="P-CHIEF",
        last_name="Старшинов",
        first_name="Иван",
        birth_date="1985-01-01",
        gender="M",
        iin="850000001111",
        hire_date="2010-01-01",
        employment_status="working",
    )


@pytest.fixture
def other_chief():
    return _employee(
        personnel_number="P-OTHER",
        last_name="Заменов",
        first_name="Пётр",
        birth_date="1986-01-01",
        gender="M",
        iin="860000002222",
        hire_date="2011-01-01",
        employment_status="working",
    )


def _object(name, code):
    from organization_management.apps.operations.models_object import (
        OpsSecurityObject,
    )

    return OpsSecurityObject.objects.create(
        name=name,
        code=code,
        object_type="Госучреждение",
        region="г. Астана",
        address="пр. Мәңгілік Ел, 8",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED,
    )


@pytest.fixture
def security_object():
    return _object("Объект пробы", "OBJ-CHIEF-1")


def make_event(*, object_id=None, chief_id=None):
    return event_service.create_event(
        title="Проба старшего",
        object_id=object_id,
        business_date=dt.date(2026, 5, 1).isoformat(),
        kind="INTERNAL",
        chief_employee_id=chief_id,
        actor="test",
    )


def test_visit_object_inherits_the_chief_named_at_creation(chief, security_object):
    """Объект, заведённый ВМЕСТЕ с бюллетенем, получает его старшего."""
    event = make_event(object_id=str(security_object.pk), chief_id=str(chief.pk))

    visit = event.visit_objects.get()

    assert visit.chief_employee_id == chief.pk
    assert visit.chief_name != "", "подпись старшего у объекта пуста"
    assert visit.chief_name == event.chief_name


def test_a_later_object_does_not_get_the_chief_silently(chief, security_object):
    """КРАСНАЯ ПРОБА ГРАНИЦЫ НАСЛЕДОВАНИЯ.

    Объект, дописанный кнопкой «+» позже, старшего НЕ получает: у визита
    иностранного ОЛ на каждом объекте свой ответственный, и подставить туда
    старшего наряда значило бы назначить человека молча — ровно та ошибка,
    от которой уходит первая проба, только с другой стороны.
    """
    event = make_event(object_id=str(security_object.pk), chief_id=str(chief.pk))
    later = _object("Объект, добавленный позже", "OBJ-CHIEF-2")

    event = event_service.add_visit_object(event.pk, object_id=str(later.pk))

    added = event.visit_objects.get(object_name="Объект, добавленный позже")
    assert added.chief_employee_id is None
    assert added.chief_name == ""


def test_the_chief_can_be_named_after_creation_without_any_object(chief):
    """Бюллетень БЕЗ объекта — старший всё равно назначается.

    Это второй случай из постановки: обходного пути через старшего объекта
    здесь нет, потому что объекта нет.
    """
    event = make_event()
    assert event.chief_employee_id is None

    event = event_service.set_event_chief(
        event.pk, employee_id=str(chief.pk), actor="test"
    )

    assert event.chief_employee_id == chief.pk
    assert event.chief_name != ""
    assert event.visit_objects.count() == 0, "объект завёлся сам — это не про эту пробу"


def test_the_chief_is_replaced_in_one_call(chief, other_chief):
    """Замена — ОДНА операция, без промежуточного «старшего нет»."""
    event = make_event(chief_id=str(chief.pk))

    event = event_service.set_event_chief(
        event.pk, employee_id=str(other_chief.pk), actor="test"
    )

    assert event.chief_employee_id == other_chief.pk


def test_an_empty_employee_removes_the_chief(chief):
    """Пустой `employeeId` снимает старшего — той же ручкой."""
    event = make_event(chief_id=str(chief.pk))

    event = event_service.set_event_chief(event.pk, employee_id="", actor="test")

    assert event.chief_employee_id is None
    assert event.chief_name == ""


def test_removing_a_chief_that_is_not_there_is_refused(chief):
    """Снять некого — ОТКАЗ, а не тихое «ок».

    Молчаливый успех на пустом месте читается как «сняли», и человек уходит с
    экрана уверенным в том, чего не было.
    """
    event = make_event()

    with pytest.raises(DomainError) as raised:
        event_service.set_event_chief(event.pk, employee_id="", actor="test")

    assert raised.value.http_status == 404


def test_an_unknown_employee_is_refused_by_field(chief):
    """Несуществующий сотрудник — отказ ПОЛЕМ, а не 500."""
    event = make_event()

    with pytest.raises(DomainError) as raised:
        event_service.set_event_chief(event.pk, employee_id="999999", actor="test")

    assert raised.value.http_status == 400
    assert "employeeId" in raised.value.detail


def test_a_closed_event_keeps_its_chief(chief, other_chief):
    """Закрытое мероприятие старшего не меняет: наряд отработал."""
    event = make_event(chief_id=str(chief.pk))
    event.stage = "CLOSED"
    event.save(update_fields=["stage"])

    with pytest.raises(DomainError) as raised:
        event_service.set_event_chief(
            event.pk, employee_id=str(other_chief.pk), actor="test"
        )

    assert raised.value.http_status == 422
    event.refresh_from_db()
    assert event.chief_employee_id == chief.pk
