"""Story 7.10 — план cutover и отката: рунбук как код, не импровизация.

AC-1: cutover разрешён ТОЛЬКО когда exit criterion (Story 7.8) выполнен —
переиспользует ``exit_criterion.evaluate()`` буквально, не переоценивает
критерий своей копией правил.

Откат — ОДНА функция/команда, не последовательность ручных шагов: код
доказывает механическую часть "< норматив" (выполняется за миллисекунды),
норматив по времени человека/процесса — операционное свойство рунбука, не
таймер в коде.
"""

from apps.core import parallel_run_mode
from apps.parallel_run.exit_criterion import evaluate as evaluate_exit_criterion


def execute_cutover(*, actor, frozen_suite_green):
    """AC-1/AC-3: по рунбуку — отказывает, если exit criterion не выполнен."""
    criterion = evaluate_exit_criterion(frozen_suite_green=frozen_suite_green)
    if not criterion.met:
        raise ValueError(
            "cutover отклонён: exit criterion не выполнен "
            f"(green_streak={criterion.green_streak}/"
            f"{criterion.green_days_required}, "
            f"frozen_suite_green={criterion.frozen_suite_green})"
        )
    return parallel_run_mode.mark_cutover_complete(actor=actor)


def rollback(*, actor, deadline):
    """AC-1: откат — ОДНА команда, не многошаговая импровизация."""
    return parallel_run_mode.rollback_cutover(actor=actor, deadline=deadline)
