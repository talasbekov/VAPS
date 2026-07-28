#!/usr/bin/env bash
# Story 12.2 — сборка релизного бандла на DEV-машине (online). Преемник
# deploy/spike-1.9/build-bundle.sh (доказал save+sha256 на ОДНОМ образе; его
# докстринг явно называет эту стори адресом manifest.json/digests/списка
# миграций — спайк-скрипт не трогается, живёт отдельно).
#
# Выход (deploy/dist-bundle/, гитигнорирован — deploy/.gitignore):
#   vaps-<дата>-<sha>-images.tar     — docker save всех 4 образов 12.1's топологии
#   vaps-<дата>-<sha>-frontend.tar   — frontend/dist, того же sha
#   vaps-<дата>-<sha>-manifest.json  — sha/digests/миграции/min_upgrade_from
#   vaps-<дата>-<sha>-sha256sums.txt — sha256sum-совместимый (12.3's install.sh
#                                      наследует эту же проверку)
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

APP_IMAGE_NAME="vaps-app"
NGINX_IMAGE="nginx:1.27-alpine"
POSTGRES_IMAGE="postgres:16"
REDIS_IMAGE="redis:7-alpine"

OUT_DIR="deploy/dist-bundle"
LAST_SHA_FILE="${OUT_DIR}/.last-bundle-sha"

# AC-3/AC-6: грязное дерево — стоп ДО docker/npm. `git diff HEAD --`, НЕ
# `git status --porcelain` — последний триггерится легитимными untracked-
# файлами (node_modules/, graphify-out/), не признаком «непроверяемый sha».
if ! git diff --quiet HEAD --; then
  echo "ERROR: рабочее дерево не чистое (uncommitted changes к отслеживаемым" >&2
  echo "файлам) — бандл должен собираться из закоммиченного sha, не черновика." >&2
  exit 1
fi

GIT_SHA="$(git rev-parse --short HEAD)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DATE_ONLY="${BUILD_DATE%%T*}"
PREFIX="vaps-${DATE_ONLY}-${GIT_SHA}"

mkdir -p "${OUT_DIR}"

IMAGES_TAR="${OUT_DIR}/${PREFIX}-images.tar"
FRONTEND_TAR="${OUT_DIR}/${PREFIX}-frontend.tar"
MANIFEST="${OUT_DIR}/${PREFIX}-manifest.json"
SUMS="${OUT_DIR}/${PREFIX}-sha256sums.txt"

APP_IMAGE="${APP_IMAGE_NAME}:${GIT_SHA}"

echo "[1/6] docker build (${APP_IMAGE})..."
docker build -t "${APP_IMAGE}" -f Backend/VAPS/Dockerfile Backend/VAPS

echo "[2/6] docker pull базовых образов (nginx/postgres/redis — теги как в deploy/docker-compose.yml)..."
docker pull "${NGINX_IMAGE}"
docker pull "${POSTGRES_IMAGE}"
docker pull "${REDIS_IMAGE}"

echo "[3/6] docker save -> ${IMAGES_TAR} (все 4 образа 12.1's топологии)..."
docker save -o "${IMAGES_TAR}" "${APP_IMAGE}" "${NGINX_IMAGE}" "${POSTGRES_IMAGE}" "${REDIS_IMAGE}"

echo "[4/6] фронт (npm run build) -> ${FRONTEND_TAR} (того же sha, AC-3)..."
( cd frontend && npm run build )
tar -czf "${FRONTEND_TAR}" -C frontend dist

echo "[5/6] manifest.json (sha/digests/миграции/min_upgrade_from)..."
digest_of() {
  docker image inspect "$1" --format '{{index .RepoDigests 0}}' 2>/dev/null || true
}
app_digest="$(digest_of "${APP_IMAGE}")"
[[ -z "${app_digest}" ]] && app_digest="<no-digest-local-build>"
nginx_digest="$(digest_of "${NGINX_IMAGE}")"
[[ -z "${nginx_digest}" ]] && nginx_digest="<no-digest-local-build>"
postgres_digest="$(digest_of "${POSTGRES_IMAGE}")"
[[ -z "${postgres_digest}" ]] && postgres_digest="<no-digest-local-build>"
redis_digest="$(digest_of "${REDIS_IMAGE}")"
[[ -z "${redis_digest}" ]] && redis_digest="<no-digest-local-build>"

# AC-2 min_upgrade_from: best-effort locally-remembered pointer, NOT a
# cryptographic contract — the file lives only on this dev machine and is
# never shipped with the bundle. null on the first-ever run. Found by a live
# rebuild-same-sha-twice test (AC-5): if the marker already holds the sha
# being built RIGHT NOW (a retry/rebuild, not a real new release), a bundle
# claiming to "upgrade from itself" is meaningless — treat that case as null
# too, same as no prior bundle.
prev_sha="null"
if [[ -f "${LAST_SHA_FILE}" ]]; then
  candidate="$(cat "${LAST_SHA_FILE}")"
  if [[ "${candidate}" != "${GIT_SHA}" ]]; then
    prev_sha="\"${candidate}\""
  fi
fi

# Review (Blind Hunter/Edge Case Hunter): pipefail does abort the script if
# `showmigrations` fails (live-verified — a broken .venv does NOT silently
# yield "migrations": []), but the bare bash error it leaves behind gives no
# hint it was this step. `|| { ...; exit 1; }` names the actual failure.
migrations_json="$(
  cd Backend/VAPS && .venv/bin/python manage.py showmigrations --plan 2>/dev/null \
    | sed -E 's/^\[.\]\s+//' \
    | awk 'NF' \
    | python3 -c 'import json, sys; print(json.dumps([l.strip() for l in sys.stdin]))'
)" || {
  echo "ERROR: не удалось получить список миграций (Backend/VAPS/.venv/bin/python" >&2
  echo "не найден или manage.py showmigrations упал) — бандл без списка миграций" >&2
  echo "не собирается." >&2
  exit 1
}

cat > "${MANIFEST}" <<JSON
{
  "sha": "${GIT_SHA}",
  "built_at": "${BUILD_DATE}",
  "images": {
    "${APP_IMAGE_NAME}": {"tag": "${APP_IMAGE}", "digest": "${app_digest}"},
    "nginx": {"tag": "${NGINX_IMAGE}", "digest": "${nginx_digest}"},
    "postgres": {"tag": "${POSTGRES_IMAGE}", "digest": "${postgres_digest}"},
    "redis": {"tag": "${REDIS_IMAGE}", "digest": "${redis_digest}"}
  },
  "migrations": ${migrations_json},
  "frontend_sha": "${GIT_SHA}",
  "min_upgrade_from": ${prev_sha}
}
JSON

echo "[6/6] sha256sums.txt (images.tar + frontend.tar + manifest.json — AC-4)..."
( cd "${OUT_DIR}" && sha256sum "$(basename "${IMAGES_TAR}")" "$(basename "${FRONTEND_TAR}")" "$(basename "${MANIFEST}")" > "$(basename "${SUMS}")" )

echo "${GIT_SHA}" > "${LAST_SHA_FILE}"

echo
echo "ГОТОВО: ${OUT_DIR}/"
echo "  $(basename "${IMAGES_TAR}")"
echo "  $(basename "${FRONTEND_TAR}")"
echo "  $(basename "${MANIFEST}")"
echo "  $(basename "${SUMS}")"
