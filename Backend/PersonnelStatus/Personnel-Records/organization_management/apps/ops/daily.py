"""«Расход дня» раздела ОМ (/api/ops/daily/*) — ТОНКИЕ АДАПТЕРЫ поверх
живого функционала /api/operations/.

Своего бэка у этого экрана НЕТ НАМЕРЕННО (план: группа L «не строить —
дубликат»): статусы, сдача дня и поправка уже живут в bulk_status_service /
day_submission_service, и вторая реализация тех же правил разошлась бы с
первой. Здесь только адресация и ФОРМА контракта клиента (entities/
daily-grid): подразделения и сотрудники — строковыми id, сдача — 9-полевой
проекцией со строковым division_id и человекочитаемой подписью сдавшего,
список сдач — ВСЕ версии дня (история решает экран по is_current).

Тот же приём, что /api/ops/audit-logs (поверх живого журнала) и
/api/ops/personnel (поверх живых Employee).
"""
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
)
from organization_management.apps.operations.services import PermissionService


def visible_division_rows(actor_id, permission_code):
    """Подразделения области актора: [{id: str, name}] в порядке имени.

    None от резолвера (wildcard/безскоуповый грант) разворачивается во всё
    дерево — экрану нужен конкретный список, а не «всё».
    """
    allowed = PermissionService.visible_division_ids(actor_id, permission_code)
    if allowed is None:
        allowed = DivisionTreeSelector.all_ids()
    names = DivisionTreeSelector.names_map(allowed)
    return [
        {"id": str(division_id), "name": name}
        for division_id, name in sorted(names.items(), key=lambda kv: kv[1])
    ]


def employee_rows(division_ids):
    """Состав подразделений: [{id: str, full_name, rank_code}].

    rank_code несёт ЧЕЛОВЕКОЧИТАЕМОЕ звание (контракт клиента показывает его
    как есть, подстрокой подписи), а не код справочника.
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
    """9-полевая проекция сдачи в форме контракта клиента: division_id —
    СТРОКА (тип клиента), подпись сдавшего — читаемая."""
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
