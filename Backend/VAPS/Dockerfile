# Story 12.1 — прод-образ приложения VAPS (uvicorn ASGI, HTTP + WS).
# Собирается на DEV-машине (online), в контур едет через docker save → носитель →
# docker load (механика доказана спайком 1.9, упаковка — bundle.sh 12.2).
# Это НЕ дев-образ: pip install БЕЗ [dev]-экстра (pytest/ruff/hypothesis не едут в прод).
#
# Сборка (build context = Backend/VAPS, см. .dockerignore рядом):
#   docker build -t vaps-app:dev -f Backend/VAPS/Dockerfile Backend/VAPS
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# COPY до pip install: editable-установка (-e) требует полного дерева источника
# на месте. Docker-кэш здесь беднее (любая правка инвалидирует установку
# зависимостей) — осознанный компромисс ради корректности: pyproject.toml
# [tool.setuptools] packages перечисляет НЕ все пакеты (нет apps.operations и
# соседей), поэтому не-editable `pip install .` молча потерял бы половину
# приложения (Ловушка №1 стори). Единственный проверенный проектом режим
# установки — editable.
COPY . .

RUN pip install --no-cache-dir -e .

EXPOSE 8000

# collectstatic на СТАРТЕ, не на build-time: STATIC_ROOT — shared-volume с
# nginx (deploy/docker-compose.yml), на build-time volume не смонтирован.
# --clear (ревью 12.1): volume персистентен между релизами — без очистки
# удалённые апгрейдом Django файлы отдавались бы nginx'ом вечно.
# exec (ревью 12.1): иначе PID 1 = sh, который НЕ форвардит SIGTERM →
# каждый stop/restart (включая флип kill-switch VAPS_WS_ENABLED) висел бы
# grace-период и добивался SIGKILL'ом без graceful shutdown uvicorn.
# migrate сюда НЕ входит — отдельный явный шаг install.sh (12.3): автозапуск
# миграций при каждом рестарте контейнера противоречит рунбук-дизайну деплоя.
# --lifespan off — канон config/asgi.py и architecture.md#L337.
CMD ["sh", "-c", "python manage.py collectstatic --noinput --clear && exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 --lifespan off"]
