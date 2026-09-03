"""Запрос сил ГЛАЗАМИ УПРАВЛЕНИЯ (Plane №394, `[СБС-30]`).

Начальник управления приходит из уведомления «Выделите N сотрудников на
ОМ-…» на экран «Статусы сотрудников» и видит баннер «Запрос на ОМ-…: выделено
X из Y». Ему нужна ОДНА строка управления из заявки департамента — и ничего
сверх неё: соседние управления, состав департамента и решения штаба не его
вопрос, и присылать их в браузер значило бы понадеяться, что экран не
покажет.

Своя ручка, а не `forces/requests/<id>/` департамента: та гейтится
`forces.allocate` (ответственный за департамент), у начальника управления
его нет и не будет — у него `forces.select`. Область — управления, которые
он видит под `forces.select`; чужая заявка — 404, а не 403 (существование
чужой строки не подтверждается перебором идентификаторов, как и у
департамента).

Модуль отдельный от `security_events.py`: у чтения свой предмет, а тот файл
и так под пять тысяч строк.
"""
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.security_events import (
    _as_division_id,
    _not_found,
    allocation_members_view,
)


def directorate_request_view(allocation_id, allowed_division_ids):
    """Строка СВОЕГО управления в заявке департамента + шапка мероприятия.

    `allowed_division_ids is None` — область не сужена (администратор, роль
    без области): тогда любая строка управления своя. Пустое множество —
    видеть нечего: 404 на любую заявку.
    """
    for event in OpsSecurityEvent.objects.exclude(force_allocation=[]):
        for allocation in allocation_members_view(event):
            if allocation.get("id") != allocation_id:
                continue
            mine = [
                row
                for row in allocation.get("directorates", [])
                if allowed_division_ids is None
                or _as_division_id(row.get("divisionId")) in allowed_division_ids
            ]
            if not mine:
                raise _not_found("Запрос управлению не найден.", allocation_id)
            return {
                "eventId": str(event.pk),
                "code": event.code,
                "title": event.title,
                "businessDate": event.business_date.isoformat(),
                "allocationId": allocation_id,
                "departmentName": allocation.get("departmentName", ""),
                "status": allocation.get("status"),
                "dueAt": allocation.get("dueAt"),
                # Обычно одна строка; несколько — у роли с областью на
                # департамент (она видит все его управления).
                "directorates": [
                    {
                        "divisionId": str(row.get("divisionId")),
                        "name": row.get("name", ""),
                        "need": int(row.get("need") or 0),
                        "assigned": int(row.get("assigned") or 0),
                        "notifiedAt": row.get("notifiedAt"),
                    }
                    for row in mine
                ],
            }
    raise _not_found("Запрос управлению не найден.", allocation_id)
