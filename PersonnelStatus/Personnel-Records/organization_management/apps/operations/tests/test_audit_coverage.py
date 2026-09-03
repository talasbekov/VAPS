"""Покрытие мутаций журналом: какое событие пишет какой сервис.

Механика журнала (словарь, часы, append-only) проверена в
test_audit_service.py; здесь — врезка. Проверяется ПРАВИЛО ПОКРЫТИЯ из
audit_service: событие на каждую записанную СТРОКУ, плюс своё событие у
операций над парой и сотрудником.

Отдельно проверяются два свойства, которые легко потерять незаметно:
запись живёт в транзакции мутации (откат уносит и её), а массовый путь
остаётся с постоянным числом запросов.
"""
import io
from datetime import date, timedelta

import pytest
from django.db import connection, transaction
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.block_override import (
    override_tomorrow_block,
)
from organization_management.apps.operations.bulk_status_service import (
    bulk_create_statuses,
)
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.document_release import (
    issue_expense_document,
    reissue_expense_document,
)
from organization_management.apps.operations.document_service import (
    create_attachment,
    prepare_download,
)
from organization_management.apps.operations.dismissal import (
    DISMISSAL_REASON,
    close_statuses_on_dismissal,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.secondment_service import (
    confirm_return,
    initiate_secondment,
    request_return,
)
from organization_management.apps.operations.personal_export_service import (
    export_submission,
)
from organization_management.apps.operations.summary_service import (
    assemble_summary,
    rebuild_summary,
)
from organization_management.apps.operations.status_service import (
    cancel_status,
    complete_status_early,
    create_status,
    extend_status,
    resolve_placeholder,
    update_status,
)
from organization_management.apps.operations.status_types import StatusType
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


def test_every_declared_action_is_actually_written(types, home, host, tmp_path):
    # Закрытый словарь работает в обе стороны: событие, которого никто не
    # пишет, — обещание фильтра, возвращающего пустоту. Ровно поэтому в этом
    # срезе из ACTIONS снят STATUSES_BULK_CREATED (сводки у пачки нет).
    #
    # Выводимое «в строю» справочник seed_types не содержит, а расходу оно
    # нужно как колонка. Заводится оно ДО СДАЧИ, а не перед выпуском, как
    # раньше: со схемы снимка 3 справочник в снимок замерзает, и порядок
    # «сдали, потом дополнили справочник» проверял бы уже запасной путь чтения,
    # а не тот, которым день читается на самом деле.
    StatusType.objects.get_or_create(
        code="IN_SERVICE",
        defaults={
            "name": "В строю",
            "priority": 999,
            "report_column_code": "IN_SERVICE",
        },
    )
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

    # Заглушка и её разрешение — ОДНО событие на две строки, поэтому она
    # заводится отдельно от прочих: чужая строка на тех же днях дала бы
    # пересечение и увела бы тест в конфликт вместо покрытия.
    StatusType.objects.create(
        code="PENDING",
        name="Уточняется",
        priority=500,
        report_column_code="PENDING",
        is_placeholder=True,
    )
    unclear = make_status(
        employee,
        code="PENDING",
        start=TODAY + timedelta(days=30),
        end=TODAY + timedelta(days=32),
    )
    with clock.override(TODAY):
        resolve_placeholder(
            unclear,
            resolved_type_code="DUTY",
            date_start=TODAY + timedelta(days=30),
            date_end=TODAY + timedelta(days=32),
            actor=ACTOR,
            reason="выяснено: был наряд",
        )

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
        submit_day(division_id=home.id, business_date=TODAY, actor=ACTOR)
        amend_day(
            division_id=home.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ошибка в наряде",
            sanction="замечание",
        )
        # Обход блокировки — единственное событие раздела со своей сущностью:
        # его ось — дата, а не подразделение и не строка статуса.
        override_tomorrow_block(
            business_date=TODAY + timedelta(days=1),
            actor=ACTOR,
            reason="решение руководителя",
        )
        # Сводка — та же сущность сдачи, но своё событие: «собрал из версий
        # детей» и «сдал свой день» отвечают на разные вопросы.
        parent = Division.objects.create(name="Управление-сводка")
        child = Division.objects.create(name="Отдел-сводка", parent=parent)
        submit_day(division_id=child.id, business_date=TODAY, actor=ACTOR)
        assemble_summary(
            division_id=parent.id, business_date=TODAY, actor=ACTOR
        )
        # Пересборка «взамен» — своё событие: поправляют СВОЙ день,
        # пересобирают ЧУЖИЕ версии.
        rebuild_summary(
            division_id=parent.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ребёнок исправил наряд",
            sanction="замечание",
        )
        # Выдача личной копии — событие ЧТЕНИЯ в журнале мутаций, и это
        # осознанное исключение: копию предъявляют в споре.
        export_submission(
            submission=OpsDailySubmission.objects.filter(
                division_id=child.id
            ).first(),
            actor=ACTOR,
        )
        # Запись байт официального документа — своя сущность журнала: строка о
        # файле переживает и выпуск, и его замену. Выпуск дня пишет ОБЕ строки
        # (байты и номер) и потому покрывает оба события разом; отдельная
        # запись вложения оставлена рядом как путь без выпуска.
        with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
            create_attachment(
                source=io.BytesIO(b"docx"),
                original_name="расход.docx",
                content_type="application/octet-stream",
                actor=ACTOR,
            )
            issue_expense_document(
                division_id=home.id, business_date=TODAY, actor=ACTOR
            )
            # Отзыв прежнего выпуска пишется на ЗАМЕНЯЕМЫЙ документ: тот, у кого
            # он на руках, ищет именно его ленту.
            reissued = reissue_expense_document(
                division_id=home.id,
                business_date=TODAY,
                actor=ACTOR,
                reason="исправлен наряд",
            )
            # Выдача байт — второе событие ЧТЕНИЯ в журнале мутаций: документ
            # берут, чтобы предъявлять, и «кто его получил» это предмет спора.
            prepare_download(attachment=reissued.attachment, actor=ACTOR)

    # Публикация версии паспорта — событие раздела объектов (срез A2):
    # пишется на УТВЕРЖДЕНИЕ документа, а не на правку черновика.
    from organization_management.apps.operations.models_object import (
        OpsObjectSector,
        OpsPassportFreshnessPolicy,
        OpsSecurityObject,
        OpsSecurityPost,
    )
    from organization_management.apps.ops.passport import publish_version

    OpsPassportFreshnessPolicy.objects.get_or_create(
        singleton_key=1,
        defaults={
            "version": "fp-v1",
            "verification_interval_days": 120,
            "due_soon_percent": 25,
        },
    )
    secured = OpsSecurityObject.objects.create(
        name="Резиденция",
        code="OBJ-AUDIT",
        object_type="Госучреждение",
        region="г. Астана",
        address="пр. Мәңгілік Ел, 8",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED,
    )
    sector = OpsObjectSector.objects.create(
        security_object=secured, name="Сектор 1", position=1
    )
    OpsSecurityPost.objects.create(sector=sector, name="Пост 1", position=1)
    publish_version(
        secured,
        effective_from=TODAY.isoformat(),
        note="покрытие журнала",
        actor=ACTOR,
    )

    # Охранное мероприятие: журнал пишут заведение и закрытие (стадии между
    # ними следа в журнале мутаций не оставляют — их след живёт в агрегате).
    from organization_management.apps.ops import security_events as event_service

    om = event_service.create_event(
        title="Покрытие журнала",
        object_id=str(secured.pk),
        business_date=TODAY.isoformat(),
        kind="INTERNAL",
        actor=ACTOR,
    )
    # ОМ с объектом заводится СРАЗУ на рекогносцировке (Plane «Реестр ОМ-5»),
    # завершать бюллетень нечего — своего шага у него нет. Сведения бюллетеня
    # при этом правятся на любой стадии, кроме закрытой.
    event_service.update_bulletin(
        om.pk, brief_description="покрытие", initial_tasks="покрытие"
    )
    # Перевод админом на произвольный этап и обратно: обход условий пишет свой
    # вид журнала. Возврат ОБЯЗАТЕЛЕН — иначе ОМ уехало бы с рекогносцировки, и
    # цепочка ниже пошла бы не с той стадии.
    event_service.override_stage(om.pk, stage="ACKNOWLEDGEMENT", actor=ACTOR)
    event_service.override_stage(om.pk, stage="RECON", actor=ACTOR)
    om.refresh_from_db()
    # Id строке расчёта выдаёт СЕРВЕР (Plane №30) — «row-1» это пометка
    # черновика клиента, в сохранённом расчёте её нет. Берём выданный.
    recon_post_id = event_service.update_recon(
        om.pk,
        checklist=[
            {**item, "done": True} for item in om.recon_checklist
        ],
        sector_posts=[
            {
                "id": "row-1",
                "sector": "Периметр",
                "post": "Пост 1",
                "task": "",
                "need": 1,
                "requirements": "",
                "result": None,
                "comment": "",
                "sourceSectorId": None,
                "sourcePostId": None,
                "minRating": None,
            }
        ],
        # Запрос личного состава — условие завершения рекогносцировки
        # (Plane «Реестр ОМ-23»): её итог адресуется штабу 2-го департамента.
        force_request=12,
    ).recon_sector_posts[0]["id"]
    event_service.complete_recon(om.pk)
    # Стадии «Потребность» и «Запрос сил» проходит сервер сам (Plane №110):
    # завершение рекогносцировки оставляет ОМ уже на «Расстановке», и ручное
    # утверждение потребности здесь отбилось бы «не на этом этапе».
    # Сбор сил (Plane №73): раскладка потребности по департаментам сама следа
    # не оставляет — это решение штаба внутри мероприятия, — а вот ОПОВЕЩЕНИЕ
    # управлений пишет журнал: с него начинается ответственность людей вне ОМ.
    coverage_department = Division.objects.create(
        name="Департамент покрытия", division_type="department"
    )
    coverage_directorate = Division.objects.create(
        name="Управление покрытия",
        division_type="directorate",
        parent=coverage_department,
    )
    om.refresh_from_db()
    allocation = event_service.split_force_demand(
        om.pk, rows=[{"departmentId": str(coverage_department.pk), "need": 1}]
    ).force_allocation[0]
    # Раскладка департамента по управлениям (Plane №272, Ш-1) — ДО оповещения:
    # после него квоты заперты, и вызов здесь отбился бы «уже запрошены».
    event_service.split_directorate_quotas(
        om.pk,
        allocation["id"],
        [{"divisionId": str(coverage_directorate.pk), "need": 1}],
        actor=ACTOR,
    )
    event_service.notify_directorates(om.pk, allocation["id"], actor=ACTOR)
    # Тип статуса привлечения — свой: выделение ставит именно его, и без
    # строки справочника оно отбивается раньше, чем дойдёт до журнала.
    StatusType.objects.get_or_create(
        code="EVENT_ASSIGNMENT",
        defaults={
            "name": "Привлечён на мероприятие",
            "priority": 80,
            "report_column_code": "IN_SERVICE",
        },
    )
    # Отправка списка штабу — второй след цепочки: с неё за людей отвечает
    # уже не департамент. Выделенный человек нужен и для неё (пустой список
    # отправить нельзя).
    from organization_management.apps.employees.models import Employee

    # Оба человека, которых ниже ставят на посты, попадают в состав ЧЕРЕЗ саму
    # цепочку: с шага «СС-6» расстановка берёт кандидатов из состава ОМ, и
    # посторонний на пост не встаёт (Plane №73). Замещающий заводится уже
    # здесь, хотя право править расстановку получит ниже: в состав он обязан
    # попасть до отправки списка штабу.
    roster_employee = employee_in(home)
    deputy_employee = Employee.objects.create(
        personnel_number="P-DEP",
        last_name="Замещающий",
        first_name="Пётр",
        birth_date="1990-01-01",
        gender="M",
        iin="940000009999",
        hire_date="2015-01-01",
        employment_status="working",
    )
    for member in (roster_employee, deputy_employee):
        event_service.add_allocation_member(
            om.pk,
            allocation["id"],
            employee_id=member.pk,
            actor=ACTOR,
        )
    event_service.submit_allocation(om.pk, allocation["id"], actor=ACTOR)
    # Решение штаба — два разных акта, и оба спрашиваются потом поимённо:
    # возврат с причиной, затем повторная отправка и приёмка.
    event_service.return_allocation(
        om.pk, allocation["id"], reason="Нужны люди с допуском", actor=ACTOR
    )
    event_service.submit_allocation(om.pk, allocation["id"], actor=ACTOR)
    event_service.accept_allocation(om.pk, allocation["id"], actor=ACTOR)

    om.refresh_from_db()
    # Числа автозаявки сводит с составом сам сервер (`_sync_auto_force_request`),
    # а «завершить выделение» больше некому нажать: ОМ уже на «Расстановке».
    event_service.assign_placement(
        om.pk,
        post_id=recon_post_id,
        employee_id=str(roster_employee.pk),
        override=None,
        override_reason=None,
    )
    # Замещающие на объекте посещения: выдача и отзыв права — решения,
    # раздающие ВОЗМОЖНОСТЬ править чужую расстановку, и они именные. Плюс
    # сама операция расстановки, сделанная замещающим: она пишет журнал
    # только в этом случае — обычная расстановка следа не оставляет.
    visit = om.visit_objects.first()
    event_service.add_visit_object_deputy(
        om.pk,
        visit.pk,
        employee_id=str(deputy_employee.pk),
        can_edit_placement=True,
        actor=ACTOR,
    )
    om.refresh_from_db()
    event_service.assign_placement(
        om.pk,
        post_id=om.recon_sector_posts[0]["id"],
        employee_id=str(deputy_employee.pk),
        override=None,
        override_reason=None,
        deputy=deputy_employee,
    )
    om.refresh_from_db()
    # Старший сектора — именное назначение ответственного (Plane №65, «Р-4»):
    # действие ОДНО на назначение и снятие, поэтому и запись здесь одна.
    event_service.set_sector_senior(
        om.pk, om.placement_assignments[-1]["id"], senior=True, actor=ACTOR
    )
    om.refresh_from_db()
    event_service.unassign_placement(
        om.pk, om.placement_assignments[-1]["id"], deputy=deputy_employee
    )
    deputy_row = visit.deputies.get()
    event_service.remove_visit_object_deputy(
        om.pk, visit.pk, deputy_row.pk, actor=ACTOR
    )

    # Старший объекта посещения: назначение и снятие — именные решения, по
    # которым спрашивают доклад и расстановку объекта (Plane «Реестр ОМ-35.2»).
    event_service.assign_visit_object_chief(
        om.pk, visit.pk, employee_id=str(deputy_employee.pk), actor=ACTOR
    )
    event_service.remove_visit_object_chief(om.pk, visit.pk, actor=ACTOR)

    # Старший НАРЯДА мероприятия (Plane №190) — отдельное действие от старшего
    # объекта: разные люди с разной ответственностью. Одна ручка на три
    # случая, и все три должны оставлять след, поэтому здесь и назначение, и
    # замена, и снятие.
    event_service.set_event_chief(
        om.pk, employee_id=str(deputy_employee.pk), actor=ACTOR
    )
    event_service.set_event_chief(
        om.pk, employee_id=str(roster_employee.pk), actor=ACTOR
    )
    event_service.set_event_chief(om.pk, employee_id="", actor=ACTOR)

    # Правка СВЕДЕНИЙ бюллетеня (Plane №192): по этим полям сверяют уже
    # выгруженный документ, и «когда поменяли и кто» обязано иметь ответ.
    event_service.update_bulletin_details(
        om.pk, title="Название после правки", actor=ACTOR
    )

    event_service.complete_placement(om.pk)
    # Согласование по эталону («ОМ-37.3») требует маршрута, отправки и решения:
    # завершить этап «просто так» больше нельзя.
    om.refresh_from_db()
    event_service.add_approver(
        om.pk, name="К. Оразов", unit="Департамент охраны", position="Зам."
    )
    om.refresh_from_db()
    # МАРШРУТ СОГЛАСОВАНИЯ ЖИВЁТ У ОБЪЕКТА ПОСЕЩЕНИЯ (Plane №411, Ш-5 плана
    # №385): согласуют объект и его документ «Расстановка сил», а не
    # мероприятие целиком. Столбец `om.approval_route` мутации больше не
    # пишут — он остался под старых читателей и снимается в Ш-7 (№413),
    # поэтому проба спрашивает там, где теперь ответ.
    approver_id = om.visit_objects.order_by("position", "pk").first(
    ).approval_route[0]["id"]
    event_service.send_for_approval(om.pk)
    event_service.decide_approver(
        om.pk, approver_id=approver_id, decision="APPROVED", comment=""
    )
    event_service.approve_placement(om.pk)
    om.refresh_from_db()
    event_service.acknowledge_assignment(
        om.pk, om.placement_assignments[0]["id"]
    )
    event_service.complete_acknowledgement(om.pk)
    event_service.close_event(
        om.pk,
        direction_summaries=[
            {"direction": "Периметр", "summary": "Без происшествий."}
        ],
        actor=ACTOR,
    )

    # Смены дежурств: журнал пишут заведение и отмена (исполнение — штампы
    # на самой смене).
    from organization_management.apps.operations.models_duty import (
        OpsDutyConflictPolicy,
        OpsDutyType,
    )
    from organization_management.apps.ops import duties as duty_service

    OpsDutyType.objects.get_or_create(
        duty_type_code="DAY_OWN",
        defaults={
            "safe_label": "Дежурство по управлению",
            "target_type": "OWN_OBJECT",
            "default_duration_minutes": 1440,
            "requires_senior": False,
            "rest_after_minutes": 0,
            "requires_current_passport": False,
        },
    )
    OpsDutyConflictPolicy.objects.get_or_create(
        singleton_key=1,
        defaults={"version": "cp-v1", "rest_after_duty_mode": "SOFT_OVERRIDE"},
    )
    duty_employee = employee_in(home)
    shift = duty_service.create_shift(
        business_date=(TODAY + timedelta(days=40)).isoformat(),
        duty_type_code="DAY_OWN",
        object_id=str(secured.pk),
        sector_id=None,
        post_id=None,
        employee_id=str(duty_employee.pk),
        note=None,
        override=None,
        override_reason=None,
        actor=ACTOR,
    )
    duty_service.cancel_shift(shift.pk, reason="приказ отменён", actor=ACTOR)

    # Настройки и справочники: правка правила и админ-операции значений.
    from organization_management.apps.operations.models_settings import (
        OpsPolicySetting,
    )
    from organization_management.apps.ops import dictionaries as dict_service
    from organization_management.apps.ops import settings_service

    OpsPolicySetting.objects.get_or_create(
        setting_code="passport.due_soon_percent",
        defaults={
            "section_code": "PASSPORT_FRESHNESS", "kind": "NUMBER",
            "value_type": "PERCENT", "safe_label": "Порог «скоро проверка»",
            "description": "", "value": 25, "min_value": 5, "max_value": 50,
            "options": None, "editable": True, "locked_reason": None,
        },
    )
    settings_service.update_setting(
        "passport.due_soon_percent", value=30,
        reason="покрытие журнала", actor=ACTOR,
    )
    dict_entry = dict_service.create_entry(
        "RETURN_REASONS", code="COVERAGE", label="Покрытие журнала",
        description="", group_code=None, actor=ACTOR,
    )
    dict_service.set_entry_active(
        dict_entry.pk, is_active=False, actor=ACTOR
    )
    # Правка значения — своё событие (Plane №274): «завели» и «переименовали»
    # отвечают на разные вопросы, и фильтр журнала обязан их различать.
    dict_service.update_entry(
        dict_entry.pk, label="Покрытие журнала (правка)", description="",
        group_code=None, actor=ACTOR,
    )
    tracked = dict_service.create_entry(
        "POST_REQUIREMENT_GROUPS", code="COVERAGE_GROUP",
        label="Группа покрытия", description="", group_code=None, actor=ACTOR,
    )
    dict_service.delete_entry(tracked.pk, actor=ACTOR)

    # Удаление ОМ: строка исчезает целиком, и журнал остаётся её единственным
    # следом. Удаляется ОТДЕЛЬНОЕ мероприятие — то, по которому шла цепочка
    # выше, к этому моменту закрыто, а закрытое сервис не отдаёт (и правильно
    # делает: это история).
    doomed = event_service.create_event(
        title="Заведено по ошибке",
        object_id=str(secured.pk),
        business_date=TODAY.isoformat(),
        kind="INTERNAL",
        actor=ACTOR,
    )
    event_service.delete_event(doomed.pk, actor=ACTOR)

    # Завершение расстановки с НЕДОБОРОМ (`[РАС-06]`, Plane №396) — решение
    # человека обойти проверку укомплектованности, именное и с комментарием.
    # Отдельное мероприятие с ОДНИМ незанятым постом: `om` выше уже полностью
    # укомплектован и довёден до закрытия, портить его недобором незачем.
    shortage_event = event_service.create_event(
        title="Проба недобора расстановки",
        object_id=str(secured.pk),
        business_date=TODAY.isoformat(),
        kind="INTERNAL",
        actor=ACTOR,
    )
    shortage_event.refresh_from_db()
    from organization_management.apps.ops import security_events as _svc

    _svc.import_recon_from_passport(shortage_event.pk)
    shortage_event.refresh_from_db()
    for item in shortage_event.recon_checklist:
        item["done"] = True
        item["result"] = "MATCHES"
    _svc.update_recon(
        shortage_event.pk,
        checklist=shortage_event.recon_checklist,
        sector_posts=shortage_event.recon_sector_posts,
    )
    _svc.complete_recon(shortage_event.pk)
    with pytest.raises(DomainError) as blocked:
        event_service.complete_placement(shortage_event.pk, actor=ACTOR)
    assert blocked.value.code == "PLACEMENT_UNDERSTAFFED"
    event_service.complete_placement(
        shortage_event.pk,
        override=True,
        override_reason="Второй кандидат заболел, замену найдём к выезду.",
        actor=ACTOR,
    )

    # ГВО: ручная правка сводки и её сброс — оба пишут журнал (сводные
    # данные уходят в бумагу); база сводки — производная бюллетеня, следа
    # не оставляет.
    from organization_management.apps.ops import gvo as gvo_service

    gvo_service.apply_patch(
        om.code,
        {"section": "head", "values": {"country": "Покрытие"}},
        None,
        actor=ACTOR,
    )
    gvo_service.reset_patch(om.code, {"section": "head"}, actor=ACTOR)

    # Справочник прав (Plane №36, «П-2»): заведение и правка — одно действие,
    # поэтому и запись здесь одна.
    from organization_management.apps.operations.services import RoleAdminService

    RoleAdminService.save_permission(
        "coverage.permission",
        name="Право покрытия журнала",
        description="",
        is_active=True,
        actor=ACTOR,
    )

    # Справочник ролей (Plane №36, «П-3»): имя роли и её состав — ДВА
    # действия, и записей здесь тоже две.
    RoleAdminService.save_role(
        "COVERAGE_ROLE",
        name="Роль покрытия журнала",
        description="",
        is_active=True,
        actor=ACTOR,
    )
    RoleAdminService.change_role_permissions(
        "COVERAGE_ROLE", add=["coverage.permission"], actor=ACTOR
    )

    # Учётные записи (Plane №36, «П-5»): заведение/правка и сброс пароля.
    from organization_management.apps.operations.services import AccountAdminService

    coverage_account, _ = AccountAdminService.create_account(
        username="coverage-account", actor=ACTOR
    )
    AccountAdminService.reset_password(coverage_account, actor=ACTOR)

    # Своя смена пароля (Plane №180) — СВОЁ действие, не сброс: администратор
    # сбрасывает чужой пароль и отдаёт временный, человек меняет собственный,
    # подтвердив текущий. По ленте эти два случая и различают.
    from organization_management.apps.operations.services import AccountSelfService

    AccountSelfService.change_password(
        coverage_account,
        new_password="Тжр7-каспий-берег",
        actor=str(coverage_account.pk),
    )

    # Раздача ролей ЧЕЛОВЕКУ (Plane №107): выдача и снятие — два действия, и
    # записей здесь тоже две. Именно они отвечают на вопрос «кто дал ему это
    # право», и до 26.08.2026 их не было в журнале вовсе.
    RoleAdminService.assign_role(
        str(coverage_account.pk), "COVERAGE_ROLE", actor=ACTOR
    )
    RoleAdminService.revoke_role(
        str(coverage_account.pk), "COVERAGE_ROLE", actor=ACTOR
    )

    # Уборка участий, переживших своё мероприятие (Plane №356). Событие
    # пишется по тому же основанию, что и удаление ОМ: строки исчезают
    # ЦЕЛИКОМ, и журнал остаётся единственным следом того, что они были. До
    # №356 уборка не писала ничего, и пропажу 1135 строк на стенде не удалось
    # приписать ни одному прогону.
    from organization_management.apps.operations.models_status import (
        OpsStatusParticipation,
    )
    from organization_management.apps.operations.status_cleanup import (
        purge_orphan_participations,
    )

    OpsStatusParticipation.objects.create(
        status=covering,
        # Мероприятия с таким идентификатором не существует — это и есть
        # сирота, ради которой уборка и заведена.
        event_id=987_654_321,
        kind_code="PHYSICAL_SQUAD",
    )
    purge_orphan_participations(actor=ACTOR)

    written = {entry.action for entry in events()}
    assert written == audit_service.ACTIONS
