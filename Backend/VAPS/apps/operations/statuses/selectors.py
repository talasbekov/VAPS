from django.db.models import Min

from apps.core.selectors import HistoricalEmployeeSelector
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services.strength_report import resolve_status


class StatusTypeSelector:
    """Read-only access to the status-type reference catalog.

    The read channel for modules OUTSIDE ``statuses``: submissions reaches
    statuses only through ``selectors``/``services``, never by importing the
    models across the module seam (story 10.8 Д6). Mirrors the shape of
    ``CoreDivisionTreeSelector.divisions_map`` — one query, a flat map.
    """

    @staticmethod
    def names_map() -> dict:
        """``code -> name`` for report/export rows, ONE query.

        Includes deactivated types on purpose: an immutable snapshot legally
        cites a type that was renamed or deactivated after сдача, and the
        export must still resolve its human-readable name. The caller falls
        back to the code itself when a type is absent entirely.
        """
        return dict(StatusType.objects.values_list("code", "name"))

    @staticmethod
    def catalog() -> list:
        """Активные типы для ВЫБОРА — плоский список, ONE query (story 10.1d).

        Сознательно НЕ симметрична ``names_map``: та включает деактивированные
        типы намеренно (снапшот законно цитирует тип, деактивированный после
        сдачи), эта — намеренно нет. Потребитель здесь — combobox грида:
        предложить оператору тип, который сервис создания отвергнет, значит
        поставить тихую ловушку в UI. Исторический резолв ≠ активный выбор;
        унифицировать эти два метода нельзя.

        ``order_by`` явный, хотя ``Meta.ordering`` даёт то же: порядок ответа
        не должен зависеть от того, чего в этом файле не написано (сама Meta
        пинится отдельным тестом). Шесть полей — контракт combobox'а и
        подсветки; остальные колонки модели принадлежат другим владельцам
        (сервис создания, расход, КУ).
        """
        return list(
            StatusType.objects.filter(is_active=True)
            .order_by("priority", "code")
            .values(
                "code",
                "name",
                "is_hard_block",
                "priority",
                "report_column_code",
                "color",
            )
        )


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
    def for_division_on(cls, business_date, division_id) -> list:
        """Живые записи ОДНОГО подразделения на дату — read-канал 10.1b.

        Композиция двух bulk-чтений: дата-версионный ростер (core, story 2.4)
        даёт состав, ``overlapping_on`` — интервалы, содержащие дату. Каналом
        в core служит селектор, не модели (ARCH-003).

        OWN-LEVEL, без поддерева: множество ровно ``{division_id}``. Scope-гейт
        вьюхи subtree-aware, и симметрия тут кажется естественной — но канон
        расхода и грида own-level (submissions/services/snapshot.py, фронтовый
        ``/api/core/employees/?division_id=``), и поддерево развело бы строки
        грида с префиллом.

        ``roster_on`` берёт только WORKING и ``is_active`` — уволенный со
        статусом на дату сюда не попадёт. Пока ``EmployeeDivisionHistory``
        пуст (бэкфилл — E7), членство резолвится фолбэком «текущий дивизион»
        (BR-CORE-HISTORY-003).

        ⚠️ ``employee_ids=[]`` и ``employee_ids=None`` — РАЗНОЕ: ``None``
        означает «без фильтра», то есть статусы всей базы. Дивизион без
        сотрудников обязан дать ``[]``, поэтому ранний выход, а не
        ``roster.get(division_id)`` в аргументе.

        Порядок явный — без него порядок строк из БД не гарантирован, и
        потребитель/тест зависели бы от плана запроса.
        """
        roster = HistoricalEmployeeSelector.roster_on(business_date, {division_id})
        employee_ids = roster.get(division_id, [])
        if not employee_ids:
            return []
        rows = cls.overlapping_on(business_date, employee_ids=employee_ids)
        return sorted(
            rows, key=lambda row: (str(row["employee_id"]), row["date_start"])
        )

    @classmethod
    def status_on(cls, employee_id, on_date) -> str:
        """Point AC contract: the derived status of ONE employee.

        MUST NOT be called in a loop anywhere — that reproduces the
        donor's COUNT()-in-a-loop anti-pattern; the bulk path is
        overlapping_on + derive_report.
        """
        rows = cls.overlapping_on(on_date, employee_ids=[employee_id])
        return resolve_status(rows, on_date)
