# Dockerfile
FROM python:3.12-bookworm

WORKDIR /app

# Install system dependencies
#
# fonts-dejavu-core — кириллический шрифт для водяного знака «ПРОЕКТ» на
# несогласованной расстановке (Plane №637, `[СОГ-03]`). У встроенных шрифтов
# reportlab кириллицы нет, а в образе шрифты не ставились ничем: на голом образе
# ЭТОГО ЖЕ репозитория каждый досогласовательный PDF отвечал 500. Комментарий
# стоит НАД инструкцией, а не внутри списка пакетов: `#` внутри строки,
# продолженной `\`, разбирается по-разному разными версиями сборщика.
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements/ /app/requirements/
RUN pip install --no-cache-dir -r requirements/base.txt
RUN pip install --no-cache-dir -r requirements/development.txt

# Copy project
COPY . /app/

# Collect static files
RUN python manage.py collectstatic --noinput

CMD ["gunicorn", "organization_management.config.wsgi:application", "--bind", "0.0.0.0:8000"]
