"""Уведомления начальникам управлений о запросе сил (Plane №392, `[СБС-22]`).

Спецификация: «„Отправить в управления“ → уведомления начальникам со
ссылкой». Получатель — учётка с областью РОВНО на управление; ответственный
за департамент (область выше) свой же запрос не получает.
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.ops.forces_notify import (
    KIND,
    SELECT_PERMISSION,
    notify_directorate_heads,
)

pytestmark = pytest.mark.django_db

DAY = dt.date(2026, 9, 20)


@pytest.fixture
def chain(django_user_model):
    """Департамент с двумя управлениями; у первого есть начальник, у второго
    нет; у департамента — ответственный (область департамента)."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    department = Division.objects.create(
        name="Департамент", code="DEP-FR", division_type=Division.DivisionType.DEPARTMENT
    )
    first = Division.objects.create(
        name="Первое управление", code="DIR-FR-1",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    second = Division.objects.create(
        name="Второе управление", code="DIR-FR-2",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    # 🔴 РОЛЬ НАЧАЛЬНИКА НЕСЁТ ПРАВО, А НЕ ТОЛЬКО ИМЯ (Plane №481). До правки
    # фильтр смотрел на одну область, и роль без прав получала рассылку так
    # же, как настоящий начальник, — то есть проба зеленела бы и на дефекте.
    role = Role.objects.create(code="FR_HEAD", name="Начальник пробы")
    Permission.objects.get_or_create(
        code=SELECT_PERMISSION, defaults={"name": "Статусы: управление"}
    )
    RolePermission.objects.create(role_code=role, permission_code_id=SELECT_PERMISSION)
    head = django_user_model.objects.create_user(username="fr-head", password="x")
    UserRole.objects.create(user_id=str(head.pk), role_code=role, scope_division_id=first.pk)
    officer = django_user_model.objects.create_user(username="fr-officer", password="x")
    UserRole.objects.create(
        user_id=str(officer.pk), role_code=role, scope_division_id=department.pk
    )
    # Наблюдатель в ТОМ ЖЕ управлении: область та же, права выделять нет.
    watcher_role = Role.objects.create(code="FR_WATCHER", name="Наблюдатель пробы")
    watcher = django_user_model.objects.create_user(username="fr-watcher", password="x")
    UserRole.objects.create(
        user_id=str(watcher.pk), role_code=watcher_role, scope_division_id=first.pk
    )
    event = OpsSecurityEvent.objects.create(
        code="ОМ-FR-1", title="Проба запроса сил", object_name="Объект",
        business_date=DAY, stage="PLACEMENT", readiness_percent=0, force_need=3,
        conflicts_count=0, owner_name="Ведущий", recon_checklist=[],
        recon_sector_posts=[], demand_rows=[], demand_approved=True,
        placement_assignments=[], force_requests=[], journal_entries=[],
        closure_direction_summaries=[], approval_status="PENDING",
    )
    allocation = {
        "id": "force-allocation-1", "departmentId": str(department.pk),
        "departmentName": "Департамент", "need": 3, "dueAt": "2026-09-19T00:00:00+05:00",
    }
    directorates = [
        {"divisionId": str(first.pk), "name": "Первое управление", "need": 2},
        {"divisionId": str(second.pk), "name": "Второе управление", "need": 1},
    ]
    return event, allocation, directorates, head, officer, watcher


def test_the_directorate_head_is_notified_with_the_request(chain):
    """Начальник управления получает запрос с кодом ОМ, цифрой и заявкой.

    Красная на мутации: убери вызов `notify_service.notify` — строки не будет.
    """
    event, allocation, directorates, head, _officer, _watcher = chain

    report = notify_directorate_heads(event, allocation, directorates)

    row = OpsNotification.objects.get(recipient=str(head.pk), kind=KIND)
    assert row.payload["eventCode"] == "ОМ-FR-1"
    assert row.payload["need"] == 2
    assert row.payload["allocationId"] == "force-allocation-1"
    assert row.business_date == DAY
    assert report["notified"] == 1


def test_a_directorate_without_a_head_is_named_not_swallowed(chain):
    """Управление без начальника названо ПОИМЁННО в отчёте, а не потеряно."""
    event, allocation, directorates, _head, _officer, _watcher = chain

    report = notify_directorate_heads(event, allocation, directorates)

    assert report["headlessDirectorates"] == ["Второе управление"]


def test_the_department_officer_does_not_get_his_own_request(chain):
    """Область департамента — выше управления; свой запрос ответственному не
    шлётся: он его и отправил. Это отличие от заступления, где уведомляются
    все уровни над сотрудником."""
    event, allocation, directorates, _head, officer, _watcher = chain

    notify_directorate_heads(event, allocation, directorates)

    assert not OpsNotification.objects.filter(recipient=str(officer.pk), kind=KIND).exists()


def test_the_kind_is_known_to_the_database(chain):
    """Словарь видов держит БД: без миграции 0074 запись отбилась бы
    ограничением, а не `choices`."""
    event, allocation, directorates, head, _officer, _watcher = chain

    notify_directorate_heads(event, allocation, directorates)

    assert OpsNotification.objects.filter(recipient=str(head.pk), kind="FORCES_REQUEST").exists()


def test_only_those_who_can_select_are_asked_to_select(chain):
    """🔴 НАБЛЮДАТЕЛЬ УПРАВЛЕНИЯ НЕ ПОЛУЧАЕТ «ВЫДЕЛИТЕ N СОТРУДНИКОВ» (№481).

    Докстрока обещала «учётки с областью РОВНО на управление», и фильтр по
    области был, а по ПРАВУ — нет: под рассылку попадала любая активная роль с
    этой областью. Человек получал требование, которое физически не может
    выполнить — экран ему закрыт, — а поле `notifiedHeads` в аудите переставало
    отвечать на вопрос «кого на самом деле попросили»: разбор «почему не
    выделили» уходил по ложному следу.

    Красная на мутации «снять фильтр по праву»: наблюдатель получает строку.
    """
    event, allocation, directorates, head, _officer, watcher = chain

    report = notify_directorate_heads(event, allocation, directorates)

    assert OpsNotification.objects.filter(recipient=str(head.pk), kind=KIND).exists()
    assert not OpsNotification.objects.filter(
        recipient=str(watcher.pk), kind=KIND
    ).exists(), "наблюдателя попросили выделить людей, а выделять он не может"
    # Счёт уведомлённых — тоже про тех, кто может: он идёт в аудит, и лишние
    # получатели раздували бы его молча.
    assert report["notified"] == 1


# ── Ревью 911ebfae: кому НЕ шлём и что записываем (Plane №557, №561) ────────


def test_a_directorate_without_a_quota_is_not_asked_for_zero(chain):
    """🔴 Plane №557: «Выделите 0 сотрудников» не рассылается.

    Рассылка шла по ВСЕМ действующим управлениям департамента, а `need` по
    умолчанию ноль — начальники управлений, которым ничего не назначили,
    получали требование, которое нечем выполнить. Хуже, чем шум: ключ
    уведомления — «получатель, вид, деловая дата», поэтому пустышка
    ПЕРЕКРЫВАЛА настоящий запрос, если департамент в тот же день раскладывал
    квоту и рассылал заново. Одно ошибочное нажатие глушило рассылку до
    завтра.

    Мутация: убрать проверку `need <= 0` — начальник получит строку с
    `need == 0`, и проба покраснеет на обоих ассертах.
    """
    event, allocation, directorates, head, _officer, _watcher = chain
    zeroed = [{**row, "need": 0} for row in directorates]

    report = notify_directorate_heads(event, allocation, zeroed)

    assert not OpsNotification.objects.filter(recipient=str(head.pk), kind=KIND).exists()
    assert report["notified"] == 0
    # Не «без начальника»: начальник есть, просто звать его не с чем — и
    # разбор «почему нам не сказали» должен видеть настоящую причину.
    assert report["withoutQuota"] == ["Первое управление", "Второе управление"]
    assert report["headlessDirectorates"] == []


def test_the_zero_row_does_not_shadow_the_real_request_of_the_same_day(chain):
    """Та же беда с другого конца (Plane №557): пустышка и настоящий запрос.

    «Одно уведомление на (получателя, вид, деловую дату)» означает, что
    ПЕРВАЯ полезная нагрузка побеждает. Значит нажатие до раскладки и нажатие
    после неё в один день давали начальнику ноль навсегда.

    Мутация та же: убрать проверку `need <= 0` — в базе останется `need == 0`.
    """
    event, allocation, directorates, head, _officer, _watcher = chain

    notify_directorate_heads(event, allocation, [{**row, "need": 0} for row in directorates])
    notify_directorate_heads(event, allocation, directorates)

    row = OpsNotification.objects.get(recipient=str(head.pk), kind=KIND)
    assert row.payload["need"] == 2


def test_a_swallowed_failure_is_not_counted_as_delivered(chain, monkeypatch):
    """🔴 Plane №561: считается доставленное, а не попытки.

    `notify_service.notify` по замыслу глотает любое исключение и возвращает
    `None`, а счётчик рос безусловно: при отказе вставки для всех получателей
    журнал аудита писал `notifiedHeads: N` и пустой список недоставленного —
    то есть утверждал доставку, которой не было. Модуль заведён ровно против
    этого («рассылка, которая молчит о недоставленном»).

    Мутация: вернуть безусловное `notified += 1` — `notified` станет 1, а
    `undelivered` пустым.
    """
    from organization_management.apps.ops import forces_notify

    event, allocation, directorates, head, _officer, _watcher = chain
    monkeypatch.setattr(
        forces_notify.notify_service, "notify", lambda *a, **kw: None
    )

    report = notify_directorate_heads(event, allocation, directorates)

    assert report["notified"] == 0
    assert report["undelivered"] == [f"Первое управление · {head.pk}"]
