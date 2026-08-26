"""Бэкфилл 0048: связь участника рейтинга с кадровой записью (Plane №96).

До этой миграции `OpsRatedParticipant` знал только свободную строку
`participant_code`, и расстановка, искавшая рейтинг по КАДРОВОМУ id, не
находила его никогда. На моке идентификаторы совпадали — весь рейтинговый
функционал подбора был зелен на моке и мёртв на живом стенде.

Проба стережёт свойства, потеря которых незаметна на глаз (правило из
`Personnel-Records/Decisions` — «миграция с данными не едет без своего теста»):

1. код вида `employee-<pk>` разбирается в связь — иначе перенос молча ничего
   не делает, и симптом остаётся ровно тем же;
2. код ЧУЖОГО вида связи не получает — выдуманная связь привязала бы рейтинг к
   постороннему человеку, и на экране это выглядело бы нормальным числом;
3. ссылка на НЕСУЩЕСТВУЮЩУЮ кадровую запись не ставится — код может указывать
   на удалённого;
4. повтор ничего не меняет.
"""
import importlib

import pytest
from django.apps import apps as django_apps

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models_rating import (
    OpsRatedParticipant,
)

MIGRATION = importlib.import_module(
    "organization_management.apps.operations.migrations."
    "0048_rated_participant_employee"
)

pytestmark = pytest.mark.django_db


def make_employee(number, last_name):
    return Employee.objects.create(
        personnel_number=number, last_name=last_name, first_name="Тест"
    )


def participant(code, label="Участник"):
    return OpsRatedParticipant.objects.create(
        participant_code=code, safe_label=label, group_code="GROUP"
    )


def run():
    MIGRATION.link_participants_to_employees(django_apps, None)


def test_employee_code_becomes_a_link():
    employee = make_employee("100500", "Абенов")
    row = participant(f"employee-{employee.pk}")

    run()

    row.refresh_from_db()
    assert row.employee_id == employee.pk


def test_foreign_code_gets_no_link():
    """Код чужого вида связи не получает.

    Это главная проба файла: выдуманная связь привязала бы рейтинг к
    постороннему человеку, и заметить это на экране нельзя — там просто
    появится число, которое выглядит настоящим.

    🔴 Хвост чужого кода СПЕЦИАЛЬНО указывает на СУЩЕСТВУЮЩЕГО сотрудника.
    Первая редакция пробы брала `legacy-7` при пустой кадровой таблице, и
    мутация «разбирать любой хвост-число» её НЕ роняла: разобранный id никому
    не принадлежал, и связь всё равно не ставилась. То есть проба выглядела
    сторожем, не будучи им, — поймано красной пробой.
    """
    victim = make_employee("100501", "Байжанов")
    historical = participant(f"legacy-{victim.pk}", "Исторический участник")
    named = participant("ivanov-i-i", "Иванов И. И.")

    run()

    historical.refresh_from_db()
    named.refresh_from_db()
    assert historical.employee_id is None, (
        "рейтинг привязан к постороннему человеку: код чужого вида разобран "
        "как кадровый"
    )
    assert named.employee_id is None


def test_link_to_a_missing_employee_is_not_made():
    """Код может указывать на удалённого — ссылка не ставится."""
    row = participant("employee-999999")

    run()

    row.refresh_from_db()
    assert row.employee_id is None


def test_running_it_twice_changes_nothing_more():
    employee = make_employee("100502", "Жаксылыков")
    row = participant(f"employee-{employee.pk}")

    run()
    first = OpsRatedParticipant.objects.get(pk=row.pk).employee_id
    run()

    assert OpsRatedParticipant.objects.get(pk=row.pk).employee_id == first


def test_existing_links_are_not_touched():
    """Проставленную связь перенос не переписывает: у неё может быть другой
    источник, чем разбор кода, — например, заведение оценивания на ОМ."""
    employee = make_employee("100503", "Есимов")
    other = make_employee("100504", "Ахметова")
    row = participant(f"employee-{other.pk}")
    row.employee_id = employee.pk
    row.save(update_fields=["employee_id"])

    run()

    row.refresh_from_db()
    assert row.employee_id == other.pk, (
        "разбор кода — единственный источник связи в этой миграции, и он "
        "обязан быть предсказуемым; если правило изменится, проба должна "
        "покраснеть, а не промолчать"
    )
