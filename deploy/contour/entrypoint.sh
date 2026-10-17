#!/bin/sh
set -eu
: "${DJANGO_SECRET_KEY:?Set a new DJANGO_SECRET_KEY}"
: "${POSTGRES_PASSWORD:?Set a new POSTGRES_PASSWORD}"
mkdir -p /data/static /data/media /data/private /var/log/django
python manage.py migrate --noinput
python manage.py collectstatic --noinput
exec "$@"
