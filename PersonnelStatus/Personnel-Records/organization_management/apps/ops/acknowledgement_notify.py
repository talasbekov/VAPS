"""Уведомления о заступлении на ОМ (Plane №243).

СЦЕНАРИЙ ЗАКАЗЧИКА, дословно: «дальше этап ознакомление сотрудников
заступающие на ОМ по объекту КНОПКОЙ можно отправить уведомления И ИХ
РУКОВОДИТЕЛИ ТОЖЕ ПОЛУЧАЮТ УВЕДОМЛЕНИЯ».

Ни ручки, ни вида уведомления под это не было: в справочнике жил единственный
вид — «Отставание по сдаче». Заводится второй.

КТО ТАКОЙ «РУКОВОДИТЕЛЬ» — решение, а не догадка. Прямой ссылки «сотрудник →
начальник» в системе нет вовсе. Зато есть область ответственности: роль
назначается учётке СО ОБЛАСТЬЮ (`UserRole.scope_division_id`), и человек,
отвечающий за подразделение сотрудника или за любое подразделение НАД ним,
и есть тот, кому положено знать о заступлении своего подчинённого. Это
работает и для начальника управления, и для ответственного департамента, и
не требует заводить новую связь ради одного уведомления.

ОГРАНИЧЕНИЕ, КОТОРОЕ НАДО ЗНАТЬ. Уведомление адресуется УЧЁТКЕ, а связь
«учётка → кадровая запись» заполняется руками (см. `MyEmployeeViewSet`).
Сотрудник без такой связи уведомления не получит — и рассылка честно
считает его в «не дошло», а не молчит.

«ОДНО НА ДЕНЬ» — ключ модели уведомлений (получатель, вид, деловая дата).
Человек, заступающий в один день на два мероприятия, получит одно
уведомление: повтор не создаётся, побеждает первый payload. Это осознанно —
модель так устроена ради догона отставших, — и потому в payload кладётся код
мероприятия: по нему видно, о каком именно заступлении речь.
"""
from django.db import transaction

from organization_management.apps.operations import notify_service
from organization_management.apps.operations.exceptions import DomainError

#: Вид уведомления. Заведён в модели вместе с этим срезом.
KIND = "EVENT_ACKNOWLEDGEMENT"


def _employee_users(employee_ids):
    """Учётки сотрудников: {employee_id → user_id} (только связанные)."""
    from organization_management.apps.employees.models import Employee

    return {
        str(row["id"]): str(row["user_id"])
        for row in Employee.objects.filter(
            id__in=employee_ids, user__isnull=False
        ).values("id", "user_id")
    }


def _division_of(employee_ids):
    """Подразделение сотрудника — через ШТАТНЫЙ СЛОТ: прямой ссылки у карточки
    нет, человек стоит там, где занимает слот."""
    from organization_management.apps.staff_unit.models import StaffUnit

    return {
        str(row["employee_id"]): row["division_id"]
        for row in StaffUnit.objects.filter(
            employee_id__in=employee_ids, employee__isnull=False
        ).values("employee_id", "division_id")
    }


def _supervisor_users(division_ids):
    """Учётки, отвечающие за подразделение или за любое НАД ним.

    Область роли задаётся узлом, а отвечает он и за его потомков — поэтому
    берутся предки подразделения ВМЕСТЕ с ним самим.
    """
    return set().union(*supervisors_by_division(division_ids).values()) if division_ids else set()


def supervisors_by_division(division_ids):
    """{подразделение → учётки, отвечающие за него}: КТО за КОГО (Plane №665).

    🔴 ЗАЧЕМ РАЗРЕЗ, ЕСЛИ ЕСТЬ ПЛОСКИЙ НАБОР. Плоский отвечает на вопрос «кому
    вообще слать» и потому годится там, где полезная нагрузка одна на всех —
    например, «подчинённый заступает» с именем ОДНОГО человека. Но у
    напоминания за час нагрузка СПИСОЧНАЯ, и плоский набор превращал её в
    рассылку списка личного состава управления А начальнику управления Б: имена
    и идентификаторы чужих людей. Разрез позволяет собрать каждому его
    собственный список.

    Область роли задаётся узлом, а отвечает он и за его потомков — поэтому у
    подразделения берутся предки ВМЕСТЕ с ним самим, как и в плоском наборе.
    Один начальник может отвечать за несколько подразделений сразу; он
    появится в нескольких строках разреза, и его личный список склеится из
    них — это и есть «свои».
    """
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.operations.models import UserRole

    if not division_ids:
        return {}
    scopes_of = {}
    all_scopes = set()
    for division in Division.objects.filter(id__in=division_ids):
        scopes = {division.pk, *division.get_ancestors().values_list("id", flat=True)}
        scopes_of[division.pk] = scopes
        all_scopes |= scopes
    users_of_scope = {}
    for scope_id, user_id in UserRole.objects.filter(
        is_active=True, scope_division_id__in=all_scopes
    ).values_list("scope_division_id", "user_id"):
        users_of_scope.setdefault(scope_id, set()).add(str(user_id))
    return {
        division_id: set().union(
            *(users_of_scope.get(scope, set()) for scope in scopes), set()
        )
        for division_id, scopes in scopes_of.items()
    }


@transaction.atomic
def notify_acknowledgement(event_id):
    """Разослать уведомления о заступлении: назначенным и их руководителям.

    Возвращает отчёт: кому ушло, скольким не дошло и почему. Это не
    украшение — рассылка, которая молчит о недоставленном, выглядит как
    успешная, и человек узнаёт о пропаже в день мероприятия.

    Мероприятие блокируется ЗДЕСЬ: `lock_event` берёт `SELECT … FOR UPDATE`,
    а он требует транзакции. Вьюха, звавшая блокировку сама, отвечала бы 500
    `TransactionManagementError` — и юнит-тесты этого не увидели бы, потому
    что `django_db` заворачивает каждый тест в транзакцию (наступали на это в
    Plane №215).

    Запись уведомлений тоже идёт В ЭТОЙ транзакции — так устроен
    `notify_service`: уведомление живёт вместе с фактом, о котором сообщает.
    """
    from organization_management.apps.ops.security_events import lock_event

    event = lock_event(event_id)
    if event.stage != "ACKNOWLEDGEMENT":
        raise DomainError(
            "ACKNOWLEDGEMENT_STAGE_REQUIRED",
            422,
            message=(
                "Уведомления о заступлении рассылаются на этапе "
                "«Ознакомление»."
            ),
        )
    assignments = event.placement_assignments or []
    if not assignments:
        raise DomainError(
            "PLACEMENT_EMPTY",
            422,
            message="На мероприятие никто не назначен — уведомлять некого.",
        )

    employee_ids = [
        str(row.get("employeeId"))
        for row in assignments
        if row.get("employeeId") is not None
    ]
    users = _employee_users(employee_ids)
    divisions = _division_of(employee_ids)
    supervisors = _supervisor_users(set(divisions.values()))

    payload = {
        "eventId": str(event.pk),
        "eventCode": event.code,
        "eventTitle": event.title,
        "businessDate": event.business_date.isoformat(),
        "objectName": event.object_name,
    }
    sent, unlinked = set(), []
    for employee_id in employee_ids:
        user_id = users.get(employee_id)
        if user_id is None:
            unlinked.append(employee_id)
            continue
        notify_service.notify(user_id, KIND, event.business_date, payload)
        sent.add(user_id)
    # Руководителю уведомление идёт ОДНО на день, как и всем: он и так
    # получит его о своём подчинённом, а второе о втором — нет (ключ модели).
    for user_id in supervisors - sent:
        notify_service.notify(
            user_id, KIND, event.business_date, {**payload, "asSupervisor": True}
        )
    return {
        "notified": len(sent) + len(supervisors - sent),
        "employees": len(sent),
        "supervisors": len(supervisors - sent),
        # Поимённо, а не числом: «двоим не дошло» не говорит, кому именно, и
        # чинить это некому.
        "unlinkedEmployeeIds": unlinked,
    }
