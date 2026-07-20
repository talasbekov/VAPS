#!/usr/bin/env bash
# Story 12.2 — сборка релизного бандла для переноса в закрытый контур носителем.
#
# Продукт (deploy/bundles/):
#   vaps-<дата>-<shortsha>.tar   — ОБА прод-образа одним docker save (epic-AC:
#                                  «релиз — один проверяемый артефакт»)
#   manifest-<тег>.json          — git sha, версия, образы+id, список миграций
#                                  ИЗ СОБРАННОГО ОБРАЗА, min_upgrade_from
#   sha256sums-<тег>.txt         — суммы архива И манифеста (спайк 1.9 крыл
#                                  только .tar)
#
# Режимы:
#   ./bundle.sh                — полная сборка бандла
#   ./bundle.sh --verify-repro — пересборка на том же sha + сверка манифеста
#                                по детерминированным полям (AC-8)
#
# Секреты в бандл НЕ входят (architecture.md#L567) — .env доставляется
# отдельной процедурой. Сборка на online dev-машине (канон 12.1); в контур
# едут только файлы deploy/bundles/ + install-обвязка 12.3.
set -euo pipefail

# Корень репо от расположения скрипта: пути ниже кавычены ВСЕ — путь
# репозитория содержит кириллицу (ловушка 7 из 8.8/10.9).
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# --- AC-1: чистота дерева ПО АРТЕФАКТ-ПУТЯМ ---------------------------------
# ИНВАРИАНТ: новый корневой путь, попадающий в build-context ЛЮБОГО образа,
# обязан быть добавлен в этот список ТЕМ ЖЕ PR. Сегодня контексты: app =
# Backend/VAPS (свой .dockerignore), nginx = корень с allowlist-.dockerignore
# (только deploy/nginx/ + frontend/dist/). Грязь вне списка (доки, .claude)
# в образы не попадает физически и сборку не блокирует.
ARTIFACT_PATHS=(Backend frontend deploy .dockerignore .gitignore)
DIRTY="$(git status --porcelain -- "${ARTIFACT_PATHS[@]}")"
if [ -n "$DIRTY" ]; then
  echo "ОТКАЗ: незакоммиченные изменения в артефакт-путях — sha бандла лгал бы о содержимом:" >&2
  echo "$DIRTY" >&2
  exit 1
fi

RELEASE_SHA_FULL="$(git rev-parse HEAD)"
RELEASE_SHA="$(git rev-parse --short HEAD)"
RELEASE_TAG="$(date -u +%Y%m%d)-${RELEASE_SHA}"   # дата UTC — зеркало спайка 1.9
BUNDLE_DIR="${REPO_ROOT}/deploy/bundles"
TAR_NAME="vaps-${RELEASE_TAG}.tar"
MANIFEST_NAME="manifest-${RELEASE_TAG}.json"
SUMS_NAME="sha256sums-${RELEASE_TAG}.txt"
# Статичное поле релизной политики (Решение №3): первый релиз — null;
# breaking-релиз правит значение осознанно. Потребитель — install.sh (12.3).
MIN_UPGRADE_FROM="null"

MODE="${1:-build}"

build_frontend() {
  echo "[1/4] npm run build (шов версии 10.9: VAPS_APP_VERSION=${RELEASE_TAG})..."
  # РОВНО те значения, что уйдут в manifest.json — контракт
  # frontend/scripts/build-constants.ts:16-24 (AC-3).
  ( cd "${REPO_ROOT}/frontend" \
    && VAPS_APP_VERSION="${RELEASE_TAG}" VAPS_BUILD_SHA="${RELEASE_SHA_FULL}" \
       npm run build >/dev/null )
  # Версия реально доехала до бандла, а не потерялась в фолбэке.
  if ! grep -q "${RELEASE_TAG}" "${REPO_ROOT}"/frontend/dist/assets/*.js; then
    echo "ОТКАЗ: RELEASE_TAG не найден в frontend/dist — шов версии не сработал." >&2
    exit 1
  fi
}

build_images() {
  echo "[2/4] docker build обоих образов под тегом ${RELEASE_TAG}..."
  # Команды дословно из комментариев Dockerfile'ов 12.1: контексты РАЗНЫЕ.
  # --provenance=false: дефолтные BuildKit-аттестации несут таймстамп сборки —
  # image_id менялся бы КАЖДЫЙ прогон даже при полном кэш-хите, превращая
  # repro-сверку id в вечный ложный WARNING (поймано живым прогоном 12.2).
  docker build -q --provenance=false -t "vaps-app:${RELEASE_TAG}" \
    -f "${REPO_ROOT}/Backend/VAPS/Dockerfile" "${REPO_ROOT}/Backend/VAPS" >/dev/null
  docker build -q --provenance=false -t "vaps-nginx:${RELEASE_TAG}" \
    -f "${REPO_ROOT}/deploy/nginx/Dockerfile" "${REPO_ROOT}" >/dev/null
}

image_id() { docker image inspect --format '{{.Id}}' "$1"; }

# Список миграций из СОБРАННОГО образа (Решение №2): без VAPS_DB-env settings
# падает в sqlite-фолбэк — живая БД не нужна, а манифест описывает груз,
# а не дев-дерево. --plan даёт линейный порядок применения.
migrations_from_image() {
  docker run --rm "vaps-app:${RELEASE_TAG}" \
    python manage.py showmigrations --plan | sed -E 's/^\[[ X]\]\s+//'
}

write_manifest() {
  local tar_path="$1" manifest_path="$2"
  local tar_sha tar_size app_id nginx_id
  tar_sha="$(sha256sum "$tar_path" | awk '{print $1}')"
  tar_size="$(stat -c%s "$tar_path")"
  app_id="$(image_id "vaps-app:${RELEASE_TAG}")"
  nginx_id="$(image_id "vaps-nginx:${RELEASE_TAG}")"
  # python3 stdlib вместо jq: jq в системе не гарантирован, а корректное
  # экранирование JSON руками — источник тихих багов.
  migrations_from_image | RELEASE_TAG="$RELEASE_TAG" RELEASE_SHA_FULL="$RELEASE_SHA_FULL" \
    TAR_NAME="$TAR_NAME" TAR_SHA="$tar_sha" TAR_SIZE="$tar_size" \
    APP_ID="$app_id" NGINX_ID="$nginx_id" MIN_UPGRADE_FROM="$MIN_UPGRADE_FROM" \
    python3 -c '
import json, os, sys, datetime
migrations = [l.strip() for l in sys.stdin if l.strip()]
manifest = {
    "schema_version": 1,
    "release_tag": os.environ["RELEASE_TAG"],
    "git_sha": os.environ["RELEASE_SHA_FULL"],
    "build_date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "bundle_file": os.environ["TAR_NAME"],
    "bundle_sha256": os.environ["TAR_SHA"],
    "bundle_size_bytes": int(os.environ["TAR_SIZE"]),
    "images": [
        {"name": "vaps-app:" + os.environ["RELEASE_TAG"], "image_id": os.environ["APP_ID"]},
        {"name": "vaps-nginx:" + os.environ["RELEASE_TAG"], "image_id": os.environ["NGINX_ID"]},
    ],
    "migrations": migrations,
    "min_upgrade_from": None if os.environ["MIN_UPGRADE_FROM"] == "null" else os.environ["MIN_UPGRADE_FROM"],
}
print(json.dumps(manifest, ensure_ascii=False, indent=2))
' > "$manifest_path"
}

do_build() {
  build_frontend
  build_images

  mkdir -p "$BUNDLE_DIR"
  local tar_path="${BUNDLE_DIR}/${TAR_NAME}"
  local manifest_path="${BUNDLE_DIR}/${MANIFEST_NAME}"
  local sums_path="${BUNDLE_DIR}/${SUMS_NAME}"

  echo "[3/4] docker save (оба образа одним архивом) + manifest + sha256sums..."
  docker save "vaps-app:${RELEASE_TAG}" "vaps-nginx:${RELEASE_TAG}" -o "$tar_path"
  write_manifest "$tar_path" "$manifest_path"
  ( cd "$BUNDLE_DIR" && sha256sum "$TAR_NAME" "$MANIFEST_NAME" > "$SUMS_NAME" )

  # --- AC-7: самопроверка продукта (deferred-work.md:115) -------------------
  # docker save на полном диске пишет усечённый tar, чей sha «зелёный» по
  # факту записи: sha-чек контура ПРОЙДЁТ, а load упадёт после изменений.
  # Контрольный load здесь (идемпотентен — образы резидентны) ловит это на
  # dev-машине, до носителя.
  echo "[4/4] контрольный docker load собранного архива..."
  local size
  size="$(stat -c%s "$tar_path")"
  if [ "$size" -eq 0 ] || ! docker load -i "$tar_path" >/dev/null; then
    echo "ОТКАЗ: архив бит (size=${size}) — артефакты удалены, бандл НЕ собран." >&2
    rm -f "$tar_path" "$manifest_path" "$sums_path"
    exit 1
  fi

  echo
  echo "ГОТОВО. Перенести носителем (вместе с install-обвязкой 12.3):"
  echo "  ${tar_path}"
  echo "  ${manifest_path}"
  echo "  ${sums_path}"
  echo "В контуре: VAPS_IMAGE_TAG=${RELEASE_TAG} в .env (deploy/.env.example)."
}

# --- AC-8: «повторная сборка того же sha даёт тот же состав» ----------------
# Сравниваются ДЕТЕРМИНИРОВАННЫЕ поля манифеста (Решение №4): git_sha,
# release_tag, имена образов, миграции, min_upgrade_from, schema_version.
# build_date/bundle_sha256/bundle_size — вне сравнения (docker save
# недетерминирован побайтово). image_id при расхождении — WARNING, не fail
# (холодный кэш легитимно меняет id при том же составе).
do_verify_repro() {
  local manifest_path="${BUNDLE_DIR}/${MANIFEST_NAME}"
  if [ ! -f "$manifest_path" ]; then
    echo "ОТКАЗ: нет ${manifest_path} — сначала полная сборка (./bundle.sh)." >&2
    exit 1
  fi
  echo "verify-repro: пересборка на ${RELEASE_SHA} и сверка манифеста..."
  build_frontend
  build_images
  local repro_manifest="${BUNDLE_DIR}/.repro-${MANIFEST_NAME}"
  # tar не переупаковываем: сравнивается состав, sha архива вне сравнения —
  # подставляем плейсхолдеры вместо полей архива.
  local app_id nginx_id
  app_id="$(image_id "vaps-app:${RELEASE_TAG}")"
  nginx_id="$(image_id "vaps-nginx:${RELEASE_TAG}")"
  migrations_from_image | RELEASE_TAG="$RELEASE_TAG" RELEASE_SHA_FULL="$RELEASE_SHA_FULL" \
    APP_ID="$app_id" NGINX_ID="$nginx_id" MIN_UPGRADE_FROM="$MIN_UPGRADE_FROM" \
    BASE_MANIFEST="$manifest_path" REPRO_MANIFEST="$repro_manifest" \
    python3 -c '
import json, os, sys
base = json.load(open(os.environ["BASE_MANIFEST"], encoding="utf-8"))
repro = {
    "schema_version": 1,
    "release_tag": os.environ["RELEASE_TAG"],
    "git_sha": os.environ["RELEASE_SHA_FULL"],
    "images": [
        {"name": "vaps-app:" + os.environ["RELEASE_TAG"], "image_id": os.environ["APP_ID"]},
        {"name": "vaps-nginx:" + os.environ["RELEASE_TAG"], "image_id": os.environ["NGINX_ID"]},
    ],
    "migrations": [l.strip() for l in sys.stdin if l.strip()],
    "min_upgrade_from": None if os.environ["MIN_UPGRADE_FROM"] == "null" else os.environ["MIN_UPGRADE_FROM"],
}
json.dump(repro, open(os.environ["REPRO_MANIFEST"], "w", encoding="utf-8"))
DET = ["schema_version", "release_tag", "git_sha", "migrations", "min_upgrade_from"]
fails = [k for k in DET if base.get(k) != repro[k]]
base_names = [i["name"] for i in base.get("images", [])]
repro_names = [i["name"] for i in repro["images"]]
if base_names != repro_names:
    fails.append("images[].name")
if fails:
    print("FAIL: детерминированные поля разошлись: " + ", ".join(fails))
    sys.exit(1)
base_ids = {i["name"]: i["image_id"] for i in base.get("images", [])}
for i in repro["images"]:
    if base_ids.get(i["name"]) != i["image_id"]:
        print("WARNING: image_id разошёлся для " + i["name"] + " (холодный кэш? состав при этом идентичен)")
print("OK: повторная сборка того же sha дала тот же состав.")
'
  rm -f "$repro_manifest"
}

case "$MODE" in
  build) do_build ;;
  --verify-repro) do_verify_repro ;;
  *) echo "Использование: bundle.sh [--verify-repro]" >&2; exit 2 ;;
esac
