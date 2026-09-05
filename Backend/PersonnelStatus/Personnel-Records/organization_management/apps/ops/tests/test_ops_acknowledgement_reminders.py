"""Напоминание руководителям за час до заступления (Plane №427, `[ОЗН-06]`).

Пробы стерегут два правила, которые модуль обещал комментариями и не
выполнял кодом (найдено ревью коммита `6bd6c472`, карточки №665 и №666):

1. **каждому — только его люди.** Полезная нагрузка здесь СПИСОЧНАЯ, и одна
   на всех означала рассылку личного состава управления А начальнику
   управления Б;
2. **ключ дедупликации — мероприятие, а не только день.** Два ОМ на одну дату
   давали начальнику одно напоминание, о втором ему не говорили вовсе, а
   отчёт всё равно считал его уведомлённым.
"""
import datetime as dt

import pytest
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Role, UserRole
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.ops.acknowledgement_reminders import (
    KIND,
    remind_supervisors_before_start,
)
from organization_management.apps.operations.tests.test_strength_report import (
    make_employee,
)

pytestmark = pytest.mark.django_db

DAY = dt.date(2026, 8, 21)
START = dt.time(8, 0)


def _event(code, assignments, business_date=DAY):
    return OpsSecurityEvent.objects.create(
        code=code,
        title="Проба напоминания",
        object_name="Объект",
        business_date=business_date,
        event_time=START,
        stage="ACKNOWLEDGEMENT",
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Ведущий",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        placement_assignments=assignments,
        force_requests=[],
        journal_entries=[],
        closure_direction_summaries=[],
        approval_status="APPROVED",
    )


def _boss(django_user_model, username, role_code, division):
    user = django_user_model.objects.create_user(username=username, password="x")
    role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": "Начальник пробы"})
    UserRole.objects.create(
        user_id=str(user.pk), role_code=role, scope_division_id=division.pk
    )
    return user


@pytest.fixture
def two_directorates(django_user_model):
    """Департамент, два управления с начальником у каждого и по человеку в
    каждом, оба назначены на ОДНО мероприятие и оба не подтвердили."""
    department = Division.objects.create(
        name="Департамент", code="DEP-REM", division_type=Division.DivisionType.DEPARTMENT
    )
    first = Division.objects.create(
        name="Управление А", code="DIR-REM-A",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    second = Division.objects.create(
        name="Управление Б", code="DIR-REM-B",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    ours = make_employee(first, last_name="Аширов")
    theirs = make_employee(second, last_name="Беков")
    event = _event(
        "ОМ-REM-1",
        [
            {"id": "a-1", "employeeId": str(ours.pk), "employeeName": "Аширов А.", "postId": "p-1"},
            {"id": "a-2", "employeeId": str(theirs.pk), "employeeName": "Беков Б.", "postId": "p-2"},
        ],
    )
    boss_a = _boss(django_user_model, "rem-boss-a", "REM_BOSS_A", first)
    boss_b = _boss(django_user_model, "rem-boss-b", "REM_BOSS_B", second)
    return event, boss_a, boss_b, ours, theirs


def _in_window():
    """Момент внутри окна «за час до заступления»."""
    start = timezone.make_aware(dt.datetime.combine(DAY, START))
    return start - dt.timedelta(minutes=40)


def _payload_of(user):
    return OpsNotification.objects.get(recipient=str(user.pk), kind=KIND).payload


def test_each_supervisor_gets_only_his_own_people(two_directorates):
    """🔴 Plane №665: список СВОИХ, а не всех задействованных.

    Одна полезная нагрузка со всеми неподтвердившими уходила ВСЕМ начальникам
    всех задействованных подразделений — то есть начальник управления А
    получал фамилии и идентификаторы личного состава управления Б. Комментарии
    модуля и модели обещали «список своих»; код обещание не выполнял.

    Мутация, которую стережёт проба: собрать одну нагрузку по всем `rows` и
    разослать её плоскому набору начальников — в списке каждого окажутся оба
    человека.
    """
    event, boss_a, boss_b, ours, theirs = two_directorates

    report = remind_supervisors_before_start(_in_window())

    assert report["events"] == 1 and report["unconfirmed"] == 2
    mine = {row["employeeId"] for row in _payload_of(boss_a)["unconfirmed"]}
    yours = {row["employeeId"] for row in _payload_of(boss_b)["unconfirmed"]}
    assert mine == {str(ours.pk)}, "начальнику управления А приехал чужой личный состав"
    assert yours == {str(theirs.pk)}, "начальнику управления Б приехал чужой личный состав"
    assert event.code == "ОМ-REM-1"


def test_the_supervisor_above_both_sees_both(two_directorates, django_user_model):
    """Начальник НАД обоими управлениями видит обоих — «свои» считаются по
    области, а не по совпадению подразделения.

    Без этой пробы правку №665 можно было бы «починить» сравнением в лоб
    (`division_id == scope`), и начальник департамента перестал бы получать
    хоть что-нибудь: он отвечает за поддерево, а не за узел.
    """
    event, _boss_a, _boss_b, ours, theirs = two_directorates
    department = Division.objects.get(code="DEP-REM")
    chief = _boss(django_user_model, "rem-chief", "REM_CHIEF", department)

    remind_supervisors_before_start(_in_window())

    both = {row["employeeId"] for row in _payload_of(chief)["unconfirmed"]}
    assert both == {str(ours.pk), str(theirs.pk)}
    assert event.stage == "ACKNOWLEDGEMENT"


def test_two_events_on_the_same_day_do_not_collapse_into_one(
    two_directorates, django_user_model
):
    """🔴 Plane №666: напоминание о ВТОРОМ мероприятии дня не проглатывается.

    Ключ «одно на (получателя, вид, деловую дату)» сталкивал напоминания
    разных ОМ: начальник узнавал только о первом, а `report['supervisors']`
    всё равно считал его уведомлённым — то есть отчёт утверждал доставку,
    которой не было.

    Мутация: убрать `dedupe_key=str(event.pk)` — второе напоминание не
    запишется, и обе проверки ниже покраснеют.
    """
    _event_one, boss_a, _boss_b, ours, _theirs = two_directorates
    second = _event(
        "ОМ-REM-2",
        [{"id": "b-1", "employeeId": str(ours.pk), "employeeName": "Аширов А.", "postId": "p-9"}],
    )

    report = remind_supervisors_before_start(_in_window())

    assert report["events"] == 2
    codes = {
        row.payload["eventCode"]
        for row in OpsNotification.objects.filter(recipient=str(boss_a.pk), kind=KIND)
    }
    assert codes == {"ОМ-REM-1", second.code}
    # Отчёт считает ДОШЕДШЕЕ: две строки — два уведомления этому начальнику.
    assert (
        OpsNotification.objects.filter(recipient=str(boss_a.pk), kind=KIND).count() == 2
    )


def test_a_repeated_run_in_the_same_window_adds_nothing(two_directorates):
    """Идемпотентность сохранена: свой ключ у одного и того же ОМ один и тот
    же, поэтому повтор в окне строк не создаёт.

    Проба стережёт мутацию `dedupe_key=None` («событие, никогда не
    схлопывается»), которой легко было бы «починить» №666: она развела бы
    мероприятия и заодно превратила каждый прогон движка в новую строку ленты.
    """
    _event_one, boss_a, _boss_b, _ours, _theirs = two_directorates

    remind_supervisors_before_start(_in_window())
    remind_supervisors_before_start(_in_window() + dt.timedelta(minutes=20))

    assert (
        OpsNotification.objects.filter(recipient=str(boss_a.pk), kind=KIND).count() == 1
    )
