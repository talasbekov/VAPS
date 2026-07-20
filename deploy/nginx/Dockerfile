# Story 12.1 — прод-nginx образ: SPA-статика запечена внутрь + шаблон конфига.
# Собирается на DEV-машине (online), в контур едет docker save → носитель (12.2).
#
# 🔴 Build context = КОРЕНЬ репозитория (не deploy/nginx/) — иначе frontend/dist
# недостижим для COPY; корневой .dockerignore (allowlist) держит контекст малым.
# Предусловие: фронт собран ДО сборки образа.
#   cd frontend && npm run build && cd ..
#   docker build -t vaps-nginx:dev -f deploy/nginx/Dockerfile .
#
# Конфиг едет ШАБЛОНОМ в /etc/nginx/templates/: entrypoint официального образа
# прогоняет envsubst на старте контейнера (client_max_body_size настраивается
# env'ом БЕЗ пересборки — в контуре пересборка = новый перенос носителем).
# Дефолтный conf.d/default.conf удаляется: его listen 80 + location / иначе
# конкурируют с нашим server-блоком за те же запросы.
#
# Автоматизация обоих предусловий одним скриптом — bundle.sh (12.2).
FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/nginx/vaps.conf.template /etc/nginx/templates/vaps.conf.template
COPY frontend/dist /usr/share/nginx/html/
