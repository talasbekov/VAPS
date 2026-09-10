"""«Расход дня» раздела ОМ (/api/ops/daily/*) — ТОНКИЕ АДАПТЕРЫ поверх
живого функционала /api/operations/.

Своего бэка у этого экрана НЕТ НАМЕРЕННО (план: группа L «не строить —
дубликат»): статусы, сдача дня и поправка уже живут в bulk_status_service /
day_submission_service, и вторая реализация тех же правил разошлась бы с
первой. Здесь только адресация и ФОРМА контракта клиента (entities/
daily-grid): подразделения и сотрудники — строковыми id, сдача — проекцией
со строковым division_id и человекочитаемой подписью сдавшего (поля — те же,
что у `OpsDailySubmissionSerializer` раздела `/api/operations/`: это ОДНА
модель, и два представления одной строки обязаны совпадать полями), список
сдач — ВСЕ версии дня (история решает экран по is_current).

Тот же приём, что /api/ops/audit-logs (поверх живого журнала) и
/api/ops/personnel (поверх живых Employee).
"""
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
)
from organization_management.apps.operations.services import PermissionService


def visible_division_rows(actor_id, permission_code, submit_permission_code=None, business_date=None):
    """Подразделения области актора: [{id: str, name, ancestors, can_submit,
    last_submitted_at}] по имени.

    `can_submit` — правда ли АКТОР сдаёт день ЗА ЭТО подразделение (область
    права сдачи, не чтения). Экран расхода спрашивает его, чтобы не запереть
    первый шаг цепочки: список несданного управления сводящему за департамент
    не раскрывается (Plane №295), но САМ начальник управления обязан открыть
    свой список ДО сдачи — иначе статусы некому и негде проставить, и цепочка
    не стартует вовсе. Без `submit_permission_code` поле остаётся False у
    всех: молчаливое «можно всем» открыло бы ровно то, что шаг закрывает.

    `last_submitted_at` — МОМЕНТ последней сдачи любого дня (ISO с зоной) или
    None. Именно момент, а не деловой день: заказчик просил «дату обновления»
    списка, а обновляет его сдача версии. Нужен свёрнутой строке несданного
    управления: «не сдано» без даты не отличает «сдавал вчера, сегодня ещё
    нет» от «не сдавал никогда», а сводящему это и надо знать, чтобы понять,
    кого торопить.

    None от резолвера (wildcard/безскоуповый грант) разворачивается во всё
    дерево — экрану нужен конкретный список, а не «всё».

    Порядок строк — ОБХОД ДЕРЕВА (`tree_id`, `lft`), а не алфавит имён
    (Plane №296): экран расхода печатает управления «по очереди», и алфавит
    ставил бы «Второе управление» впереди «Первого», а управления разных
    департаментов перемешивал бы между собой.

    `division_type` — тип узла (`ORGANIZATION`, `DEPARTMENT`, …) как он назван
    моделью. Нужен читателям, которым важен УРОВЕНЬ, а не имя: до Plane №307
    департамент опознавали по «нет предков», а этот признак верен и для
    корневой организации — её `ancestors_of` из пути выбрасывает.

    `ancestors` — путь до подразделения СВЕРХУ ВНИЗ, без корня организации
    (Plane №235). Имена уникальны только внутри родителя: на реальной
    структуре «Второе сквозное управление» есть в каждом департаменте, и
    экран расхода показывал три одинаковые строки подряд — а по ним человек
    решает, чей день сдавать. Корень отброшен сознательно: организация одна,
    её имя в каждой строке — шум.
    """
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.operations.clock import Clock

    if business_date is None:
        business_date = Clock.today_local()

    allowed = PermissionService.visible_division_ids(actor_id, permission_code)
    if allowed is None:
        allowed = DivisionTreeSelector.all_ids()
    names = DivisionTreeSelector.names_map(allowed)

    # Область СДАЧИ считается тем же резолвером, что и область чтения: None у
    # него означает «право без скоупа» (в т.ч. wildcard) — то есть сдавать
    # можно за любое видимое подразделение, а не «ни за одно».
    if submit_permission_code is None:
        submit_allowed = set()
    else:
        submit_ids = PermissionService.visible_division_ids(
            actor_id, submit_permission_code
        )
        submit_allowed = set(allowed) if submit_ids is None else set(submit_ids)

    # ОДИН запрос на все подразделения области, а не по запросу на строку:
    # строк здесь столько же, сколько управлений в департаменте.
    last_submissions = DailySubmissionSelector.last_current_by_division(allowed)

    # Дерево целиком ОДНИМ запросом: путь строится по `parent_id` в памяти.
    # Запрос предков на строку дал бы N+1 ровно там, где строк больше всего.
    tree = {
        row["id"]: row
        for row in Division.objects.values(
            "id", "name", "parent_id", "division_type", "tree_id", "lft"
        )
    }
    without_status = _without_status_counts(names, tree, business_date)
    recipient_names = _recipient_names(names)

    def ancestors_of(division_id):
        path, cursor = [], tree.get(division_id, {}).get("parent_id")
        while cursor is not None and cursor in tree:
            node = tree[cursor]
            if node["division_type"] != Division.DivisionType.ORGANIZATION:
                path.append(node["name"])
            cursor = node["parent_id"]
        path.reverse()
        return path

    def row_of(division_id, name):
        last = last_submissions.get(division_id)
        node = tree.get(division_id)
        return {
            "id": str(division_id),
            "name": name,
            "parent_id": str(node["parent_id"]) if node and node["parent_id"] is not None else None,
            "without_status": without_status.get(division_id, 0),
            "notify_recipient_name": recipient_names.get(division_id),
            "ancestors": ancestors_of(division_id),
            # ТИП подразделения (Plane №307). Без него «департамент» читатель
            # опознавал по КОСВЕННОМУ признаку — «предков нет», — а он не про
            # департамент: у корневой ОРГАНИЗАЦИИ предков тоже нет, потому что
            # `ancestors_of` выбрасывает её из пути осознанно. Пока список шёл
            # по алфавиту, первой без предков случайно оказывался настоящий
            # департамент; с переходом на обход дерева (№296) первой встала
            # организация — и проба сборов сил стала слать в API её id.
            # Догадка убрана из читателя, а не подпёрта фикстурой.
            "division_type": (
                node["division_type"] if node is not None else None
            ),
            "can_submit": division_id in submit_allowed,
            "last_submitted_at": (
                last.submitted_at.isoformat() if last is not None else None
            ),
        }

    # ПОРЯДОК ДЕРЕВА, а не алфавит имён (Plane №296). Заказчик просит
    # «потом поочерёдно управления со списками», а сортировка по имени рвёт
    # эту очередь дважды: «Второе управление» встаёт впереди «Первого», и
    # управления РАЗНЫХ департаментов перемешиваются между собой — на стенде
    # борд начинался тремя одноимёнными «Вторыми сквозными» из трёх разных
    # департаментов подряд. Дерево (`tree_id`, `lft` у MPTT) — это ровно тот
    # порядок, в котором подразделения заведены и который человек считает
    # «по очереди»: `order_insertion_by = ['order', 'name']` у модели.
    #
    # Подразделение, которого нет в дереве (гонка удаления), уезжает в хвост
    # по имени, а не роняет сортировку разнотипным ключом.
    def tree_key(division_id):
        node = tree.get(division_id)
        if node is None:
            return (1, 0, 0, names.get(division_id, ""))
        return (0, node["tree_id"], node["lft"], "")

    return [
        row_of(division_id, names[division_id])
        for division_id in sorted(names, key=tree_key)
    ]


def _without_status_counts(visible_ids, tree, business_date):
    """Count derived IN_SERVICE occupants in visible expense subtrees.

    An absent explicit winner is normal service, not incomplete data. All
    reads are batched, and descendants outside the actor's scope stay out.
    """
    from collections import Counter, defaultdict
    from organization_management.apps.operations.selectors import (
        EmployeeStatusSelector, StaffUnitSelector, StatusTypeSelector,
    )
    from organization_management.apps.operations.strength_report import (
        DERIVED_IN_SERVICE, StatusCatalog, resolve_status_row,
    )

    slots, _dismissed = StaffUnitSelector.slots_with_working_occupants(visible_ids)
    employee_ids = {slot["employee_id"] for slot in slots if slot["employee_id"]}
    if not employee_ids:
        return {}
    rows_by_employee = defaultdict(list)
    for row in EmployeeStatusSelector.overlapping_on(business_date, employee_ids):
        rows_by_employee[row["employee_id"]].append(row)
    catalog_rows = list(StatusTypeSelector.catalog_rows())
    # This metric needs priorities and staff membership, not report columns.
    # Legacy callers with an empty catalog can still list their divisions;
    # do not invent a stored IN_SERVICE type or mutate the catalog on GET.
    catalog = StatusCatalog(
        priority={row["code"]: row["priority"] for row in catalog_rows},
        column={row["code"]: row["report_column_code"] for row in catalog_rows},
        counts_in_staff={row["code"]: row["counts_in_staff"] for row in catalog_rows},
    )
    counts = Counter()
    for slot in slots:
        employee_id = slot["employee_id"]
        if employee_id is None:
            continue
        winner = resolve_status_row(rows_by_employee[employee_id], business_date, catalog)
        code = winner["status_type_code"] if winner else DERIVED_IN_SERVICE
        if winner is not None or not catalog.counts_in_staff.get(code, True):
            continue
        cursor = slot["division_id"]
        while cursor in tree:
            if cursor in visible_ids:
                counts[cursor] += 1
            cursor = tree[cursor]["parent_id"]
    return counts


def _recipient_names(division_ids):
    """Display names only: recipient routing strings never escape the API."""
    from django.contrib.auth.models import User
    from organization_management.apps.operations.selectors import NotifyRecipientSelector

    recipients = NotifyRecipientSelector.resolve_many(division_ids)
    user_ids = {
        int(value) for value in recipients.values()
        if value.isascii() and value.isdigit() and len(value) <= 18
    }
    users = {str(user.pk): user for user in User.objects.filter(pk__in=user_ids)}
    names = {}
    for division_id, value in recipients.items():
        user = users.get(str(int(value))) if value.isascii() and value.isdigit() and len(value) <= 18 else None
        if user is not None:
            label = user.get_full_name().strip() or user.username
        else:
            # Recipient strings are routing identifiers, even when they look
            # like names. Only a resolved account supplies a trusted label.
            label = None
        names[division_id] = label
    return names


def employee_rows(division_ids):
    """Состав подразделений: [{id: str, full_name, rank_code, division_id}].

    rank_code несёт ЧЕЛОВЕКОЧИТАЕМОЕ звание (контракт клиента показывает его
    как есть, подстрокой подписи), а не код справочника.

    🔴 `division_id` В СТРОКЕ — НЕ УКРАШЕНИЕ (Plane №376). Пока его не было,
    общий ответ по нескольким подразделениям был бесполезен: разложить людей
    обратно клиент не мог, и ему приходилось спрашивать состав подразделение
    за подразделением — 51 запрос на одно открытие экрана «Сотрудники».
    Поле ДОБАВЛЕНО рядом со старыми, а не вместо: прежние читатели одного
    подразделения его просто не замечают.
    """
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.ops.security_events import (
        personnel_display_name,
    )

    rows = []
    for employee in (
        Employee.objects.filter(
            is_active=True, staff_unit__division_id__in=list(division_ids)
        )
        .select_related("rank", "staff_unit__division")
        .order_by("last_name", "first_name", "id")
    ):
        rows.append(
            {
                "id": str(employee.pk),
                "full_name": personnel_display_name(employee),
                "rank_code": employee.rank.name if employee.rank else "",
                "division_id": employee.staff_unit.division_id,
            }
        )
    return rows


def _submitted_by_label(actor_id):
    """Подпись сдавшего: username учётки, если actor_id — её pk."""
    from django.contrib.auth.models import User

    if actor_id and str(actor_id).isdigit():
        user = User.objects.filter(pk=actor_id).first()
        if user is not None:
            return user.username
    return str(actor_id or "")


def serialize_submission(row):
    """Проекция сдачи в форме контракта клиента: division_id — СТРОКА (тип
    клиента), подпись сдавшего — читаемая.

    `sent_at`/`sent_by`/`incomplete_reason` (Plane №990) — тот же контракт,
    что у `OpsDailySubmissionSerializer` раздела `/api/operations/`: это ОДНА
    модель (`OpsDailySubmission`), и два серверных представления одной
    сущности обязаны нести одни и те же поля — иначе фронт получил бы разный
    ответ в зависимости от того, каким путём читает ту же строку (борд читает
    ИМЕННО этим адаптером, см. `DAILY_SUBMISSIONS_PATH` на клиенте).
    """
    return {
        "id": row.pk,
        "division_id": str(row.division_id),
        "business_date": row.business_date.isoformat(),
        "version": row.version,
        "is_current": row.is_current,
        "event": row.event,
        "submitted_by": _submitted_by_label(row.submitted_by),
        "submitted_at": row.submitted_at.isoformat(),
        "late": row.late,
        "sent_at": row.sent_at.isoformat() if row.sent_at is not None else None,
        "sent_by": row.sent_by,
        "incomplete_reason": row.incomplete_reason,
    }


def list_submissions(*, scope, division_id, business_date):
    """ВСЕ версии дня (history=True): «день сдан» и цепочку версий экран
    решает сам по is_current/version — фильтровать здесь значило бы отнять у
    панели историю поправок."""
    rows = DailySubmissionSelector.list(
        scope=scope,
        division_id=division_id,
        business_date=business_date,
        history=True,
    )
    return [serialize_submission(row) for row in rows]
