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
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.ops.acknowledgement_notify import SUPERVISE_PERMISSION
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


def _boss(django_user_model, username, role_code, division, *, may_supervise=True):
    """Начальник с областью на подразделение.

    🔴 ПРАВО ВЫДАЁТСЯ ЯВНО (Plane №880). До правки роль в фикстуре была
    пустой — и этого хватало, потому что рассылка смотрела ОДНУ область.
    Теперь она смотрит и право, поэтому «начальник» без права получателем не
    считается; `may_supervise=False` заводит ровно такую учётку — ею и
    проверяется, что фильтр работает.
    """
    user = django_user_model.objects.create_user(username=username, password="x")
    role, _ = Role.objects.get_or_create(code=role_code, defaults={"name": "Начальник пробы"})
    if may_supervise:
        permission, _ = Permission.objects.get_or_create(
            code=SUPERVISE_PERMISSION, defaults={"name": "Распоряжаться личным составом"}
        )
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
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


def test_a_role_without_the_right_gets_no_names(two_directorates, django_user_model):
    """🔴 Plane №880: поимённый список уходит по ПРАВУ, а не по одной области.

    Фильтр по области был, по праву — не было вовсе, и «своими» людей считала
    любая активная роль с областью над подразделением. Замер на живой базе до
    правки: список получали 10 учёток, среди них роль `EMPLOYEE` (обычный
    сотрудник) и два наблюдателя. Нагрузка здесь СПИСОЧНАЯ — фамилии и
    идентификаторы, — так что после №665 утечка сузилась, но не исчезла:
    чужой состав перестал уезжать, свой уезжал слишком широкому кругу.

    Проба заводит наблюдателя с областью РОВНО на то же управление, что и
    начальник: у него всё то же самое, кроме права. Именно поэтому она
    отличает «отбор по праву» от «отбор по области» — на любой другой паре
    учёток обе версии кода вели бы себя одинаково.

    Мутация: убрать `role_code_id__in=roles` из запроса — наблюдатель получит
    фамилии, и проба покраснеет.
    """
    event, boss_a, _boss_b, ours, _theirs = two_directorates
    watcher = _boss(
        django_user_model,
        "rem-watcher",
        "REM_WATCHER",
        Division.objects.get(code="DIR-REM-A"),
        may_supervise=False,
    )

    remind_supervisors_before_start(_in_window())

    assert not OpsNotification.objects.filter(
        recipient=str(watcher.pk), kind=KIND
    ).exists(), "наблюдателю без права приехал поимённый список личного состава"
    # Вторая половина обязательна: без неё зелёным был бы и код, который не
    # рассылает вовсе. Начальник с правом и той же областью список получает.
    assert {row["employeeId"] for row in _payload_of(boss_a)["unconfirmed"]} == {
        str(ours.pk)
    }
    assert event.code == "ОМ-REM-1"


def test_the_one_who_refused_is_not_on_the_call_list(two_directorates):
    """🔴 Plane №884: отказавшийся — не неподтвердивший.

    `_unconfirmed` фильтровал только по `acknowledgedAt is None`, и в список
    «кому звонить за час до заступления» попадал человек, уже сказавший «не
    могу заступить». Начальник тратил бы час на того, кого положено ЗАМЕНИТЬ.

    Правило здесь не изобретено: соседний `acknowledgement_stage._pending`
    держит его прямым текстом с №616, и одиночная ручка напоминания отбивает
    отказ ошибкой `ALREADY_DECLINED`. Из трёх путей раздела правило соблюдали
    два — поведение зависело от того, каким путём до системы дошли.

    Мутация: снять `and a.get("declinedAt") is None` — отказавшийся снова
    окажется в списке своего начальника, а `unconfirmed` станет 2.
    """
    event, boss_a, boss_b, ours, theirs = two_directorates
    # Отказ ровно у ОДНОГО из двоих: второй остаётся неподтвердившим и
    # проверяет, что правило не выкосило рассылку целиком. Без него зелёным
    # был бы и код, который не шлёт напоминаний вовсе.
    rows = list(event.placement_assignments)
    rows[1] = {**rows[1], "declinedAt": "2026-08-21T06:00:00+05:00"}
    event.placement_assignments = rows
    event.save(update_fields=["placement_assignments"])

    report = remind_supervisors_before_start(_in_window())

    assert report["unconfirmed"] == 1, (
        "отказавшийся посчитан неподтвердившим — начальника пошлют его уговаривать"
    )
    mine = {row["employeeId"] for row in _payload_of(boss_a)["unconfirmed"]}
    assert mine == {str(ours.pk)}, "напоминание о своём человеке пропало вместе с чужим отказом"
    assert not OpsNotification.objects.filter(
        recipient=str(boss_b.pk), kind=KIND
    ).exists(), "начальнику отказавшегося пришло напоминание, хотя напоминать не о ком"


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


def test_a_swallowed_failure_is_not_counted_as_a_notified_supervisor(
    two_directorates, monkeypatch
):
    """🔴 ОТЧЁТ СЧИТАЛ УВЕДОМЛЁННЫМ ТОГО, КОМУ НЕ ДОШЛО (Plane №666, вторая
    половина карточки; найдено ревью №825).

    `notify_service.notify` по замыслу глотает любое исключение и возвращает
    `None`. Счёт в коде уже честный, но мутация «вернуть безусловное
    `notified += 1`» переживала все четыре пробы файла: они считают строки в
    базе, а поля отчёта не читает ни одна.

    Цена этого — не абстрактная. `report["supervisors"]` печатает команда
    планировщика `remind_unconfirmed_acknowledgements`, и это ЕДИНСТВЕННАЯ
    поверхность, по которой видно, работает ли рассылка вообще. При
    безусловном инкременте лог остаётся зелёным на полностью мёртвой
    рассылке — то есть возвращается ровно дефект №666.

    Тот же приём, что у соседней рассылки после №561
    (`test_ops_forces_notify.py::test_a_swallowed_failure_is_not_counted_as_delivered`).
    """
    from organization_management.apps.ops import acknowledgement_reminders

    monkeypatch.setattr(
        acknowledgement_reminders.notify_service, "notify", lambda *a, **kw: None
    )

    report = remind_supervisors_before_start(_in_window())

    assert report["unconfirmed"] == 2, "рассылать было нечего — проба вакуумна"
    assert report["supervisors"] == 0, (
        "отчёт считает уведомлённым того, кому уведомление не дошло"
    )
