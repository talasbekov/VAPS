from apps.operations.rbac.models import UserRole


class OpsUserRoleSelector:
    """Read-only access to user-role assignments."""

    @staticmethod
    def active_for_user(user_id):
        return list(
            UserRole.objects.filter(user_id=user_id, is_active=True).select_related(
                "role_code"
            )
        )


def compute_expense_dashboard(business_date):
    """Story 20.2a (FR-38/UJ-2): тонкая композиция `StrengthReportService.
    compute()` (расход по управлениям) + `tomorrow_block()` (5.6a,
    отстающие) для ОДНОЙ и той же `business_date`. Stale-фильтр отстающих
    (тот же приём, что `tomorrow_gate.assert_tomorrow_not_blocked`, review
    D1 2026-07-13) — удалённое/деактивированное управление никогда не
    "отстающее", нобody не может сдать за несуществующее управление. Если
    ПОСЛЕ фильтра список пуст, но исходный `blocked=True` держался только
    на призраках — итоговый `blocked` становится `False` (тот же принцип,
    что tomorrow_gate.py: config garbage не блокирует/не показывается).

    Function-level imports (тот же приём, что `StrengthReportService.
    compute()`'s собственный докстринг объясняет): `apps.operations.
    submissions.tomorrow_block` транзитивно импортирует `apps.operations.
    services` (`PermissionService`), которая импортирует ЭТОТ модуль
    (`OpsUserRoleSelector`) — модульный импорт наверху дал бы циклический
    import при старте Django."""
    from apps.core.selectors import CoreDivisionTreeSelector
    from apps.operations.statuses.services.strength_report import (
        StrengthReportService,
    )
    from apps.operations.submissions.tomorrow_block import tomorrow_block

    expense = StrengthReportService.compute(business_date)
    block = tomorrow_block(business_date)

    active_ids = CoreDivisionTreeSelector.active_ids(block.laggards)
    filtered_ids = [d for d in block.laggards if d in active_ids]
    names = CoreDivisionTreeSelector.divisions_map(filtered_ids)
    laggards = [{"division_id": d, "name": names[d]} for d in filtered_ids]

    blocked = block.blocked and bool(laggards)
    overridden = block.overridden and bool(laggards)

    return {
        "business_date": business_date,
        "expense": expense,
        "laggards": laggards,
        "blocked": blocked,
        "overridden": overridden,
    }
