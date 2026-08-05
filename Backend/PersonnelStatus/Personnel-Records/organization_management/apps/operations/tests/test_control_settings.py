"""Справочник контроля сдачи: синглтон, содержимое списка и врезка в сдачу.

Ограничения проверяются вставкой В БАЗУ, а не через full_clean: сервисы
раздела ходят через .create()/.update(), которые валидацию модели не зовут, —
инвариант обязан жить на БД, иначе он держится только на дисциплине кода.
Отдельная половина тестов — сквозняк: правка настройки обязана менять
поведение сдачи, иначе справочник был бы украшением.
"""
from datetime import datetime, time, timezone

import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    DEFAULT_CONTROL_HOUR,
    OpsSubmissionControlSettings,
)
from organization_management.apps.operations.selectors import (
    SubmissionControlSettingsSelector,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

ACTOR = "7"
# 12:00 UTC = 17:00 местного (+05) — ровно контрольный час по умолчанию.
DEADLINE = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def division():
    seed_types()
    return Division.objects.create(name="Управление 1")


def settings_row():
    return OpsSubmissionControlSettings.objects.get(singleton_key=1)


def submit(division, at):
    with clock.override(at):
        return submit_day(
            division_id=division.id, business_date=TODAY, actor=ACTOR
        )


# ── Синглтон ─────────────────────────────────────────────────────────────

def test_the_row_is_seeded_by_the_migration():
    """Строка есть ДО первого чтения.

    Пустая таблица заставила бы каждого читателя нести свой запасной
    контрольный час, и они разошлись бы при первой правке дефолта.
    """
    assert OpsSubmissionControlSettings.objects.count() == 1
    assert settings_row().control_hour == DEFAULT_CONTROL_HOUR
    assert settings_row().required_division_ids == []


def test_a_second_row_is_impossible():
    # Уникальности ключа мало: без CHECK'а прошла бы «строка на ключ», то
    # есть сколько угодно наборов настроек, и раздел читал бы первый попавшийся.
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsSubmissionControlSettings.objects.create(singleton_key=2)


def test_the_seeded_key_cannot_be_duplicated():
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsSubmissionControlSettings.objects.create(singleton_key=1)


# ── Содержимое «необходимых управлений» ──────────────────────────────────

@pytest.mark.parametrize("bad", [[None], [0], [-1], [5, None], [5, 0]])
def test_a_ghost_division_is_rejected_by_the_database(bad):
    """NULL и неположительный id — подразделение-ПРИЗРАК.

    Сдачи у него не будет никогда, значит завтрашний день оказался бы
    заблокирован навсегда, а причину пришлось бы искать в содержимом
    настройки, а не в сообщении об ошибке.
    """
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
            required_division_ids=bad
        )


def test_a_real_list_is_accepted():
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        required_division_ids=[3, 7]
    )
    assert SubmissionControlSettingsSelector.required_division_ids() == [3, 7]


def test_an_empty_list_is_a_legal_state():
    # «Никто не обязан» — законная настройка, а не незаполненная форма.
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        required_division_ids=[]
    )
    assert SubmissionControlSettingsSelector.required_division_ids() == []


# ── Селектор ─────────────────────────────────────────────────────────────

def test_every_read_goes_to_the_database():
    """Правка настройки видна СЛЕДУЮЩЕМУ читателю, без перезапуска процесса.

    Это же свойство объясняет, почему селектор не копирует список: строка
    одноразовая, и второй владелец правила о свежести (обёртка `list(...)`)
    не роняла ни одного теста — её сняли. Кеш строки покраснит этот тест
    первым.
    """
    assert SubmissionControlSettingsSelector.required_division_ids() == []
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        required_division_ids=[3], control_hour=time(9, 0)
    )
    assert SubmissionControlSettingsSelector.required_division_ids() == [3]
    assert SubmissionControlSettingsSelector.control_hour() == time(9, 0)


def test_the_selector_heals_a_missing_row():
    # Перенос данных или ручная чистка не должны ронять сдачу дня 500-й.
    OpsSubmissionControlSettings.objects.all().delete()
    assert SubmissionControlSettingsSelector.control_hour() == DEFAULT_CONTROL_HOUR
    assert OpsSubmissionControlSettings.objects.count() == 1


# ── Сквозняк: настройка меняет сдачу ─────────────────────────────────────

def test_the_default_hour_still_decides_lateness(division):
    # Ровно в контрольный час не поздно, секундой позже — поздно.
    in_slot(division)
    other = Division.objects.create(name="Управление 2")
    in_slot(other)
    assert submit(division, DEADLINE).late is False
    with clock.override(DEADLINE.replace(second=1)):
        late = submit_day(
            division_id=other.id, business_date=TODAY, actor=ACTOR
        )
    assert late.late is True


def test_moving_the_hour_later_makes_the_same_moment_on_time(division):
    """Правка справочника меняет поведение сдачи — иначе он украшение.

    Момент сдачи один и тот же; меняется только настройка.
    """
    in_slot(division)
    other = Division.objects.create(name="Управление 2")
    in_slot(other)
    after_deadline = DEADLINE.replace(hour=14)  # 19:00 местного
    assert submit(division, after_deadline).late is True
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        control_hour=time(23, 0)
    )
    with clock.override(after_deadline):
        second = submit_day(
            division_id=other.id, business_date=TODAY, actor=ACTOR
        )
    assert second.late is False


def test_moving_the_hour_earlier_makes_the_morning_late(division):
    in_slot(division)
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        control_hour=time(0, 1)
    )
    morning = DEADLINE.replace(hour=4)  # 09:00 местного
    assert submit(division, morning).late is True


def test_an_explicit_hour_wins_and_does_not_read_the_settings(division):
    """Параметр старше справочника, и справочник тогда не читается вовсе.

    Ассерт ПО SQL, а не по числу запросов: «не читается» — это про конкретную
    таблицу, и счётчик зеленел бы от любого другого сэкономленного запроса.
    """
    in_slot(division)
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        control_hour=time(0, 1)
    )
    with CaptureQueriesContext(connection) as captured, clock.override(DEADLINE):
        submission = submit_day(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            control_hour=time(23, 0),
        )
    touched = " ".join(query["sql"] for query in captured.captured_queries)
    assert submission.late is False
    assert "ops_submission_control_settings" not in touched, touched


def test_the_submitted_lateness_does_not_change_afterwards(division):
    """Сданное задним числом не переписывается.

    `late` записан в строке сдачи, и перенос дедлайна не делает вчерашнюю
    сдачу опоздавшей: подпись стоит под тем, что было правилом в момент сдачи.
    """
    in_slot(division)
    submission = submit(division, DEADLINE)
    OpsSubmissionControlSettings.objects.filter(singleton_key=1).update(
        control_hour=time(0, 1)
    )
    submission.refresh_from_db()
    assert submission.late is False
