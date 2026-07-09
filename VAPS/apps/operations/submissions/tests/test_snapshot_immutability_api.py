"""QA-судья стори 5.10 поверх HTTP-слоя (bmad-qa-generate-e2e-tests).

Сервисные тесты 5.10 (test_snapshot_immutability_properties) пинят инвариант
ARCH-DATA-021 на селекторах; ``GET /api/operations/daily-submissions/{id}/`` —
ЕДИНСТВЕННЫЙ HTTP-канал снапшота (экраны расхода 10.5/10.6, parallel-run
сверка), и его иммутабельность до этого модуля никем не судилась: read-api
5.8c сравнивает ответ с ТЕКУЩЕЙ строкой БД (same-side) — in-place мутация
JSONB прошла бы мимо того ассерта. Здесь оба берега — HTTP-ответы, разнесённые
во времени вокруг реальных live-мутаций, байтовая форма Д3 по обеим осям
(snapshot + derive ``_snapshot_winners``).

Три детерминированных unmarked-теста (бегут в ``make gate``):

1. detail отдаёт v1 байт-в-байт после live-мутаций реальными сервисами;
2. после hook-amendment (resolve → 5.4b) старый pk продолжает отдавать
   исторический срез, новый head — пересобранный (AMENDED, авто-reason,
   provenance-ссылка) — API-проекция Ловушки №1;
3. СРЕДНЯЯ версия цепочки v1→v2→v3 (v3 — через POST /{pk}/amend/ по старому
   pk, Д1) байт-стабильна: «ни один сервис не переписывает snapshot
   существующей версии» справедливо для всех версий, не только v1 —
   до этого модуля байт-судья был только у v1 (5.10; 5.4a chain-тест пинит
   лишь версии/каррентность).

Фикстуры — СВОИ копии канона 5.8c/5.10 (конвенция сьютов: без общего conftest).
"""

import itertools
import json
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import (
    create_status,
    extend_status,
    resolve_pending_clarification,
)
from apps.operations.submissions.amendment_enforcement import (
    _AUTO_AMENDMENT_REASON,
)
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import (
    build_division_snapshot,
    submit_day,
)
from apps.operations.submissions.traffic_light import _snapshot_winners

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 9)
ACTOR = "qa-op"

_iin = itertools.count(520_000)
_div_code = itertools.count(1)


def _day(offset):
    return TODAY + timedelta(days=offset)


def _canon(value):
    """Каноническая байтовая форма Д3 — одна для snapshot- и derive-оси."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def _make_division():
    org, _ = Organization.objects.get_or_create(
        code="ORG-IMA", defaults={"name": "Орг"}
    )
    dtp, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    n = next(_div_code)
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"Отдел {n}", code=f"IMA-{n}"
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


@pytest.fixture(autouse=True)
def frozen_clock():
    # submit_day валидирует окно {today, tomorrow} от Clock (Ловушка №4).
    with clock.override(TODAY):
        yield


@pytest.fixture
def status_types(db):
    """Мягкие коды — строго из STATUS_TYPE_PRIORITIES (Ловушка №6);
    get_or_create — идемпотентен рядом с любым сидом."""
    for code, name, priority, column in [
        ("STUDY", "Учёба", 32, "TRAINING"),
        ("OTHER_ABSENCE", "Прочее отсутствие", 38, "OTHER"),
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


@pytest.fixture
def global_op(db):
    """DIVISION_OPERATOR без скоупа — держит и mark_update (read), и correct
    (amend): один актор на весь HTTP-путь (канон 5.8b/c)."""
    call_command("seed_operations")
    UserRole.objects.create(
        user_id=ACTOR, role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return ACTOR


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


def _detail(actor, pk):
    return _client(actor).get(
        reverse("ops-daily-submission-detail", kwargs={"pk": str(pk)})
    )


def _amend(actor, pk, reason, sanction):
    return _client(actor).post(
        reverse("ops-daily-submission-amend", kwargs={"pk": str(pk)}),
        {"reason": reason, "sanction": sanction},
        format="json",
    )


def _served_bytes(resp):
    """Обе байт-оси Д3 от СЛУЖИМОГО payload'а (не от ORM-строки)."""
    snapshot = resp.data["snapshot"]
    return _canon(snapshot), _canon(_snapshot_winners(snapshot, TODAY))


def test_detail_serves_v1_bytes_unchanged_after_live_mutations(global_op, status_types):
    """Live-мутации реальными сервисами ПОСЛЕ сдачи не двигают байты снапшота,
    отдаваемого HTTP-каналом расхода. Оба берега сравнения — HTTP-ответы:
    same-side ассерт 5.8c (ответ == текущая строка БД) in-place перезапись
    JSONB не поймал бы, этот тест — ловит."""
    division = _make_division()
    emp = _make_employee(division)
    initial = _make_status(emp, "STUDY", _day(-1), _day(2))
    sub = submit_day(division_id=division.id, business_date=TODAY, actor="seed-op")

    base = _detail(global_op, sub.pk)
    assert base.status_code == 200
    base_snapshot, base_derive = _served_bytes(base)

    create_status(
        employee_id=emp.id,
        status_type_code="OTHER_ABSENCE",
        date_start=_day(0),
        date_end=_day(3),
        actor=ACTOR,
        override=True,
        override_reason="qa",
    )
    extend_status(
        initial,
        actor=ACTOR,
        new_date_end=_day(5),
        override=True,
        override_reason="qa",
    )

    # Невакуумность: live действительно уехал — пересборка среза «сейчас»
    # дала бы ДРУГИЕ байты, чем заморожено в v1.
    assert _canon(build_division_snapshot(division.id, TODAY)) != base_snapshot

    again = _detail(global_op, sub.pk)
    assert again.status_code == 200
    assert _served_bytes(again) == (base_snapshot, base_derive)


def test_v1_pk_serves_original_bytes_after_hook_amendment(global_op, status_types):
    """Сильнейший кейс через HTTP: resolve → хук 5.4b → v2. Старый pk обязан
    продолжать отдавать исторический срез байт-в-байт (контракт parallel-run
    сверки), новый head — пересобранный AMENDED с авто-reason и provenance."""
    division = _make_division()
    emp = _make_employee(division)
    pending = _make_status(emp, "PENDING_CLARIFICATION", _day(-1), _day(2))
    sub = submit_day(division_id=division.id, business_date=TODAY, actor="seed-op")

    base = _detail(global_op, sub.pk)
    assert base.status_code == 200
    base_snapshot, base_derive = _served_bytes(base)

    resolve_pending_clarification(
        pending,
        resolved_type_code="STUDY",
        date_start=_day(-1),
        date_end=_day(2),
        actor=ACTOR,
        reason="уточнено",
    )

    v2_row = DailySubmissionSelector.latest_for(division.id, TODAY)
    assert v2_row.version == 2  # sanity: хук исполнился, ветка не вакуумна

    v2 = _detail(global_op, v2_row.pk)
    assert v2.status_code == 200
    assert v2.data["version"] == 2
    assert v2.data["event"] == DailySubmission.Event.AMENDED
    assert v2.data["reason"] == _AUTO_AMENDMENT_REASON
    # Hook-amendment несёт provenance-ссылку (ручной amend хранит None).
    assert v2.data["triggered_by_status_id"] is not None
    # Невакуумность: v2 пересобран по исправленному состоянию.
    assert _canon(v2.data["snapshot"]) != base_snapshot

    v1 = _detail(global_op, sub.pk)
    assert v1.data["version"] == 1
    assert v1.data["is_current"] is False  # by-design НЕ нарушение (Ловушка №1)
    assert _served_bytes(v1) == (base_snapshot, base_derive)


def test_middle_version_bytes_stable_across_chained_amendments(global_op, status_types):
    """Цепочка v1→v2(хук)→v3(ручной POST /{pk}/amend/ по СТАРОМУ pk — Д1):
    инвариант «snapshot существующей версии не переписывается» обязан
    держаться для КАЖДОЙ версии — flip is_current на v2 при вставке v3
    (amend_day, flip-before-insert) не смеет трогать её JSONB. Байт-судья
    средней версии до этого теста не существовал."""
    division = _make_division()
    emp = _make_employee(division)
    pending = _make_status(emp, "PENDING_CLARIFICATION", _day(-1), _day(2))
    sub = submit_day(division_id=division.id, business_date=TODAY, actor="seed-op")

    v1_resp = _detail(global_op, sub.pk)
    assert v1_resp.status_code == 200
    v1_base = _served_bytes(v1_resp)

    resolve_pending_clarification(
        pending,
        resolved_type_code="STUDY",
        date_start=_day(-1),
        date_end=_day(2),
        actor=ACTOR,
        reason="уточнено",
    )
    v2_row = DailySubmissionSelector.latest_for(division.id, TODAY)
    assert v2_row.version == 2  # sanity: хук исполнился
    v2_resp = _detail(global_op, v2_row.pk)
    assert v2_resp.status_code == 200
    v2_base = _served_bytes(v2_resp)

    # Возмущение live между v2 и v3 — чтобы v3-пересборка гарантированно
    # отличалась от v2 (иначе стабильность v2 была бы неотличима от копии).
    create_status(
        employee_id=emp.id,
        status_type_code="OTHER_ABSENCE",
        date_start=_day(0),
        date_end=_day(4),
        actor=ACTOR,
        override=True,
        override_reason="qa",
    )

    v3 = _amend(global_op, sub.pk, reason="контрольная пересдача", sanction="замечание")
    assert v3.status_code == 201
    assert v3.data["version"] == 3  # старый pk адресует ЦЕПОЧКУ (Д1)

    v3_row = DailySubmissionSelector.latest_for(division.id, TODAY)
    assert _canon(v3_row.snapshot) != v2_base[0]  # невакуумность возмущения

    v2_again = _detail(global_op, v2_row.pk)
    assert v2_again.data["is_current"] is False
    assert _served_bytes(v2_again) == v2_base
    v1_again = _detail(global_op, sub.pk)
    assert v1_again.data["is_current"] is False
    assert _served_bytes(v1_again) == v1_base
