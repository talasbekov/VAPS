"""Справочник получателей уведомлений: закрепление, дежурный, разрешение.

Предыдущий срез научил раздел СООБЩАТЬ (уведомление адресуется строкой), но
взять эту строку было неоткуда. Здесь она появляется: закрепление за
подразделением, общий дежурный в настройках и разрешение пачкой со строгим
порядком «свой → дежурный → никто».
"""
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext

from organization_management.apps.operations.models_submission import (
    OpsDivisionNotifyRecipient,
    OpsSubmissionControlSettings,
)
from organization_management.apps.operations.selectors import (
    NotifyRecipientSelector,
    SubmissionControlSettingsSelector,
)

pytestmark = pytest.mark.django_db


def set_duty(recipient):
    row = SubmissionControlSettingsSelector.get()
    row.default_notify_recipient = recipient
    row.save(update_fields=["default_notify_recipient"])


# --- форма справочника -------------------------------------------------------


def test_the_reference_table_lives_beside_the_old_ones():
    assert (
        OpsDivisionNotifyRecipient._meta.db_table == "ops_division_notify_recipients"
    )


def test_a_recipient_is_pinned_to_a_division():
    row = OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="42")

    assert row.division_id == 7
    assert row.recipient == "42"
    assert row.created_at is not None  # из TimeStampedModel
    assert "7" in str(row) and "42" in str(row)


def test_a_division_has_exactly_one_recipient():
    """Двое ответственных = два уведомления об одном факте.

    «Одно на день» держится по ПОЛУЧАТЕЛЮ, поэтому для каждого из двоих оно
    выполнялось бы, а для самого факта — нет.
    """
    OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="42")

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="43")


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_the_database_rejects_an_empty_recipient(blank):
    """Инвариант живёт на БД: .create() мимо full_clean — обычный путь раздела.

    Строка с пустым получателем не «дежурного нет» (для этого её просто не
    заводят), а обещание адресата, которого нет.
    """
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            OpsDivisionNotifyRecipient.objects.create(
                division_id=7, recipient=blank
            )


def test_the_form_trims_the_recipient():
    row = OpsDivisionNotifyRecipient(division_id=7, recipient="  42  ")

    row.full_clean()

    assert row.recipient == "42"


@pytest.mark.parametrize("blank", ["", "   "])
def test_the_form_refuses_an_empty_recipient(blank):
    # Вежливость формы: администратор получает поле с ошибкой, а не 500-ю.
    row = OpsDivisionNotifyRecipient(division_id=7, recipient=blank)

    with pytest.raises(ValidationError):
        row.full_clean()


# --- общий дежурный ----------------------------------------------------------


def test_there_is_no_duty_by_default():
    assert SubmissionControlSettingsSelector.get().default_notify_recipient == ""


def test_an_empty_duty_stays_legal():
    # «Дежурного нет» — законное состояние, а не незаполненная настройка.
    row = SubmissionControlSettingsSelector.get()
    row.default_notify_recipient = ""
    row.save(update_fields=["default_notify_recipient"])

    row.refresh_from_db()
    assert row.default_notify_recipient == ""


def test_a_whitespace_duty_is_refused_by_the_database():
    """«   » истинно — и увело бы ВСЕХ незакреплённых на несуществующего.

    Отказ от пробельного дежурного стережёт именно этот молчаливый исход,
    поэтому и стоит на БД: настройки правятся из Admin и из shell.
    """
    row = SubmissionControlSettingsSelector.get()
    row.default_notify_recipient = "   "

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            row.save(update_fields=["default_notify_recipient"])


# --- разрешение: свой → дежурный → никто -------------------------------------


def test_the_pinned_recipient_beats_the_duty():
    OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="свой")
    set_duty("дежурный")

    assert NotifyRecipientSelector.resolve_many([7]) == {7: "свой"}


def test_an_unpinned_division_falls_back_to_the_duty():
    set_duty("дежурный")

    assert NotifyRecipientSelector.resolve_many([7]) == {7: "дежурный"}


def test_without_a_pin_and_without_a_duty_the_division_is_absent():
    """Отсутствие КЛЮЧА, а не получатель по имени «».

    Пустая строка в значении заставила бы каждого вызывающего разбирать её
    заново — и первый же забывший разослал бы уведомления в никуда.
    """
    assert NotifyRecipientSelector.resolve_many([7]) == {}


def test_pinned_and_unpinned_divisions_resolve_in_one_call():
    OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="свой")
    set_duty("дежурный")

    assert NotifyRecipientSelector.resolve_many([7, 8]) == {
        7: "свой",
        8: "дежурный",
    }


def test_nothing_to_resolve():
    assert NotifyRecipientSelector.resolve_many([]) == {}


def test_missing_ids_are_dropped():
    # None — не подразделение; дежурный не должен «разрешить» его в получателя.
    set_duty("дежурный")

    assert NotifyRecipientSelector.resolve_many([7, None]) == {7: "дежурный"}


def test_a_generator_of_ids_survives_the_query():
    """Генератор ушёл бы в `__in` целиком и до склейки не дожил бы.

    Пустой ответ на непустой вход выглядит как «отставших нет» — отказ, о
    котором никто не узнает.
    """
    OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="свой")

    assert NotifyRecipientSelector.resolve_many(d for d in [7]) == {7: "свой"}


def test_a_padded_recipient_is_trimmed_on_resolution():
    """«  42  » доезжает до базы: .create() минует clean, CHECK ловит лишь пустое.

    Ключ «одно на день» — по строке получателя: необрезанное значение развело
    бы одного человека на двух адресатов.
    """
    OpsDivisionNotifyRecipient.objects.create(division_id=7, recipient="  42  ")

    assert NotifyRecipientSelector.resolve_many([7]) == {7: "42"}


def test_a_padded_duty_is_trimmed_on_resolution():
    set_duty("  42  ")

    assert NotifyRecipientSelector.resolve_many([7]) == {7: "42"}


# --- пачкой, а не по одному --------------------------------------------------


def test_resolution_costs_the_same_for_one_and_for_many():
    """Утренний прогон по отставшим — это десятки подразделений сразу.

    Запрос на каждое в цикле превратил бы его в сотню обращений; цена обязана
    не зависеть от длины входа.
    """
    SubmissionControlSettingsSelector.get()  # строка настроек уже есть
    OpsDivisionNotifyRecipient.objects.bulk_create(
        [
            OpsDivisionNotifyRecipient(division_id=did, recipient="42")
            for did in range(1, 8)
        ]
    )

    with CaptureQueriesContext(connection) as one:
        NotifyRecipientSelector.resolve_many([1])
    with CaptureQueriesContext(connection) as many:
        NotifyRecipientSelector.resolve_many(list(range(1, 8)))

    assert len(one) == len(many), f"запрос на подразделение: {len(one)} vs {len(many)}"
    # Один запрос по справочнику + одно чтение настроек.
    assert len(many) == 2, f"неожиданное число запросов: {len(many)}"


def test_the_duty_only_path_is_bulk_too():
    # Ветка без единого закрепления — тот же счёт: справочник спрашивается
    # один раз даже когда в нём ничего нет.
    SubmissionControlSettingsSelector.get()
    set_duty("дежурный")

    with CaptureQueriesContext(connection) as one:
        NotifyRecipientSelector.resolve_many([1])
    with CaptureQueriesContext(connection) as many:
        NotifyRecipientSelector.resolve_many(list(range(1, 8)))

    assert len(one) == len(many) == 2


# --- форма полей -------------------------------------------------------------


def test_field_shape():
    recipient = OpsDivisionNotifyRecipient._meta.get_field("recipient")
    assert recipient.max_length == 100
    assert OpsDivisionNotifyRecipient._meta.get_field("division_id").unique is True

    duty = OpsSubmissionControlSettings._meta.get_field("default_notify_recipient")
    assert duty.max_length == 100
    assert duty.blank is True
    assert duty.default == ""
