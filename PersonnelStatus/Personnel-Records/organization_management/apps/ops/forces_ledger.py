"""Проекция JSON `force_requests`/`force_allocation` мероприятия в таблицы
заявки (`[МД-06]`, Plane №425). Идемпотентна и append-only: сравнивает
последнюю записанную строку с JSON и дописывает НОВУЮ, если что-то
изменилось; ничего не правит и не удаляет (исключение из состава —
`removed_at`).

Зовётся сигналом `post_save` мероприятия (`operations/signals.py`) при
сохранении полей JSON — так писателей в `security_events.py` не трогаем, а
проекция не отстаёт ни от одного из них. Тот же код с историческими моделями
выполняет бэкфилл в миграции 0082 — параметр `models`.
"""
import datetime as dt
from types import SimpleNamespace


def _parse_dt(value):
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def _int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _models(models=None):
    if models is not None:
        return models
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.operations import models_forces as m

    return SimpleNamespace(
        OpsForceRequest=m.OpsForceRequest,
        OpsDepartmentRequest=m.OpsDepartmentRequest,
        OpsUnitRequest=m.OpsUnitRequest,
        OpsForceRequestMember=m.OpsForceRequestMember,
        Division=Division,
        Employee=Employee,
    )


def _existing(model, key):
    """PK, если строка есть в базе; иначе None — JSON может ссылаться на
    удалённое подразделение или сотрудника, и бэкфилл не должен на нём падать."""
    pk = _int(key, None)
    if pk is None or pk <= 0:
        return None
    return pk if model.objects.filter(pk=pk).exists() else None


def _primary_visit_id(event):
    rows = list(event.visit_objects.order_by("position", "pk").values_list("pk", flat=True))
    return rows[0] if len(rows) == 1 else None


def project(event, *, models=None, now=None):
    """Дописать в таблицы то, чего в них ещё нет. Возвращает счётчик новых строк."""
    M = _models(models)
    now = now or dt.datetime.now(dt.timezone.utc)
    added = {"requests": 0, "departments": 0, "units": 0, "members": 0, "removed": 0}

    # ── Заявка мероприятия ──────────────────────────────────────────────
    visit_id = _primary_visit_id(event)
    latest_request = None
    for row in event.force_requests or []:
        key = str(row.get("id") or "force-request-1")
        count = _int(row.get("requestedCount"))
        last = (
            M.OpsForceRequest.objects.filter(event_id=event.pk, source_key=key)
            .order_by("-sequence").first()
        )
        if last is None or last.requested_count != count:
            last = M.OpsForceRequest.objects.create(
                event_id=event.pk, visit_object_id=visit_id, source_key=key,
                requested_count=count, sequence=(last.sequence + 1) if last else 1,
            )
            added["requests"] += 1
        latest_request = last

    # ── Запросы департаментам ───────────────────────────────────────────
    seen_members = {}
    for row in event.force_allocation or []:
        key = str(row.get("id") or "")
        if not key:
            continue
        dep_key = str(row.get("departmentId") or "")
        dep_id = _existing(M.Division, dep_key)
        need = _int(row.get("need"))
        allocating = row.get("allocating")
        allocating = _int(allocating) if allocating not in (None, "") else None
        status = str(row.get("status") or "DRAFT")
        due_at = _parse_dt(row.get("dueAt"))
        last = (
            M.OpsDepartmentRequest.objects.filter(event_id=event.pk, allocation_key=key)
            .order_by("-sequence").first()
        )
        changed = last is None or (
            last.requested_count != need or last.allocating_count != allocating
            or last.status != status or last.due_at != due_at
        )
        if changed:
            last = M.OpsDepartmentRequest.objects.create(
                event_id=event.pk,
                force_request_id=latest_request.pk if latest_request else None,
                department_id=dep_id, department_key=dep_key,
                allocation_key=key, requested_count=need,
                allocating_count=allocating, status=status, due_at=due_at,
                sequence=(last.sequence + 1) if last else 1,
            )
            added["departments"] += 1

        # ── Запросы управлениям ─────────────────────────────────────────
        for unit in row.get("directorates") or []:
            ukey = str(unit.get("id") or f"{key}:{unit.get('divisionId')}")
            ucount = _int(unit.get("need"))
            ulast = (
                M.OpsUnitRequest.objects.filter(event_id=event.pk, directorate_key=ukey)
                .order_by("-sequence").first()
            )
            if ulast is None or ulast.requested_count != ucount:
                M.OpsUnitRequest.objects.create(
                    event_id=event.pk, department_request_id=last.pk,
                    directorate_id=_existing(M.Division, unit.get("divisionId")),
                    directorate_key=ukey, requested_count=ucount,
                    sequence=(ulast.sequence + 1) if ulast else 1,
                )
                added["units"] += 1

        # ── Состав ──────────────────────────────────────────────────────
        present = set()
        for member in row.get("members") or []:
            ekey = str(member.get("employeeId") or "")
            if not ekey:
                continue
            present.add(ekey)
            live = M.OpsForceRequestMember.objects.filter(
                event_id=event.pk, allocation_key=key, employee_key=ekey,
                removed_at__isnull=True,
            ).exists()
            if not live:
                M.OpsForceRequestMember.objects.create(
                    event_id=event.pk, department_request_id=last.pk,
                    allocation_key=key,
                    employee_id=_existing(M.Employee, ekey),
                    employee_key=ekey,
                    directorate_id=_existing(M.Division, member.get("divisionId")),
                    directorate_key=str(member.get("divisionId") or ""),
                    status_id=_int(member.get("statusId"), None) or None,
                    added_at=_parse_dt(member.get("addedAt")) or now,
                )
                added["members"] += 1
        seen_members[key] = present

    # Исключённые из состава — штамп, не удаление.
    for key, present in seen_members.items():
        for live in M.OpsForceRequestMember.objects.filter(
            event_id=event.pk, allocation_key=key, removed_at__isnull=True
        ):
            if live.employee_key not in present:
                live.removed_at = now
                live.save(update_fields=["removed_at"])
                added["removed"] += 1
    return added


def backfill(events, *, models=None, log=print):
    """Бэкфилл всех мероприятий: печатает, сколько строк перенесено."""
    totals = {"requests": 0, "departments": 0, "units": 0, "members": 0, "removed": 0}
    count = 0
    for event in events:
        for k, v in project(event, models=models).items():
            totals[k] += v
        count += 1
    log(
        f"[forces-ledger] мероприятий: {count}; перенесено строк — заявок "
        f"{totals['requests']}, запросов департаментам {totals['departments']}, "
        f"запросов управлениям {totals['units']}, состава {totals['members']}."
    )
    return totals
