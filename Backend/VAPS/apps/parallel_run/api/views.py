"""Story 7.0 — health-видимость стенда в контуре.

Публичный (без auth) health-маркер для docker-compose healthcheck и для
будущего "состояние режима видно в Admin/health" (Story 7.7). Показывает
время и статус ПОСЛЕДНЕГО ИСПОЛНЕНИЯ diff-джобы (``ParallelRunDay``, Story
6.9) — сортировка по ``ran_at`` (когда джоба реально выполнилась), а не по
``run_date`` (за какую бизнес-дату), т.к. это разные вещи при догоне/бэкфилле
прошлых дат. Инкремент-импорт (7.2-7.4/7.7) ещё не существует — поле
``last_import_run`` зарезервировано и остаётся ``null`` до его появления, не
удаляется задним числом при добавлении.

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

from apps.parallel_run.models import ParallelRunDay


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def stand_health(request):
    try:
        last_day = ParallelRunDay.objects.order_by("-ran_at").first()
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
            # Зарезервировано для 7.7 (инкремент-импорт); намеренно null сейчас.
            "last_import_run": None,
        }
    )
