# Спайк 1.9 — минимальный самодостаточный образ-маркер.
# ЭТО НЕ прод-образ VAPS (Django/uvicorn/Postgres) — тот собирается в E12.
# Образ обязан быть полностью самодостаточен после `docker save`:
# никаких сетевых тяг при `compose up` в закрытом контуре (NFR-1).
FROM nginx:alpine

# git sha и дата сборки подставляются в страницу-маркер на dev-машине (online),
# чтобы в контуре по странице было видно, какой именно бандл доехал.
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

COPY index.html /usr/share/nginx/html/index.html
RUN sed -i "s|__GIT_SHA__|${GIT_SHA}|g; s|__BUILD_DATE__|${BUILD_DATE}|g" \
    /usr/share/nginx/html/index.html
