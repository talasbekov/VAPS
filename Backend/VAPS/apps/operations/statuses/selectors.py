from django.db.models import Min

from apps.core.selectors import CoreEmployeeSelector, HistoricalEmployeeSelector
from apps.operations.services import PermissionService
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.strength_report import resolve_status

# Право чтения статусов — единый источник для гейта вьюхи И сужения видимости
# селектором (зеркало READ_PERMISSION submissions/selectors.py — импорт держит
# оба слоя на одном коде). Держат DIVISION_OPERATOR, VIEWER (+ADMIN `*`).
GRID_PREFILL_PERMISSION = "status.view"


class EmployeeStatusSelector:
    """Bulk-first status reads — the ONLY data channel for aggregation."""

    @staticmethod
    def earliest_start():
        """Earliest live status date_start — the status half of the report
        data horizon (6.10a review D1 2026-07-13). None on an empty system.
        """
        return EmployeeStatus.objects.filter(cancelled_at__isnull=True).aggregate(
            m=Min("date_start")
        )["m"]

    @staticmethod
    def overlapping_on(on_date, employee_ids=None):
        """Live interval facts containing the date, one bulk query.

        period__contains rides the full GiST index built in 1.5 exactly
        for these derived lookups; cancelled rows do not exist for the
        report (cancelled_at is "записи нет").
        """
        qs = EmployeeStatus.objects.filter(
            cancelled_at__isnull=True, period__contains=on_date
        )
        if employee_ids is not None:
            qs = qs.filter(employee_id__in=employee_ids)
        return list(
            qs.values("employee_id", "status_type_code", "date_start", "date_end")
        )

    @staticmethod
    def snapshot_facts_on(on_date, employee_ids=None):
        """Like overlapping_on, but also carries status_id (pk) and source.

        The DailySubmission снапшот row (story 5.3a) needs ``status_id`` and
        ``source``, which overlapping_on omits. overlapping_on is left UNTOUCHED
        (strength_report rides its exact 4-field shape) — this is a sibling, not
        a change. Same predicate: cancelled_at IS NULL + period contains the
        date (the GiST-indexed half-open [date_start, date_end) lookup).
        """
        qs = EmployeeStatus.objects.filter(
            cancelled_at__isnull=True, period__contains=on_date
        )
        if employee_ids is not None:
            qs = qs.filter(employee_id__in=employee_ids)
        return list(
            qs.values(
                "id",
                "employee_id",
                "status_type_code",
                "date_start",
                "date_end",
                "source",
            )
        )

    @classmethod
    def grid_prefill(cls, actor, business_date) -> dict:
        """Query-загрузка данных дня для префилла грида (story 10.1b).

        Actor-first LIST-селектор — сужает видимость САМ (канон L451, зеркало
        ``DailySubmissionSelector.list``): чужие дивизионы просто отсутствуют,
        scope никогда не ошибается. ``visible_division_ids`` → None (глобальный/
        wildcard грант) проходит в ``roster_on`` как есть — его контракт
        «None = вся БД» совпадает. Статусы тянутся ТОЛЬКО по employee_ids из
        roster (``overlapping_on(date, None)`` отдал бы всю БД мимо scope);
        пустой roster → пустые списки. Всё bulk (NFR-4): RBAC-резолв +
        roster=2 + denorm=2 + statuses=1 запросов — никаких per-row вызовов.

        Ответ — сырые факты (Решение №4): derived IN_SERVICE-строк нет,
        отсутствие записи = дефолт на фронте (prefill.ts DEFAULT_STATUS).
        Порядок ``employees`` детерминирован: (full_name, str(id)). Порядок
        ``statuses`` тоже: (employee_id, status_type_code, date_start) —
        правило выбора «победителя» при 2+ живых статусах — маппер 10.2.
        """
        visible = PermissionService.visible_division_ids(
            actor, GRID_PREFILL_PERMISSION
        )
        roster = HistoricalEmployeeSelector.roster_on(
            business_date, division_ids=visible
        )
        employee_ids = [eid for ids in roster.values() for eid in ids]
        denorm = CoreEmployeeSelector.denorm_for(employee_ids)
        employees = sorted(
            (
                {"id": eid, "full_name": d["full_name"], "rank": d["rank"]}
                for eid, d in denorm.items()
            ),
            key=lambda e: (e["full_name"], str(e["id"])),
        )
        statuses = cls.overlapping_on(business_date, employee_ids=employee_ids)
        # Детерминированный порядок (ревью 10.1b): при 2+ живых статусах
        # одного сотрудника (легальная секондмент-пара DETACHED+ATTACHED)
        # БД без ORDER BY отдаёт строки в случайном порядке — фронт-маппер
        # получал бы случайного «победителя».
        statuses.sort(
            key=lambda s: (
                str(s["employee_id"]),
                s["status_type_code"],
                str(s["date_start"]),
            )
        )
        # Story 10.2 AC-1: справочник статусов ЕДЕТ В ОТВЕТЕ (Решение №5 —
        # отдельного роута справочника нет; +1 КОНСТАНТНЫЙ запрос, NFR-4-пин
        # обновлён). Только активные; порядок — Meta модели (priority, code).
        # {code, name} — ровно StatusOption фронта; is_hard_block/color НЕ
        # тащим (конфликты решает бэк, палитра — FR-39/E10 visual).
        status_types = list(
            StatusType.objects.filter(is_active=True).values("code", "name")
        )
        return {
            "employees": employees,
            "statuses": statuses,
            "status_types": status_types,
        }

    @classmethod
    def status_on(cls, employee_id, on_date) -> str:
        """Point AC contract: the derived status of ONE employee.

        MUST NOT be called in a loop anywhere — that reproduces the
        donor's COUNT()-in-a-loop anti-pattern; the bulk path is
        overlapping_on + derive_report.
        """
        rows = cls.overlapping_on(on_date, employee_ids=[employee_id])
        return resolve_status(rows, on_date)
