"""Story 5.10 — property: иммутабельность снапшота сдачи (ARCH-DATA-021).

Инвариант держится на двух китах, и тесты пинят ОБА байтовыми ассертами в
канонической форме ``json.dumps(x, sort_keys=True, ensure_ascii=False)`` (Д3):

1. Хранение: ни один сервис не переписывает ``DailySubmission.snapshot``
   существующей версии — amendment создаёт НОВУЮ строку v2, v1 нетронута.
2. Самодостаточность derive: ``_snapshot_winners`` читает ТОЛЬКО roster+rows
   снапшота, никогда live-таблицы, — расход из снапшота воспроизводим
   байт-в-байт независимо от любой последующей жизни live-данных.

Ассерт только по (1) пропустил бы регрессию «потребитель снапшота подглядывает
в live»; только по (2) — «сервис мутирует JSONB на месте».

Unmarked amendment-тесты бегут в ``make gate``; property-класс — через
``pytest -m property`` (ci=10) и ``make test-full`` (full=500). Baseline и
пост-ассерты — строго по pk (``DailySubmissionSelector.by_id``): после
amendment v1 больше не current, ``current_for``/``latest_for`` сравнили бы
v2 с v2 — тест-пустышка (Ловушка №1); ``list()`` дефер-ит snapshot.
"""

import itertools
import json
from datetime import date, timedelta

import pytest
from hypothesis import HealthCheck, given
from hypothesis import settings as hyp_settings
from hypothesis import strategies as st

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import (
    bulk_create_statuses,
    cancel_status,
    complete_status_early,
    create_status,
    extend_status,
    resolve_pending_clarification,
    update_status,
)
from apps.operations.statuses.services.dismissal import dismiss_employee
from apps.operations.submissions.amendment_enforcement import (
    _AUTO_AMENDMENT_REASON,
)
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.traffic_light import _snapshot_winners

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 8)
ACTOR = "prop-op"

# Мягкие коды пула мутаций — строго из STATUS_TYPE_PRIORITIES, иначе derive
# бросит ValueError и замаскирует смысл падения (Ловушка №6).
SOFT_CODES = (
    "STUDY",
    "COMPETITION",
    "CONFERENCE",
    "OTHER_ABSENCE",
    "EVENT_ASSIGNMENT",
)
# VACATION (hard) — редкая ветка «мутация отвергнута»: пересечение с hard не
# overridable; отказ тоже не должен менять снапшот.
CREATE_CODES = SOFT_CODES + ("VACATION",)

_iin = itertools.count(510_000)
_div_code = itertools.count(1)


def _day(offset):
    return TODAY + timedelta(days=offset)


def _canon(value):
    """Каноническая байтовая форма Д3 — одна для snapshot- и derive-оси."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def _make_division():
    """Свежий Division на каждый вызов (счётчик-код): изоляция examples БЕЗ
    удалений (Д7) — unique-констрейнты сдач/статусов скоупятся подразделением,
    а audit_logs append-only (DELETE уронит триггер/REVOKE — 4.2)."""
    org, _ = Organization.objects.get_or_create(
        code="ORG-IMM", defaults={"name": "Орг"}
    )
    dtp, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    n = next(_div_code)
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {n}", code=f"IMM-{n}"
    )


def _make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def _make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


@pytest.fixture
def status_types(db):
    """Сид типов статусов (образец test_amendment_enforcement); get_or_create —
    повторный вызов между hypothesis-examples идемпотентен."""
    for code, name, priority, column in [
        ("STUDY", "Учёба", 32, "TRAINING"),
        ("COMPETITION", "Соревнования", 34, "TRAINING"),
        ("CONFERENCE", "Конференция", 36, "TRAINING"),
        ("OTHER_ABSENCE", "Прочее отсутствие", 38, "OTHER"),
        ("EVENT_ASSIGNMENT", "Обеспечение мероприятия", 80, "IN_SERVICE"),
        ("PENDING_CLARIFICATION", "Уточняется", 990, "PENDING"),
    ]:
        StatusType.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "is_hard_block": False,
                "priority": priority,
                "report_column_code": column,
            },
        )
    StatusType.objects.get_or_create(
        code="VACATION",
        defaults={
            "name": "В отпуске",
            "is_hard_block": True,
            "priority": 20,
            "report_column_code": "VACATION",
        },
    )


# --- AC-2: детерминированные amendment-компаньоны (unmarked → make gate) -----


def test_resolve_creates_v2_and_v1_stays_byte_identical(status_types):
    """Сильнейший кейс: resolve_pending_clarification — ЕДИНСТВЕННАЯ мутация,
    дёргающая хук 5.4b (status_service.py:819). Хук создаёт v2 (AMENDED), а v1
    по pk остаётся байт-в-байт прежней по обеим осям; is_current v1 флипнут в
    False — by design НЕ нарушение (флип не трогает snapshot-поле)."""
    with clock.override(TODAY):
        division = _make_division()
        emp = _make_employee(division)
        pending = _make_status(emp, "PENDING_CLARIFICATION", _day(-1), _day(2))
        sub = submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        base = DailySubmissionSelector.by_id(sub.pk)
        base_snapshot = _canon(base.snapshot)
        base_derive = _canon(_snapshot_winners(base.snapshot, TODAY))

        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=_day(-1),
            date_end=_day(2),
            actor=ACTOR,
            reason="уточнено",
        )

        latest = DailySubmissionSelector.latest_for(division.id, TODAY)
        assert latest.version == 2  # sanity: иначе ветка вакуумна
        assert latest.event == DailySubmission.Event.AMENDED
        assert latest.reason == _AUTO_AMENDMENT_REASON
        # Невакуумность: v2 пересобрал срез по исправленному состоянию —
        # мутация ДЕЙСТВИТЕЛЬНО возмутила снапшот-содержимое.
        assert _canon(latest.snapshot) != base_snapshot

        v1 = DailySubmissionSelector.by_id(sub.pk)
        assert v1.is_current is False
        assert _canon(v1.snapshot) == base_snapshot
        assert _canon(_snapshot_winners(v1.snapshot, TODAY)) == base_derive


def test_extend_does_not_trigger_amendment_v1_untouched(status_types):
    """Негатив-компаньон (Ловушка №7): не-resolve мутация поверх сданного дня
    хук НЕ дёргает — live уезжает (YELLOW-drift светофора, by design), v2 НЕ
    появляется, v1 байт-в-байт прежняя и остаётся current. Пинит вывод
    research'а «только resolve зовёт хук» как поведение, а не как знание."""
    with clock.override(TODAY):
        division = _make_division()
        emp = _make_employee(division)
        status = _make_status(emp, "STUDY", _day(-1), _day(2))
        sub = submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        base = DailySubmissionSelector.by_id(sub.pk)
        base_snapshot = _canon(base.snapshot)
        base_derive = _canon(_snapshot_winners(base.snapshot, TODAY))

        extend_status(status, actor=ACTOR, new_date_end=_day(6))
        status.refresh_from_db()
        assert status.date_end == _day(6)  # невакуумность: extend исполнился

        latest = DailySubmissionSelector.latest_for(division.id, TODAY)
        assert latest.version == 1
        assert latest.pk == sub.pk

        v1 = DailySubmissionSelector.by_id(sub.pk)
        assert v1.is_current is True
        assert _canon(v1.snapshot) == base_snapshot
        assert _canon(_snapshot_winners(v1.snapshot, TODAY)) == base_derive


# --- стратегии hypothesis (Task 2) --------------------------------------------


@st.composite
def worlds(draw):
    """Спека мира одного example: 1–4 сотрудника с 0–2 начальными мягкими
    статусами (интервалы в окне TODAY±5, полуоткрытые) + флаг «посеять
    pending, накрывающий TODAY» (питает AC-2-ветку в property)."""
    initial = [
        [
            (
                draw(st.sampled_from(SOFT_CODES)),
                draw(st.integers(min_value=-5, max_value=4)),
                draw(st.integers(min_value=1, max_value=5)),
            )
            for _ in range(draw(st.integers(min_value=0, max_value=2)))
        ]
        for _ in range(draw(st.integers(min_value=1, max_value=4)))
    ]
    pending = None
    if draw(st.booleans()):
        # [start ≤ TODAY < end) — pending гарантированно накрывает TODAY.
        pending = (
            draw(st.integers(min_value=-3, max_value=0)),
            draw(st.integers(min_value=1, max_value=3)),
        )
    return {"initial": initial, "pending": pending}


def _mutations():
    """Op-дескрипторы пула Д4 (кроме терминального dismiss). Индексы целей —
    по модулю на интерпретации; параметры рисуются валидными (Ловушка №6):
    мягкие коды, override=True на create/extend/resolve для обхода soft-409,
    cancel — по нарисованному тем же example будущему (PLANNED) статусу,
    complete_early — по ACTIVE, начавшемуся строго ДО TODAY."""
    emp_i = st.integers(min_value=0, max_value=7)
    reg_i = st.integers(min_value=0, max_value=7)
    soft = st.sampled_from(SOFT_CODES)
    start = st.integers(min_value=-5, max_value=4)
    span = st.integers(min_value=1, max_value=4)
    return st.one_of(
        st.tuples(st.just("create"), emp_i, st.sampled_from(CREATE_CODES), start, span),
        st.tuples(st.just("update_dates"), reg_i, start, span),
        st.tuples(st.just("update_comment"), reg_i),
        st.tuples(
            st.just("cancel_planned"),
            emp_i,
            soft,
            st.integers(min_value=1, max_value=3),
            span,
        ),
        st.tuples(
            st.just("complete_early"),
            emp_i,
            soft,
            st.integers(min_value=1, max_value=4),  # back: start = TODAY-back
            span,  # end = TODAY+span → ACTIVE на TODAY
            st.integers(min_value=0, max_value=3),  # end_back (mod back)
        ),
        st.tuples(st.just("extend"), reg_i, st.integers(min_value=1, max_value=3)),
        st.tuples(
            st.just("resolve"), soft, st.integers(min_value=-3, max_value=2), span
        ),
        st.tuples(
            st.just("bulk"),
            st.lists(st.tuples(emp_i, soft, start, span), min_size=1, max_size=2),
        ),
    )


@st.composite
def plans(draw):
    """Последовательность 1–6 операций. Первый op — гарантированно валидный
    create_status мягкого типа чистому roster-сотруднику интервалом,
    накрывающим TODAY (AC-3: ретро-правка live поверх сданной даты);
    dismiss ≤1 на example и только терминальной op (Д4)."""
    first = (
        "create_clean",
        draw(st.sampled_from(SOFT_CODES)),
        draw(st.integers(min_value=-2, max_value=0)),  # start ≤ TODAY
        draw(st.integers(min_value=1, max_value=3)),  # end > TODAY
    )
    plan = [first, *draw(st.lists(_mutations(), min_size=0, max_size=4))]
    if draw(st.booleans()):
        plan.append(("dismiss", draw(st.integers(min_value=0, max_value=7))))
    return plan


def _apply_op(op, ctx):
    """Интерпретация op-дескриптора РЕАЛЬНЫМИ сервисами. True — мутация
    применилась (успех для счётчика AC-3); False — op неприменим (нет цели)
    и пропущен. DomainError пробрасывается наверх и допустим (Д5)."""
    kind = op[0]
    employees, registry = ctx["employees"], ctx["registry"]

    if kind == "create_clean":
        _, code, start, end = op
        registry.append(
            create_status(
                employee_id=ctx["clean"].id,
                status_type_code=code,
                date_start=_day(start),
                date_end=_day(end),
                actor=ACTOR,
                override=True,
                override_reason="prop",
            )
        )
        return True

    if kind == "create":
        _, emp_i, code, start, span = op
        emp = employees[emp_i % len(employees)]
        registry.append(
            create_status(
                employee_id=emp.id,
                status_type_code=code,
                date_start=_day(start),
                date_end=_day(start + span),
                actor=ACTOR,
                override=True,
                override_reason="prop",
            )
        )
        return True

    if kind in ("update_dates", "update_comment"):
        if not registry:
            return False
        target = registry[op[1] % len(registry)]
        if kind == "update_dates":
            _, _, start, span = op
            update_status(
                target,
                actor=ACTOR,
                date_start=_day(start),
                date_end=_day(start + span),
            )
        else:
            update_status(target, actor=ACTOR, comment="prop-edit")
        return True

    if kind == "cancel_planned":
        _, emp_i, code, start, span = op
        emp = employees[emp_i % len(employees)]
        planned = create_status(
            employee_id=emp.id,
            status_type_code=code,
            date_start=_day(start),
            date_end=_day(start + span),
            actor=ACTOR,
            override=True,
            override_reason="prop",
        )
        registry.append(planned)
        cancel_status(planned, actor=ACTOR, reason="prop-отмена")
        return True

    if kind == "complete_early":
        _, emp_i, code, back, span, end_back = op
        emp = employees[emp_i % len(employees)]
        active = create_status(
            employee_id=emp.id,
            status_type_code=code,
            date_start=_day(-back),
            date_end=_day(span),
            actor=ACTOR,
            override=True,
            override_reason="prop",
        )
        registry.append(active)
        # actual_end ∈ (date_start, TODAY]: для стартовавшего В TODAY статуса
        # валидного actual_end не существует — потому back ≥ 1 и mod back.
        complete_status_early(active, actor=ACTOR, actual_end=_day(-(end_back % back)))
        return True

    if kind == "extend":
        if not registry:
            return False
        _, reg_i, extra = op
        target = registry[reg_i % len(registry)]
        target.refresh_from_db()  # date_end мог уехать прежними op
        extend_status(
            target,
            actor=ACTOR,
            new_date_end=target.date_end + timedelta(days=extra),
            override=True,
            override_reason="prop",
        )
        return True

    if kind == "resolve":
        if ctx["pending"] is None:
            return False
        _, code, start, span = op
        registry.append(
            resolve_pending_clarification(
                ctx["pending"],
                resolved_type_code=code,
                date_start=_day(start),
                date_end=_day(start + span),
                actor=ACTOR,
                reason="prop-санкция",
                override=True,
                override_reason="prop",
            )
        )
        return True

    if kind == "bulk":
        _, spec = op
        rows = [
            {
                "employee_id": employees[emp_i % len(employees)].id,
                "status_type_code": code,
                "date_start": _day(start),
                "date_end": _day(start + span),
            }
            for emp_i, code, start, span in spec
        ]
        registry.extend(
            bulk_create_statuses(
                rows,
                actor=ACTOR,
                business_date=TODAY,
                allowed_division_ids={ctx["division"].id},
            )
        )
        return True

    # dismiss — терминальная op (последняя в plan, ≤1 на example).
    _, emp_i = op
    dismiss_employee(
        employees[emp_i % len(employees)],
        date=TODAY,
        reason="prop-увольнение",
        actor=ACTOR,
    )
    return True


# --- ядро property (Task 3): AC-1/3/5 + Д6 -----------------------------------


class TestSnapshotImmutabilityProperties:
    """Произвольные последовательности мутаций статусов через реальные сервисы
    ПОСЛЕ сдачи дня не меняют ни snapshot-байты v1, ни derive(v1)."""

    pytestmark = [pytest.mark.property, pytest.mark.django_db]

    @hyp_settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(world=worlds(), plan=plans())
    def test_mutations_after_submit_never_move_v1_bytes(
        self, status_types, world, plan
    ):
        with clock.override(TODAY):  # Ловушка №4: всё тело example под override
            division = _make_division()
            regular = [_make_employee(division) for _ in world["initial"]]
            registry = []
            for emp, rows in zip(regular, world["initial"]):
                for code, start, span in rows:
                    registry.append(
                        _make_status(emp, code, _day(start), _day(start + span))
                    )
            clean = _make_employee(division)  # цель гарантированного первого op
            employees = [*regular, clean]
            pending = None
            if world["pending"] is not None:
                start, end = world["pending"]
                pending_emp = _make_employee(division)
                employees.append(pending_emp)
                # НЕ в registry: update/extend не должны увести pending с
                # TODAY, иначе sanity-ассерт Д6 по v2 потерял бы основание.
                pending = _make_status(
                    pending_emp, "PENDING_CLARIFICATION", _day(start), _day(end)
                )

            submission = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
            # Baseline — DB-refetch по pk СРАЗУ после сдачи (Ловушки №1/№3):
            # оба берега сравнения прошли одинаковый JSONB-путь.
            base = DailySubmissionSelector.by_id(submission.pk)
            base_snapshot = _canon(base.snapshot)
            base_derive = _canon(_snapshot_winners(base.snapshot, TODAY))

            ctx = {
                "division": division,
                "employees": employees,
                "registry": registry,
                "clean": clean,
                "pending": pending,
            }
            succeeded = 0
            resolved = False
            for i, op in enumerate(plan):
                try:
                    applied = _apply_op(op, ctx)
                except DomainError:
                    # Первый op сконструирован гарантированно валидным (AC-3);
                    # его отказ = сгнивший генератор, а не допустимый исход —
                    # иначе succeeded>=1 закрылся бы op'ом, не возмущающим
                    # сданный день, и невакуумность истлела бы молча.
                    if i == 0:
                        raise
                    continue  # отказ — допустимый исход (Д5), снапшот цел
                if applied:
                    succeeded += 1
                    resolved = resolved or op[0] == "resolve"

            refetched = DailySubmissionSelector.by_id(submission.pk)
            assert _canon(refetched.snapshot) == base_snapshot
            assert _canon(_snapshot_winners(refetched.snapshot, TODAY)) == base_derive
            # Невакуумность (AC-3): первый op гарантированно валиден и
            # возмущает снапшот (создаёт статус roster-сотруднику на TODAY).
            assert succeeded >= 1
            if resolved:
                # Д6: сильнейший кейс исполнился — хук 5.4b создал v2+.
                latest = DailySubmissionSelector.latest_for(division.id, TODAY)
                assert latest.version >= 2
