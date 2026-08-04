"""Покрытие мутаций журналом: какое событие пишет какой сервис.

Механика журнала (словарь, часы, append-only) проверена в
test_audit_service.py; здесь — врезка. Проверяется ПРАВИЛО ПОКРЫТИЯ из
audit_service: событие на каждую записанную СТРОКУ, плюс своё событие у
операций над парой и сотрудником.

Отдельно проверяются два свойства, которые легко потерять незаметно:
запись живёт в транзакции мутации (откат уносит и её), а массовый путь
остаётся с постоянным числом запросов.
"""
from datetime import date, timedelta

import pytest
from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.bulk_status_service import (
    bulk_create_statuses,
)
from organization_management.apps.operations.dismissal import (
    DISMISSAL_REASON,
    close_statuses_on_dismissal,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.secondment_service import (
    confirm_return,
    initiate_secondment,
    request_return,
)
from organization_management.apps.operations.status_service import (
    cancel_status,
    complete_status_early,
    create_status,
    extend_status,
    update_status,
)
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def home():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def host():
    return Division.objects.create(name="Управление 2")


def employee_in(division=None):
    employee = make_employee()
    if division is not None:
        StaffUnit.objects.create(
            division=division, employee=employee, index=employee.id
        )
    return employee


def make_status(employee, code="DUTY", start=None, end=None, **extra):
    kwargs = {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": TODAY if start is None else start,
        "date_end": TODAY + timedelta(days=5) if end is None else end,
        "actor": ACTOR,
    }
    kwargs.update(extra)
    with clock.override(TODAY):
        return create_status(**kwargs)


def watermark():
    """Отметка «до этого места журнал уже был».

    Подготовка теста (создать статус, откомандировать) сама пишет события, и
    отделять их приходится отметкой, а НЕ очисткой таблицы: журнал
    append-only на уровне БД, и DELETE в тесте отвергает триггер. Свойство
    приятное — изоляция проб не может втихую опереться на удаление.
    """
    last = OpsAuditLog.objects.order_by("-pk").values_list("pk", flat=True).first()
    return last or 0


def events(since=0, action=None, entity_type=None, entity_id=None):
    """Строки журнала ИЗ БД, записанные после отметки, в порядке записи."""
    query = OpsAuditLog.objects.filter(pk__gt=since).order_by("pk")
    if action is not None:
        query = query.filter(action=action)
    if entity_type is not None:
        query = query.filter(entity_type=entity_type)
    if entity_id is not None:
        query = query.filter(entity_id=entity_id)
    return list(query)


def only_event(**filters):
    found = events(**filters)
    assert len(found) == 1, f"ожидалось одно событие, найдено {len(found)}"
    return found[0]


# ── Одиночные мутации статуса ────────────────────────────────────────────

class TestStatusMutations:
    def test_create_writes_created_event(self, types):
        employee = employee_in()
        status = make_status(employee)

        entry = only_event()
        assert entry.action == audit_service.STATUS_CREATED
        assert entry.entity_type == audit_service.ENTITY_STATUS
        assert entry.entity_id == status.pk
        assert entry.actor_user_id == ACTOR
        # У создания нет «до», а «после» — снимок записанной строки.
        assert entry.old_value is None
        assert entry.new_value["status_id"] == status.pk
        assert entry.new_value["status_type_code"] == "DUTY"
        assert entry.new_value["date_end"] == str(status.date_end)

    def test_override_reason_reaches_the_event(self, types):
        # Причина обхода — единственный след того, почему пересечение сочли
        # допустимым; в журнале она обязана быть, а не только в StatusOverride.
        employee = employee_in()
        make_status(employee, code="STUDY")
        make_status(
            employee,
            code="DUTY",
            override=True,
            override_reason="приказ №5",
        )
        created = events(action=audit_service.STATUS_CREATED)
        assert len(created) == 2
        assert created[0].reason == ""
        assert created[1].reason == "приказ №5"

    def test_update_writes_before_and_after(self, types):
        employee = employee_in()
        status = make_status(employee, comment="было")
        mark = watermark()

        with clock.override(TODAY):
            update_status(status, actor="9", comment="стало")

        entry = only_event(since=mark)
        assert entry.action == audit_service.STATUS_UPDATED
        assert entry.entity_id == status.pk
        assert entry.actor_user_id == "9"
        # Снимок «до» снят ДО мутации — иначе обе половины были бы одинаковы.
        assert entry.old_value["comment"] == "было"
        assert entry.new_value["comment"] == "стало"

    def test_update_without_changes_writes_nothing(self, types):
        # Журнал рассказывает о случившемся: у PATCH без полей «до» и «после»
        # совпадают, и событие было бы записью ни о чём.
        employee = employee_in()
        status = make_status(employee)
        mark = watermark()

        with clock.override(TODAY):
            update_status(status, actor=ACTOR)

        assert events(since=mark) == []

    def test_complete_early_writes_completed_event(self, types):
        employee = employee_in()
        status = make_status(
            employee, start=TODAY - timedelta(days=3), end=TODAY + timedelta(days=5)
        )
        mark = watermark()

        with clock.override(TODAY):
            complete_status_early(status, actor=ACTOR, actual_end=TODAY)

        entry = only_event(since=mark)
        assert entry.action == audit_service.STATUS_COMPLETED
        assert entry.entity_id == status.pk
        assert entry.old_value["date_end"] == str(TODAY + timedelta(days=5))
        assert entry.new_value["date_end"] == str(TODAY)

    def test_cancel_writes_cancelled_event_with_reason(self, types):
        employee = employee_in()
        status = make_status(
            employee, start=TODAY + timedelta(days=2), end=TODAY + timedelta(days=4)
        )
        mark = watermark()

        with clock.override(TODAY):
            cancel_status(status, actor=ACTOR, reason="приказ отменён")

        entry = only_event(since=mark)
        assert entry.action == audit_service.STATUS_CANCELLED
        assert entry.entity_id == status.pk
        assert entry.reason == "приказ отменён"
        assert entry.old_value["cancelled_at"] is None
        assert entry.new_value["cancelled_at"] is not None
        assert entry.new_value["cancelled_reason"] == "приказ отменён"

    def test_extend_writes_extended_event(self, types):
        # У продления СВОЁ событие, а не STATUS_UPDATED: в ленте строки
        # «продлили до» и «поправили даты» — разные истории.
        employee = employee_in()
        status = make_status(employee, end=TODAY + timedelta(days=5))
        mark = watermark()

        with clock.override(TODAY):
            extend_status(status, actor="9", new_date_end=TODAY + timedelta(days=9))

        entry = only_event(since=mark)
        assert entry.action == audit_service.STATUS_EXTENDED
        assert entry.entity_type == audit_service.ENTITY_STATUS
        assert entry.entity_id == status.pk
        assert entry.actor_user_id == "9"
        assert entry.old_value["date_end"] == str(TODAY + timedelta(days=5))
        assert entry.new_value["date_end"] == str(TODAY + timedelta(days=9))

    def test_extend_override_reason_reaches_the_event(self, types):
        # Как и у создания: причина обхода обязана быть в журнале, а не
        # только в StatusOverride — лента строки читается отдельно.
        employee = employee_in()
        status = make_status(
            employee, start=TODAY - timedelta(days=2), end=TODAY - timedelta(days=1)
        )
        make_status(employee, code="STUDY", start=TODAY, end=TODAY + timedelta(days=4))
        mark = watermark()

        with clock.override(TODAY):
            extend_status(
                status,
                actor=ACTOR,
                new_date_end=TODAY + timedelta(days=2),
                override=True,
                override_reason="приказ №7",
            )

        entry = only_event(since=mark)
        assert entry.action == audit_service.STATUS_EXTENDED
        assert entry.reason == "приказ №7"


# ── Массовое обновление ──────────────────────────────────────────────────

class TestBulkCreate:
    def bulk(self, employees, division, code="DUTY"):
        rows = [
            {
                "employee_id": employee.id,
                "status_type_code": code,
                "date_start": TODAY,
                "date_end": TODAY + timedelta(days=3),
            }
            for employee in employees
        ]
        with clock.override(TODAY):
            return bulk_create_statuses(
                rows,
                actor=ACTOR,
                business_date=TODAY,
                allowed_division_ids={division.id},
            )

    def test_every_created_row_gets_its_own_event(self, types, home):
        # Лента статуса ищется по entity_id: у созданного пачкой она обязана
        # отвечать так же, как у созданного поштучно. Сводки на пачку нет.
        employees = [employee_in(home) for _ in range(3)]
        created = self.bulk(employees, home)

        entries = events()
        assert len(entries) == 3
        assert {e.action for e in entries} == {audit_service.STATUS_CREATED}
        assert {e.entity_id for e in entries} == {row.pk for row in created}
        assert {e.actor_user_id for e in entries} == {ACTOR}

    def test_batch_time_comes_from_the_section_clock(self, types, home):
        # Время пачки — из часов РАЗДЕЛА, не из timezone.now(). Сравнивается
        # ЗАМОРОЖЕННЫЙ момент целиком, а не .date(): локальная полночь в
        # плюсовой зоне это предыдущий день по UTC, и ассерт по дате зеленел
        # бы в UTC и краснел на машине в +05.
        employees = [employee_in(home) for _ in range(3)]
        with clock.override(TODAY):
            frozen = clock.Clock.now()
        self.bulk(employees, home)

        assert {e.created_at for e in events()} == {frozen}

    def test_batch_shares_one_moment(self, types, home):
        # Единственное, чем строки пачки отличимы от N независимых записей, —
        # общий момент, поэтому record_many берёт его ОДНАЖДЫ.
        #
        # Часы здесь НЕ заморожены намеренно: под override() Clock.now()
        # возвращает один и тот же момент на каждый вызов, и проба зеленела бы
        # даже при построчной отметке — то есть не проверяла бы ничего
        # (проверено красной пробой). Живые часы тикают, и построчный вызов
        # разъезжается уже на микросекундах. Даты берутся от ЖИВОГО «сегодня»,
        # а не от TODAY: иначе проба зависела бы от даты машины.
        employees = [employee_in(home) for _ in range(3)]
        today = clock.Clock.today_local()
        rows = [
            {
                "employee_id": employee.id,
                "status_type_code": "DUTY",
                "date_start": today,
                "date_end": today + timedelta(days=3),
            }
            for employee in employees
        ]
        bulk_create_statuses(
            rows,
            actor=ACTOR,
            business_date=today,
            allowed_division_ids={home.id},
        )

        moments = {e.created_at for e in events()}
        assert len(moments) == 1, f"пачка легла {len(moments)} разными временами"

    def test_journal_costs_one_query_regardless_of_size(self, types, home):
        # Постоянное число запросов — несущее свойство этого пути (донор умер
        # от запроса в цикле). Журнал не имеет права его сломать, поэтому
        # сравниваются ДВА размера пачки: разница обязана быть нулевой.
        small = [employee_in(home)]
        large = [employee_in(home) for _ in range(4)]

        with CaptureQueriesContext(connection) as small_ctx:
            self.bulk(small, home)
        with CaptureQueriesContext(connection) as large_ctx:
            self.bulk(large, home, code="STUDY")

        assert len(small_ctx) == len(large_ctx), (
            f"пачка из 1 строки: {len(small_ctx)} запросов, "
            f"из 4: {len(large_ctx)} — число запросов поехало за размером"
        )


# ── Прикомандирование ────────────────────────────────────────────────────

class TestSecondment:
    def initiate(self, employee, host, start=None, end=None):
        with clock.override(TODAY):
            return initiate_secondment(
                employee.id,
                to_division_id=host.id,
                date_start=TODAY if start is None else start,
                date_end=TODAY + timedelta(days=10) if end is None else end,
                actor=ACTOR,
            )

    def test_initiate_writes_both_legs_and_the_pair(self, types, home, host):
        employee = employee_in(home)
        secondment = self.initiate(employee, host)

        legs = events(action=audit_service.STATUS_CREATED)
        assert {e.entity_id for e in legs} == {
            secondment.out_status_id,
            secondment.in_status_id,
        }
        pair = only_event(action=audit_service.SECONDMENT_INITIATED)
        assert pair.entity_type == audit_service.ENTITY_SECONDMENT
        assert pair.entity_id == secondment.pk
        assert pair.new_value["from_division_id"] == home.id
        assert pair.new_value["to_division_id"] == host.id

    def test_request_return_writes_its_event(self, types, home, host):
        employee = employee_in(home)
        secondment = self.initiate(employee, host)
        mark = watermark()

        with clock.override(TODAY):
            request_return(secondment, actor="9")

        entry = only_event(since=mark)
        assert entry.action == audit_service.SECONDMENT_RETURN_REQUESTED
        assert entry.entity_id == secondment.pk
        assert entry.old_value["return_requested_at"] is None
        assert entry.new_value["return_requested_at"] is not None
        assert entry.new_value["return_requested_by"] == "9"

    def test_confirm_return_closes_legs_and_pair_in_the_journal(
        self, types, home, host
    ):
        # Идущие ноги закрываются завтрашним днём — это конец их действия,
        # то есть STATUS_COMPLETED, а не правка.
        employee = employee_in(home)
        secondment = self.initiate(
            employee, host, start=TODAY - timedelta(days=1)
        )
        with clock.override(TODAY):
            request_return(secondment, actor=ACTOR)
        mark = watermark()

        with clock.override(TODAY):
            confirm_return(secondment, actor=ACTOR)

        completed = events(since=mark, action=audit_service.STATUS_COMPLETED)
        assert {e.entity_id for e in completed} == {
            secondment.out_status_id,
            secondment.in_status_id,
        }
        for entry in completed:
            assert entry.new_value["date_end"] == str(TODAY + timedelta(days=1))
        pair = only_event(since=mark, action=audit_service.SECONDMENT_RETURNED)
        assert pair.entity_id == secondment.pk
        assert pair.new_value["return_confirmed_at"] is not None

    def test_confirm_return_of_planned_legs_writes_cancellations(
        self, types, home, host
    ):
        # Не начавшаяся нога отменяется — событие пишет cancel_status, и оно
        # обязано быть: иначе у отменённой ноги лента пуста.
        employee = employee_in(home)
        secondment = self.initiate(
            employee,
            host,
            start=TODAY + timedelta(days=2),
            end=TODAY + timedelta(days=6),
        )
        with clock.override(TODAY):
            request_return(secondment, actor=ACTOR)
        mark = watermark()

        with clock.override(TODAY):
            confirm_return(secondment, actor=ACTOR)

        cancelled = events(since=mark, action=audit_service.STATUS_CANCELLED)
        assert {e.entity_id for e in cancelled} == {
            secondment.out_status_id,
            secondment.in_status_id,
        }
        assert events(since=mark, action=audit_service.SECONDMENT_RETURNED)


# ── Увольнение ───────────────────────────────────────────────────────────

class TestDismissal:
    def test_each_closed_row_and_the_employee_are_logged(self, types, home, host):
        employee = employee_in(home)
        # Накрывающий дату статус (усечётся) и ещё не начавшийся (отменится).
        covering = make_status(
            employee,
            code="STUDY",
            start=TODAY - timedelta(days=3),
            end=TODAY + timedelta(days=5),
        )
        planned = make_status(
            employee,
            code="DUTY",
            start=TODAY + timedelta(days=10),
            end=TODAY + timedelta(days=12),
        )
        mark = watermark()

        with clock.override(TODAY):
            summary = close_statuses_on_dismissal(
                employee.id, dismissal_date=TODAY, actor="system:dismissal"
            )

        truncated = only_event(since=mark, action=audit_service.STATUS_UPDATED)
        assert truncated.entity_id == covering.pk
        assert truncated.reason == DISMISSAL_REASON
        assert truncated.new_value["date_end"] == str(TODAY)

        cancelled = only_event(since=mark, action=audit_service.STATUS_CANCELLED)
        assert cancelled.entity_id == planned.pk
        assert cancelled.reason == DISMISSAL_REASON

        dismissed = only_event(since=mark, action=audit_service.EMPLOYEE_DISMISSED)
        assert dismissed.entity_type == audit_service.ENTITY_EMPLOYEE
        assert dismissed.entity_id == employee.id
        assert dismissed.actor_user_id == "system:dismissal"
        assert dismissed.new_value == {"dismissal_date": str(TODAY), **summary}

    def test_open_pair_is_closed_in_the_journal(self, types, home, host):
        employee = employee_in(home)
        with clock.override(TODAY):
            secondment = initiate_secondment(
                employee.id,
                to_division_id=host.id,
                date_start=TODAY - timedelta(days=1),
                date_end=TODAY + timedelta(days=10),
                actor=ACTOR,
            )
        mark = watermark()

        with clock.override(TODAY):
            close_statuses_on_dismissal(
                employee.id, dismissal_date=TODAY, actor="system:dismissal"
            )

        pair = only_event(since=mark, action=audit_service.SECONDMENT_RETURNED)
        assert pair.entity_id == secondment.pk
        # Отличие от живого возврата — в причине, а не в коде события.
        assert pair.reason == DISMISSAL_REASON
        assert pair.new_value["return_confirmed_by"] == "system:dismissal"

    def test_dismissal_with_nothing_to_close_is_still_logged(self, types, home):
        # «Закрывать было нечего» — тоже факт: без этой строки молчание
        # журнала не отличить от неотработавшей врезки.
        employee = employee_in(home)

        with clock.override(TODAY):
            close_statuses_on_dismissal(
                employee.id, dismissal_date=TODAY, actor="system:dismissal"
            )

        entry = only_event()
        assert entry.action == audit_service.EMPLOYEE_DISMISSED
        assert entry.new_value["truncated"] == 0
        assert entry.new_value["cancelled"] == 0
        assert entry.new_value["secondments_closed"] == 0


# ── Свойства врезки ──────────────────────────────────────────────────────

def test_journal_row_is_written_synchronously_and_rolls_back(types):
    """Запись СИНХРОННА и живёт в транзакции мутации.

    Обе половины нужны, и вторая без первой почти ничего не стоит: под
    django_db весь тест и так идёт в транзакции, поэтому «после отката строки
    нет» зеленеет и у записи ОТЛОЖЕННОЙ (on_commit под django_db не
    выполняется вовсе — строки не будет ни при каком исходе). Красным этот
    тест делает первая половина: событие обязано быть видно ДО коммита, в той
    же транзакции, сразу после мутации.

    Чего этот тест НЕ пиннит: расположение вызова внутри savepoint'а самого
    create_status. Внешний atomic теста откатывает всё разом, и вынос вызова
    за savepoint остаётся зелёным (проверено красной пробой) — там правилен
    автокоммит-сценарий, которого под django_db не бывает.
    """
    employee = employee_in()
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            status = make_status(employee)
            # Синхронность: строка уже здесь, до всякого коммита.
            assert events(entity_id=status.pk) != []
            raise RuntimeError("вызывающий передумал")

    assert not OpsEmployeeStatus.objects.filter(employee_id=employee.id).exists()
    assert events() == []


def test_every_declared_action_is_actually_written(types, home, host):
    # Закрытый словарь работает в обе стороны: событие, которого никто не
    # пишет, — обещание фильтра, возвращающего пустоту. Ровно поэтому в этом
    # срезе из ACTIONS снят STATUSES_BULK_CREATED (сводки у пачки нет).
    employee = employee_in(home)
    covering = make_status(
        employee,
        code="STUDY",
        start=TODAY - timedelta(days=3),
        end=TODAY + timedelta(days=5),
    )
    with clock.override(TODAY):
        update_status(covering, actor=ACTOR, comment="уточнение")
        extend_status(covering, actor=ACTOR, new_date_end=TODAY + timedelta(days=7))
        complete_status_early(covering, actor=ACTOR, actual_end=TODAY)

    planned = make_status(
        employee,
        code="DUTY",
        start=TODAY + timedelta(days=20),
        end=TODAY + timedelta(days=22),
    )
    with clock.override(TODAY):
        cancel_status(planned, actor=ACTOR, reason="приказ отменён")
        secondment = initiate_secondment(
            employee.id,
            to_division_id=host.id,
            date_start=TODAY + timedelta(days=1),
            date_end=TODAY + timedelta(days=8),
            actor=ACTOR,
        )
        request_return(secondment, actor=ACTOR)
        confirm_return(secondment, actor=ACTOR)
        close_statuses_on_dismissal(
            employee.id, dismissal_date=TODAY, actor="system:dismissal"
        )

    written = {entry.action for entry in events()}
    assert written == audit_service.ACTIONS
