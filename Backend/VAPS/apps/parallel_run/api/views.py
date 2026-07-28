"""Story 7.0 — health-видимость стенда в контуре.

Публичный (без auth) health-маркер для docker-compose healthcheck и для
"состояние режима видно в Admin/health" (Story 7.7, AC-2). Показывает время
и статус ПОСЛЕДНЕГО ИСПОЛНЕНИЯ diff-джобы (``ParallelRunDay``, Story 6.9) —
сортировка по ``ran_at`` (когда джоба реально выполнилась), а не по
``run_date`` (за какую бизнес-дату), т.к. это разные вещи при догоне/бэкфилле
прошлых дат.

``last_import_run`` остаётся ``null``: ``nightly_increment`` (Story 7.7)
переиспользует ``full_import.run_full_import`` (7.6) — тот не пишет
собственный run-log (в отличие от diff-джобы, у которой есть
``ParallelRunDay``), так что "последний прогон" инкремента не из чего
прочитать. Не пропуск — честная граница: заводить отдельную таблицу
run-лога ради одного поля health-эндпоинта здесь избыточно, до появления
реальной потребности мониторить именно ЭТО.

``parallel_run_mode`` (Story 7.7, AC-2) — состояние переключателя «без
двойного ввода»: enabled + число пилотных подразделений-исключений.

Story 7.8/AC-1: тот же блок дополнен ``green_streak``/``deadline``/
``exit_criterion_met`` — видимость дедлайна и прогресса без похода в CLI
(``parallel_run_dashboard``). Здесь ``exit_criterion_met`` всегда считается с
``frozen_suite_green=False`` (у health-эндпоинта нет входа для этого
внешнего флага) — это НЕ авторитетный вердикт готовности, только "streak-
часть критерия"; авторитетный вердикт — только через
``parallel_run_dashboard --frozen-suite-green``.

Нет top-level "status": "ok" — HTTP 200 сам по себе означает «эндпоинт
достижим»; РЕАЛЬНЫЙ статус джобы — ``last_diff_run.status`` (ok/no_baseline/
error). Монитор/healthcheck, читающий только верхний уровень как "всё ок",
маскировал бы упавший прогон (пойман ревью Story 7.0).
"""

from django.db import DatabaseError
from rest_framework.decorators import (
    api_view, authentication_classes, permission_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.core import parallel_run_mode
from apps.parallel_run.exit_criterion import evaluate as evaluate_exit_criterion
from apps.parallel_run.models import ParallelRunDay


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def stand_health(request):
    try:
        last_day = ParallelRunDay.objects.order_by("-ran_at").first()
        criterion = evaluate_exit_criterion(frozen_suite_green=False)
        deadline = parallel_run_mode.get_deadline()
        mode_state = {
            "enabled": parallel_run_mode.is_enabled(),
            "pilot_division_count": parallel_run_mode.pilot_division_count(),
            "green_streak": criterion.green_streak,
            "deadline": deadline.isoformat() if deadline else None,
            "exit_criterion_met": criterion.met,
        }
    except DatabaseError:
        # БД ещё мигрирует/недоступна на старте контейнера — явный 503, а не
        # неопознанный 500 с traceback наружу публичного эндпоинта.
        return Response({"detail": "database unavailable"}, status=503)

    last_diff = (
        None
        if last_day is None
        else {
            "run_date": last_day.run_date.isoformat(),
            "status": last_day.status,
            "ran_at": last_day.ran_at.isoformat(),
            "blocking_count": last_day.blocking_count,
            "total_diffs": last_day.total_diffs,
        }
    )
    return Response(
        {
            "last_diff_run": last_diff,
            # См. докстринг модуля — честно null, нет run-log для инкремента.
            "last_import_run": None,
            "parallel_run_mode": mode_state,
        }
    )
