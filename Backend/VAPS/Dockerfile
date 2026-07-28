# Story 12.1 — прод-образ приложения (uvicorn, --lifespan off). Собирается
# ТОЛЬКО из [project.dependencies] (pyproject.toml) — БЕЗ `[dev]`-экстры:
# pytest/ruff/hypothesis не место в прод-образе.
#
# collectstatic — ВНУТРИ образа на build-этапе, не в рантайм-энтрипоинте:
# детерминированный образ, не зависящий от volume при первом старте
# (Story 12.1 AC-4, deferred-work.md's E12-долг «STATIC_ROOT+collectstatic»).
FROM python:3.12-slim

WORKDIR /app

# Копируем ТОЛЬКО манифест сначала — слой зависимостей кешируется отдельно от
# смены прикладного кода (стандартный docker-приём, ускоряет пересборку).
COPY pyproject.toml manage.py ./
COPY config ./config
COPY apps ./apps

RUN pip install --no-cache-dir -e .

# VAPS_STATIC_ROOT здесь — путь ВНУТРИ образа, независим от прод-compose'а
# env (который задаёт тот же путь для рантайма — оба должны совпадать,
# иначе collectstatic соберёт статику не туда, откуда её потом читает
# STATIC_ROOT в рантайме; см. deploy/docker-compose.yml).
ENV VAPS_STATIC_ROOT=/app/staticfiles
RUN VAPS_SECRET_KEY=build-time-placeholder VAPS_DEBUG=1 \
    python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--lifespan", "off"]
