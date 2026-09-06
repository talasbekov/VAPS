"""Уведомления начальникам управлений о запросе сил (Plane №392, `[СБС-22]`).

Спецификация: «„Отправить в управления“ → уведомления начальникам со
ссылкой». Получатель письма ПО УПРАВЛЕНИЮ — учётка с областью РОВНО на это
управление.

🔴 ОТВЕТСТВЕННЫЙ ЗА ДЕПАРТАМЕНТ ТЕПЕРЬ ТОЖЕ ПОЛУЧАЕТ — СВОДНОЕ ПИСЬМО
(Plane №922, решение заказчика 06.09.2026). Здесь стояло «свой же запрос не
получает», и пины ниже считали только письма по управлениям; после №922 к ним
добавляется одно письмо вида `FORCES_REQUEST_DEPARTMENT` на каждого, чья
область накрывает управления заявки, но не равна ни одному из них. Поэтому
`notified` в пробах на фикстуре `chain` больше НЕ равен числу оповещённых
управлений: в нём есть ещё сводное письмо ответственного.

Почему пины правлены, а не подогнаны. Прежнее поведение опиралось на довод
«он и так отправитель» — ревью (№922) показало, что довод говорит про
держателя `forces.allocate`, а исключал держателя `status.manage`: это разные
люди и разные права, и второй набрать людей за управление МОЖЕТ. Отдельный вид
письма понадобился потому, что ключ уведомления — (получатель, вид, деловая
дата): под общим видом ответственный получил бы ОДНУ строку про ПЕРВОЕ своё
управление и не узнал бы про остальные (замерено), а отчёт рапортовал бы
«уведомлено 3».
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
    DEPARTMENT_KIND,
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
        # +1 к прежнему числу — СВОДНОЕ письмо ответственного за департамент
    # (Plane №922): у него область над обоими управлениями заявки, и с
    # решения заказчика 06.09.2026 он получает одно письмо на департамент.
    assert report["notified"] == 2


def test_the_report_names_who_actually_got_it(chain):
    """Кому дошло — ПОИМЁННО, а не числом (Plane №921).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Соседние графы того же отчёта поимённые —
    `headlessDirectorates`, `withoutQuota`, `undelivered`, — и только
    доставленное было числом. Разбор «почему у нас никого не запросили»
    упирался в `notifiedHeads: 1`: неизвестно, дошло ли до НУЖНОГО человека, а
    у управления может быть несколько учёток с областью, и одна доставка —
    возможно, чужая.

    Подпись — та же, что у недоставленного («управление · учётка»): одна
    форма на обе графы, иначе читатель журнала ветвится (довод №825).

    Число рядом ОСТАЁТСЯ: «сколько» и «кому именно» — разные вопросы, и
    подменять первое вторым значило бы заставить читателя считать строки.

    КРАСНАЯ ПРОБА: убери `self.delivered.append(...)` в `DeliveryTally.deliver`
    — список опустеет, а число останется прежним.
    """
    event, allocation, directorates, head, officer, _watcher = chain

    report = notify_directorate_heads(event, allocation, directorates)

        # +1 к прежнему числу — СВОДНОЕ письмо ответственного за департамент
    # (Plane №922): у него область над обоими управлениями заявки, и с
    # решения заказчика 06.09.2026 он получает одно письмо на департамент.
    assert report["delivered"] == [
        f"Первое управление · {head.pk}",
        f"Департамент · {officer.pk}",
    ], report
    assert report["notified"] == len(report["delivered"])


def test_a_directorate_without_a_head_is_named_not_swallowed(chain):
    """Управление без начальника названо ПОИМЁННО в отчёте, а не потеряно."""
    event, allocation, directorates, _head, _officer, _watcher = chain

    report = notify_directorate_heads(event, allocation, directorates)

    assert report["headlessDirectorates"] == ["Второе управление"]


def test_a_global_grant_is_not_asked_to_select_for_every_directorate(chain, django_user_model):
    """Держатель права БЕЗ области не получает запрос по каждому управлению
    (Plane №922).

    🔴 ЧТО ЭТО ЗАКРЕПЛЯЕТ — И ПОЧЕМУ ЭТО НЕ ДЕФЕКТ. Гейт ручки считает грант
    без области ГЛОБАЛЬНЫМ, а грант на предка — накрывающим всё поддерево
    (`PermissionService.scope_matches`). Рассылка запроса сил читает область
    постоянных ролей ТОЧНО — и это осознанное сужение, а не отставание
    фильтра от гейта.

    Довод — в АДРЕСАТЕ, а не в том, кто нажал кнопку: рассылка спрашивает
    «кому ИСПОЛНЯТЬ запрос по ЭТОМУ управлению», и исполняет его тот, чья
    область — само управление. Глобальный грант — это штаб и админ: они делят
    раскладку целиком, а не набирают людей по каждому управлению; требование
    «Выделите N сотрудников» им не адресовано, а с ним они получили бы его по
    КАЖДОМУ управлению каждой заявки.

    Соседняя проба закрепляет ту же мысль для области на департамент. Вместе
    они и есть то правило раздела, которое ревью №922 приняло за отставание
    фильтра: расширение отбора на `scope_matches` краснит их обе.

    КРАСНАЯ ПРОБА: примени `scope_matches` к `UserRole` в `_directorate_heads`
    — глобальный держатель окажется в получателях.
    """
    from organization_management.apps.operations.models import UserRole

    event, allocation, directorates, _head, _officer, _watcher = chain
    everywhere = django_user_model.objects.create_user(
        username="fr-global", password="x"
    )
    # Роль с правом та же, что у начальника управления; отличие ровно одно —
    # области нет вовсе.
    UserRole.objects.create(
        user_id=str(everywhere.pk), role_code_id="FR_HEAD", scope_division_id=None
    )

    notify_directorate_heads(event, allocation, directorates)

    assert not OpsNotification.objects.filter(
        recipient=str(everywhere.pk), kind=KIND
    ).exists(), (
        "держатель права без области получил запрос «выделите N» — он делит "
        "раскладку, а не набирает людей по управлениям"
    )


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
        # +1 к прежнему числу — СВОДНОЕ письмо ответственного за департамент
    # (Plane №922): у него область над обоими управлениями заявки, и с
    # решения заказчика 06.09.2026 он получает одно письмо на департамент.
    assert report["notified"] == 2


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

    event, allocation, directorates, head, officer, _watcher = chain
    monkeypatch.setattr(
        forces_notify.notify_service, "notify", lambda *a, **kw: None
    )

    report = notify_directorate_heads(event, allocation, directorates)

    assert report["notified"] == 0
    # Недоставленное называет ОБОИХ: и письмо по управлению, и сводное письмо
    # ответственного за департамент (Plane №922). Пропусти сводное здесь — и
    # правило «считается доставленное, а не попытки» действовало бы только на
    # половину рассылки, а вторая молчала бы ровно так, как №561 запрещает.
    assert report["undelivered"] == [
        f"Первое управление · {head.pk}",
        f"Департамент · {officer.pk}",
    ]



# ─── Сводное письмо ответственному за департамент (Plane №922) ───────────────


def test_the_department_officer_gets_one_letter_about_all_his_directorates(chain):
    """🔴 Plane №922: ответственный за департамент получает СВОДНОЕ письмо.

    ЧТО БЫЛО. Рассылка требовала области РОВНО на управление, и держатель
    `status.manage` с областью на департамент не получал ничего — при том, что
    набрать людей за это управление он МОЖЕТ: `forces_directorate_select`
    гейтится тем же правом через `visible_division_ids`, а тот считает грант на
    предка накрывающим поддерево. Довод в коде («он и так отправитель») говорил
    про держателя `forces.allocate` — другого человека и другое право.

    ПОЧЕМУ НЕ ПРОСТО ДОБАВИЛИ ЕГО К ПИСЬМАМ ПО УПРАВЛЕНИЯМ. Ключ уведомления —
    (получатель, вид, деловая дата). Под общим видом он получил бы ОДНУ строку
    про ПЕРВОЕ управление и не узнал бы про остальные, а отчёт рапортовал бы
    «уведомлено 3» — замерено до правки. Полуправда хуже молчания: её не видно.

    Мутация: слать сводное тем же видом `KIND` — письмо схлопнется с письмом
    по управлению, и проба покраснеет на составе `directorates`.
    """
    event, allocation, directorates, _head, officer, _watcher = chain

    notify_directorate_heads(event, allocation, directorates)

    row = OpsNotification.objects.get(recipient=str(officer.pk), kind=DEPARTMENT_KIND)
    assert row.payload["directorateCount"] == 2, "сводка знает не про все управления"
    assert row.payload["need"] == 3, "сумма по управлениям (2 + 1) не сошлась"
    assert [d["name"] for d in row.payload["directorates"]] == [
        "Первое управление",
        "Второе управление",
    ], "состав управлений в сводке неполон — это та самая полуправда"
    # И письмо ПО УПРАВЛЕНИЮ ему не приходит: он не начальник управления, а
    # два письма об одном и том же — это шум, а не забота.
    assert not OpsNotification.objects.filter(
        recipient=str(officer.pk), kind=KIND
    ).exists()


def test_a_directorate_without_a_quota_is_not_in_the_summary(chain):
    """Управление без квоты в сводку не входит — то же правило, что и у писем
    по управлениям (Plane №557).

    Сводка отвечает на вопрос «сколько людей с вас просят и по скольким
    управлениям». Управление, которому ничего не назначили, в этом ответе
    участвовать не должно: иначе ответственный пойдёт искать несуществующий
    запрос — ровно та беда, ради которой №557 и вводилась.

    Мутация: считать сводку по всем `directorates` — `directorateCount`
    станет 2 вместо 1.
    """
    event, allocation, directorates, _head, officer, _watcher = chain
    rows = [directorates[0], {**directorates[1], "need": 0}]

    notify_directorate_heads(event, allocation, rows)

    row = OpsNotification.objects.get(recipient=str(officer.pk), kind=DEPARTMENT_KIND)
    assert row.payload["directorateCount"] == 1
    assert [d["name"] for d in row.payload["directorates"]] == ["Первое управление"]


def test_nobody_is_asked_when_no_directorate_has_a_quota(chain):
    """Ни одной квоты — ни одного письма, включая сводное.

    Обратная сторона предыдущей пробы, и без неё зелёным был бы код, который
    шлёт сводку «запрошено 0 человек по 0 управлениям». Такое письмо —
    требование, которого нет.
    """
    event, allocation, directorates, _head, officer, _watcher = chain
    rows = [{**row, "need": 0} for row in directorates]

    report = notify_directorate_heads(event, allocation, rows)

    assert report["notified"] == 0
    assert not OpsNotification.objects.filter(recipient=str(officer.pk)).exists()


def test_a_global_grant_gets_no_summary_either(chain, django_user_model):
    """Грант БЕЗ области сводного письма не получает (Plane №922).

    🔴 ЗАМЕР, А НЕ ОСТОРОЖНОСТЬ. Буквальное равенство с гейтом дало бы на живой
    базе 10 получателей вместо 3, и среди новых — три ADMIN, интеграционная
    учётка и оператор подразделения. «Может всё» не означает «отвечает за этот
    департамент», а требование выделить людей адресуют тому, кто отвечает.
    Заказчик выбрал поддерево БЕЗ глобальных грантов.

    Мутация: убрать `scope_division_id__isnull=False` из `_department_heads_
    over` — админ получит сводку по каждому департаменту в системе.
    """
    event, allocation, directorates, _head, _officer, _watcher = chain
    role = Role.objects.get(code="FR_HEAD")
    admin = django_user_model.objects.create_user(username="fr-global", password="x")
    UserRole.objects.create(user_id=str(admin.pk), role_code=role, scope_division_id=None)

    notify_directorate_heads(event, allocation, directorates)

    assert not OpsNotification.objects.filter(recipient=str(admin.pk)).exists(), (
        "держатель гранта без области получил требование выделить людей"
    )

# ─── Дежурный по управлению тоже получает запрос (Plane №800) ────────────────


@pytest.fixture
def duty_role():
    """Роль дежурства с тем же правом, под которым управление выделяет людей.

    Код взят из `DUTY_ROLE_CHOICES` — `duty_role_code` их и хранит, — а право
    выдано через `RolePermission`: именно так `PermissionService._active_grants`
    и превращает дежурство в набор прав, никакой отдельной таблицы у дежурств
    нет.
    """
    role = Role.objects.create(code="HQ_DUTY", name="Дежурный по штабу (проба)")
    Permission.objects.get_or_create(
        code=SELECT_PERMISSION, defaults={"name": "Статусы: управление"}
    )
    RolePermission.objects.create(role_code=role, permission_code_id=SELECT_PERMISSION)
    return role


def _duty(user, division_id, role_code, moment, *, offset_hours=1):
    from organization_management.apps.operations.models import TemporaryDutyPermission

    return TemporaryDutyPermission.objects.create(
        user_id=str(user.pk),
        duty_role_code=role_code,
        # `None` — грант БЕЗ области: гейт считает такой глобальным (Plane №882).
        scope_division_id=None if division_id is None else int(division_id),
        starts_at=moment - dt.timedelta(hours=offset_hours),
        ends_at=moment + dt.timedelta(hours=offset_hours),
        created_by="test",
    )


def test_the_duty_officer_is_notified_alongside_the_permanent_head(
    chain, duty_role, django_user_model
):
    """🔴 Plane №800: получатели берутся из ОБОИХ источников грантов.

    Права в разделе приходят из двух таблиц — постоянных ролей (`UserRole`) и
    временных дежурств (`TemporaryDutyPermission`), и `_active_grants`
    перечисляет обе. Рассылка читала только первую: заступивший дежурным по
    управлению ВЫДЕЛИТЬ людей мог (гейт ручки пропускал его по дежурному
    гранту), а требования «Выделите N сотрудников» не получал — запрос уходил
    постоянному начальнику, которого в этот момент может не быть на месте.

    Заказчик 06.09.2026 выбрал «слать ОБОИМ», поэтому проверяется именно пара,
    а не подмена: постоянный начальник уведомление не теряет.

    Красная мутация: убрать ветку `TemporaryDutyPermission` из
    `_directorate_heads` — `notified` станет 1, а строки дежурного не будет.
    """
    from organization_management.apps.operations import clock

    event, allocation, directorates, head, _officer, _watcher = chain
    duty = django_user_model.objects.create_user(username="fr-duty", password="x")
    moment = dt.datetime(2026, 9, 19, 10, 0, tzinfo=dt.timezone.utc)
    _duty(duty, directorates[0]["divisionId"], duty_role.code, moment)

    with clock.override(moment):
        report = notify_directorate_heads(event, allocation, directorates)

        # +1 — СВОДНОЕ письмо ответственного за департамент (Plane №922):
    # его область накрывает управления заявки, и с решения заказчика
    # 06.09.2026 он получает одно письмо на департамент.
    assert report["notified"] == 3
    assert OpsNotification.objects.filter(recipient=str(head.pk), kind=KIND).exists()
    assert OpsNotification.objects.filter(recipient=str(duty.pk), kind=KIND).exists()


def test_a_duty_outside_its_window_is_not_notified(chain, duty_role, django_user_model):
    """Окно дежурства короче суток, и рассылка спрашивает «кто может СЕЙЧАС».

    Тот же вопрос, что задаёт гейт ручки в тот же момент: дежурство, которое
    ещё не началось или уже кончилось, прав не даёт — значит и требования
    выделить людей получать не должно. Иначе `notifiedHeads` в аудите снова
    перестал бы отвечать на вопрос «кого на самом деле попросили».

    Красная мутация: убрать `starts_at__lte` / `ends_at__gte` из фильтра —
    `notified` станет 2.
    """
    from organization_management.apps.operations import clock

    event, allocation, directorates, head, _officer, _watcher = chain
    duty = django_user_model.objects.create_user(username="fr-duty-past", password="x")
    moment = dt.datetime(2026, 9, 19, 10, 0, tzinfo=dt.timezone.utc)
    _duty(duty, directorates[0]["divisionId"], duty_role.code, moment)

    # Дежурство кончилось два часа назад: окно ±1 час вокруг `moment`.
    with clock.override(moment + dt.timedelta(hours=2)):
        report = notify_directorate_heads(event, allocation, directorates)

        # +1 — СВОДНОЕ письмо ответственного за департамент (Plane №922):
    # его область накрывает управления заявки, и с решения заказчика
    # 06.09.2026 он получает одно письмо на департамент.
    assert report["notified"] == 2
    assert OpsNotification.objects.filter(recipient=str(head.pk), kind=KIND).exists()
    assert not OpsNotification.objects.filter(recipient=str(duty.pk), kind=KIND).exists()


def test_a_duty_without_the_select_permission_is_not_notified(
    chain, django_user_model
):
    """Фильтр по ПРАВУ (Plane №481) распространяется и на дежурства.

    Дежурство — такой же источник грантов, как роль, и слабее её быть не
    обязано: дежурный без права выделять людей получил бы требование, которое
    физически не может выполнить, — ровно та беда, что чинилась в №481, только
    зашедшая со второго входа.

    Красная мутация: убрать `duty_role_code__in=roles` из фильтра дежурств —
    `notified` станет 2.
    """
    from organization_management.apps.operations import clock

    event, allocation, directorates, _head, _officer, _watcher = chain
    idle = Role.objects.create(code="OMD", name="ОМД без права (проба)")
    duty = django_user_model.objects.create_user(username="fr-duty-idle", password="x")
    moment = dt.datetime(2026, 9, 19, 10, 0, tzinfo=dt.timezone.utc)
    _duty(duty, directorates[0]["divisionId"], idle.code, moment)

    with clock.override(moment):
        report = notify_directorate_heads(event, allocation, directorates)

        # +1 — СВОДНОЕ письмо ответственного за департамент (Plane №922):
    # его область накрывает управления заявки, и с решения заказчика
    # 06.09.2026 он получает одно письмо на департамент.
    assert report["notified"] == 2
    assert not OpsNotification.objects.filter(recipient=str(duty.pk), kind=KIND).exists()


def test_a_duty_scoped_to_the_department_is_notified_too(
    chain, duty_role, django_user_model
):
    """Область дежурства читается так же, как её читает ГЕЙТ (Plane №882).

    🔴 НАЙДЕНО РЕВЮ. Первая редакция №800 брала дежурства точным совпадением
    области с управлением, а `PermissionService._scope_matches` накрывает
    управления через ПРЕДКА: грант на департамент проходит на все его
    управления (`subtree_ids`). Значит дежурный по департаменту выделить людей
    мог, а «Выделите N сотрудников» не получал — то самое расхождение, которое
    карточка объявляла закрытым. Фильтр строже гейта — не «осторожнее», а
    другая беда с тем же симптомом.

    Красная мутация: вернуть `scope_division_id__in=ids` — дежурный по
    департаменту исчезнет из получателей, `notified` станет 1.
    """
    from organization_management.apps.operations import clock

    event, allocation, directorates, head, officer, _watcher = chain
    duty = django_user_model.objects.create_user(username="fr-duty-dep", password="x")
    moment = dt.datetime(2026, 9, 19, 10, 0, tzinfo=dt.timezone.utc)
    # Область — ДЕПАРТАМЕНТ, а запрос адресован его управлению.
    department_id = UserRole.objects.get(user_id=str(officer.pk)).scope_division_id
    _duty(duty, department_id, duty_role.code, moment)

    with clock.override(moment):
        report = notify_directorate_heads(event, allocation, directorates)

    assert OpsNotification.objects.filter(recipient=str(duty.pk), kind=KIND).exists()
    # 🔴 СЛЕДСТВИЕ, КОТОРОЕ СТОИТ НАЗВАТЬ: область на департамент накрывает ОБА
    # его управления, и второе — то, у которого постоянного начальника нет
    # вовсе, — перестаёт быть «без адресата». Раньше оно уходило в
    # `headlessDirectorates` и запрос по нему не получал НИКТО.
    assert report["headlessDirectorates"] == []
    # Трижды: начальник первого управления и дежурный по каждому из двух.
    # Строка уведомления у дежурного при этом ОДНА — ключ «получатель, вид,
    # деловая дата» схлопывает их; счётчик считает удачные доставки, а не
    # людей, и это его давнее свойство (см. №561), а не следствие этой правки.
        # +1 — СВОДНОЕ письмо ответственного за департамент (Plane №922):
    # его область накрывает управления заявки, и с решения заказчика
    # 06.09.2026 он получает одно письмо на департамент.
    assert report["notified"] == 4


def test_a_duty_without_a_scope_is_notified_too(chain, duty_role, django_user_model):
    """Грант БЕЗ области гейт считает глобальным — рассылка обязана тоже.

    `_scope_matches` при `scope_division_id is None` возвращает `True` для
    любого подразделения. Поле у дежурства nullable, то есть такой грант
    достижим, а не выдуман.

    Красная мутация: вернуть `scope_division_id__in=ids` — `None` в список не
    попадёт, и дежурный снова выпадет из получателей.
    """
    from organization_management.apps.operations import clock

    event, allocation, directorates, head, _officer, _watcher = chain
    duty = django_user_model.objects.create_user(username="fr-duty-any", password="x")
    moment = dt.datetime(2026, 9, 19, 10, 0, tzinfo=dt.timezone.utc)
    _duty(duty, None, duty_role.code, moment)

    with clock.override(moment):
        report = notify_directorate_heads(event, allocation, directorates)

    # Глобальный грант накрывает ОБА управления заявки, но у второго нет квоты
    # начальника — уведомление уходит только по управлению с квотой.
    assert OpsNotification.objects.filter(recipient=str(duty.pk), kind=KIND).exists()
    assert report["notified"] >= 2
