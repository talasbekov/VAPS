"""Срок сдачи списка у заявки департаменту (Plane №287).

На эталоне заказчика у заявки есть колонка «Срок» — дата со временем, за сутки
до мероприятия. Поля такого не было ВООБЩЕ: у ОМ есть своя дата и своё время, а
момента, к которому департамент обязан отдать список, не существовало ни как
поля, ни как правила. Отсюда и следствие, названное в карточке: «опоздал» и
«ещё можно» неразличимы, штаб не может ни напомнить, ни отбить позднюю отправку.

Что стерегут пробы:
  1) срок появляется САМ, без просьбы — за сутки до начала ОМ;
  2) штаб может назвать свой, и следующая правка раскладки его не сбрасывает
     (иначе решение штаба жило бы до первого сохранения соседней строки);
  3) неразбираемый срок — ошибка формы, а не молчаливое умолчание;
  4) «просрочено» считается на ЧТЕНИИ по текущему моменту;
  5) опоздание НЕ запрещает отправку, но записывается — таково решение по
     поведению после истечения (разбор в Personnel-Records/Decisions).
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_event import OpsSecurityEvent

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)
from .test_ops_forces_gathering import (  # noqa: F401
    event_on_demand,
    make_assignment_status_type,
    make_department,
)


def department_with_directorate(name="Департамент охраны"):
    """Департамент С УПРАВЛЕНИЕМ: без него оповещение отбивается 422
    («оповещать некого»), и до отправки списка проба не доходит вовсе."""
    department = make_department(name)
    Division.objects.create(
        name=f"{name} — управление",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    return department

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"
EVENT_DATE = "2027-06-01"


def split(manager, base, department, **row):  # noqa: F811
    return manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1, **row}]},
        format="json",
    )


def allocation_of(manager, base):  # noqa: F811
    return manager.get(base).json()["forceAllocation"][0]


def test_due_at_appears_without_being_asked(manager):  # noqa: F811
    """Срок «за сутки до ОМ» проставляется сам — правило, а не поле формы."""
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = make_department()

    row = split(manager, base, department).json()["forceAllocation"][0]

    assert row["dueAt"], "срок не проставлен — правило эталона не действует"
    due = dt.datetime.fromisoformat(row["dueAt"])
    # Времени у мероприятия фикстура не задаёт, поэтому началом считается
    # полночь: срок — предыдущие сутки, та же полночь.
    assert due.date() == dt.date(2027, 5, 31)
    assert (due.hour, due.minute) == (0, 0)


def test_the_staff_can_set_its_own_due_at(manager):  # noqa: F811
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = make_department()

    row = split(
        manager, base, department, dueAt="2027-05-20T18:30"
    ).json()["forceAllocation"][0]

    saved = dt.datetime.fromisoformat(row["dueAt"])
    assert (saved.date(), saved.hour, saved.minute) == (dt.date(2027, 5, 20), 18, 30)


def test_a_saved_due_at_survives_the_next_split(manager):  # noqa: F811
    """Правка раскладки НЕ пересчитывает срок обратно на умолчание.

    Без этого решение штаба жило бы до первого сохранения соседней строки, и
    «срок передвинули» превращалось бы в «срок вернулся» без единого действия.
    """
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = make_department()
    split(manager, base, department, dueAt="2027-05-20T18:30")

    # Второе сохранение — БЕЗ срока в теле, меняется только число людей.
    row = split(manager, base, department, need=2).json()["forceAllocation"][0]

    assert row["need"] == 2
    assert dt.datetime.fromisoformat(row["dueAt"]).day == 20


def test_an_unparsable_due_at_is_refused(manager):  # noqa: F811
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = make_department()

    resp = split(manager, base, department, dueAt="двадцатое мая")

    assert resp.status_code == 400
    assert "rows.0.dueAt" in resp.json()["details"]


def test_overdue_is_computed_from_the_current_moment(manager):  # noqa: F811
    """«Просрочено» — ответ про сейчас, а не записанный флаг."""
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = make_department()
    split(manager, base, department, dueAt="2027-05-20T18:30")

    with clock.override(dt.datetime(2027, 5, 20, 10, 0, tzinfo=dt.timezone.utc)):
        assert allocation_of(manager, base)["overdue"] is False
    with clock.override(dt.datetime(2027, 5, 21, 10, 0, tzinfo=dt.timezone.utc)):
        assert allocation_of(manager, base)["overdue"] is True


def test_late_submission_is_allowed_and_recorded(manager):  # noqa: F811
    """Опоздание не запрещает отправку — оно её помечает.

    Запрет означал бы, что опоздавший департамент вообще ничего не может
    сообщить, и штаб остаётся без людей И без сведений.
    """
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = department_with_directorate()
    split(manager, base, department, dueAt="2027-05-20T18:30")
    allocation_id = allocation_of(manager, base)["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    make_assignment_status_type()
    employee = make_employee("Сериков")
    added = manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content

    with clock.override(dt.datetime(2027, 5, 21, 10, 0, tzinfo=dt.timezone.utc)):
        resp = manager.post(f"{base}forces/allocation/{allocation_id}/submit/")

    assert resp.status_code == 200, resp.content
    row = allocation_of(manager, base)
    assert row["status"] == "SUBMITTED"
    assert row["submittedLate"] is True
    # Отправленная заявка просроченной больше не считается: список уже у штаба.
    assert row["overdue"] is False


def test_the_late_mark_survives_the_next_split(manager):  # noqa: F811
    """Пересохранение раскладки не стирает опоздание (найдено ревью).

    Строка раскладки пересобирается ЯВНЫМ перечнем ключей, и забытый ключ
    означает не «поле пустое», а «факт стёрт». Сценарий буквальный: департамент
    сдал с опозданием, штаб пересохранил раскладку ради чужого `need` — и
    пометка исчезала навсегда, вместе с единственным следом опоздания.
    """
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = department_with_directorate()
    split(manager, base, department, dueAt="2027-05-20T18:30")
    allocation_id = allocation_of(manager, base)["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    make_assignment_status_type()
    employee = make_employee("Сериков")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    with clock.override(dt.datetime(2027, 5, 21, 10, 0, tzinfo=dt.timezone.utc)):
        manager.post(f"{base}forces/allocation/{allocation_id}/submit/")
    assert allocation_of(manager, base)["submittedLate"] is True

    # Штаб пересохраняет раскладку, меняя ЧИСЛО, а не срок.
    split(manager, base, department, need=2)

    assert allocation_of(manager, base)["submittedLate"] is True, (
        "пометка опоздания стёрта пересохранением раскладки"
    )


def test_a_returned_allocation_is_not_overdue(manager):  # noqa: F811
    """Возвращённая штабом заявка не краснеет за срок (найдено ревью).

    Департамент мог сдать ВОВРЕМЯ, а штаб вернуть на доработку уже после
    срока. Без этой ветки строка обвиняла бы департамент в задержке, которой
    он не совершал, и добавляла +1 к счёту отстающих у сбора.
    """
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = department_with_directorate()
    split(manager, base, department, dueAt="2027-05-20T18:30")
    allocation_id = allocation_of(manager, base)["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    make_assignment_status_type()
    employee = make_employee("Сериков")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    with clock.override(dt.datetime(2027, 5, 19, 10, 0, tzinfo=dt.timezone.utc)):
        manager.post(f"{base}forces/allocation/{allocation_id}/submit/")
    returned = manager.post(
        f"{base}forces/allocation/{allocation_id}/return/",
        {"reason": "Не хватает двоих"},
        format="json",
    )
    assert returned.status_code in (200, 201), returned.content

    with clock.override(dt.datetime(2027, 5, 21, 10, 0, tzinfo=dt.timezone.utc)):
        row = allocation_of(manager, base)

    assert row["status"] == "RETURNED"
    assert row["overdue"] is False, (
        "возвращённая заявка помечена просроченной — департамент обвинён в "
        "задержке штаба"
    )


def test_a_timely_submission_is_not_marked_late(manager):  # noqa: F811
    """Парная проба: без неё «помечено опоздание» могло бы стоять у всех."""
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = department_with_directorate()
    split(manager, base, department, dueAt="2027-05-20T18:30")
    allocation_id = allocation_of(manager, base)["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    make_assignment_status_type()
    employee = make_employee("Сериков")
    manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(employee.pk)},
        format="json",
    )

    with clock.override(dt.datetime(2027, 5, 19, 10, 0, tzinfo=dt.timezone.utc)):
        assert manager.post(
            f"{base}forces/allocation/{allocation_id}/submit/"
        ).status_code == 200

    assert allocation_of(manager, base)["submittedLate"] is False


def test_a_declined_allocation_is_not_overdue(manager):  # noqa: F811
    """🔴 Plane №553: отказ закрывает запрос — краснеть ему нечем.

    «0 закрывает запрос» (`[СБС-21]`) — ОКОНЧАТЕЛЬНЫЙ ответ департамента:
    слать ему больше нечего и ждать от него нечего. А `allocation_is_overdue`
    освобождала только `SUBMITTED`/`ACCEPTED`/`RETURNED`, и после `dueAt`
    отказавшаяся строка вечно краснела «Просрочено» в таблице департамента и
    вечно прибавляла +1 к `overdueCount` штабу. Замысел «отказ закрывает
    запрос» отменялся счётчиком, который его не знал.

    Мутация: убрать `DECLINED` из `_ALLOCATION_NOT_OVERDUE` — проба
    покраснеет на `overdue is False`.
    """
    base, _total = event_on_demand(manager, business_date=EVENT_DATE)
    department = department_with_directorate()
    split(manager, base, department, dueAt="2027-05-20T18:30")
    allocation_id = allocation_of(manager, base)["id"]
    manager.post(f"{base}forces/allocation/{allocation_id}/notify/")

    # Контроль ДО ответа: та же строка в тот же момент ПРОСРОЧЕНА. Без него
    # проба не отличала бы «отказ освобождает» от «просрочка здесь не
    # считается вовсе».
    after_due = dt.datetime(2027, 5, 21, 10, 0, tzinfo=dt.timezone.utc)
    with clock.override(after_due):
        assert allocation_of(manager, base)["overdue"] is True

    declined = manager.post(
        f"{base}forces/allocation/{allocation_id}/respond/",
        {"allocating": 0, "comment": "Все на объекте"},
        format="json",
    )
    assert declined.status_code == 200, declined.content

    with clock.override(after_due):
        row = allocation_of(manager, base)

    assert row["status"] == "DECLINED"
    assert row["overdue"] is False, (
        "отказавшаяся заявка помечена просроченной — департамент ждут после "
        "того, как он дал окончательный ответ"
    )
