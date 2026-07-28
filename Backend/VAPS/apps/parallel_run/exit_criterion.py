"""Story 7.8 — exit criterion для режима «без двойного ввода».

epics.md, Story 7.8: "exit criterion в конфиге (10 рабочих дней без
unclassified + frozen-suite зелёный)". ``green_streak()`` (Story 6.9,
``apps.parallel_run.services``) уже считает нужное число — переиспользуется,
не переписывается; "frozen-suite зелёный" — честная граница: нет
автоматического хука на результат тестового прогона без похода в CI-
инфраструктуру, поэтому вход внешний (флаг), не автодетект.
"""

from dataclasses import dataclass

from apps.parallel_run.services import green_streak

EXIT_CRITERION_GREEN_DAYS = 10


@dataclass(frozen=True)
class ExitCriterionStatus:
    green_streak: int
    green_days_required: int
    frozen_suite_green: bool
    met: bool


def evaluate(*, frozen_suite_green: bool) -> ExitCriterionStatus:
    streak = green_streak()
    met = streak >= EXIT_CRITERION_GREEN_DAYS and frozen_suite_green
    return ExitCriterionStatus(
        green_streak=streak,
        green_days_required=EXIT_CRITERION_GREEN_DAYS,
        frozen_suite_green=frozen_suite_green,
        met=met,
    )
