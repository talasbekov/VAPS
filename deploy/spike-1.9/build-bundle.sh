#!/usr/bin/env bash
# Спайк 1.9 — сборка самодостаточного бандла на DEV-машине (online).
# Прото-bundle.sh (минимальная механика для 12.2): доказать save + sha256, НЕ воспроизводить
# manifest.json / digests / список миграций — это E12.
#
# Результат: vaps-probe-<gitsha>.tar (тяжёлый, НЕ коммитится) + sha256sums.txt (НЕ коммитится).
# В контур носителем переносятся: этот .tar, sha256sums.txt, install-probe.sh, docker-compose.yml, RUNBOOK.md.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="vaps-probe:spike-1.9"          # фиксированный тег → стабильная ссылка в docker-compose.yml
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TAR="vaps-probe-${GIT_SHA}.tar"

echo "[1/3] docker build (${IMAGE}, sha=${GIT_SHA})..."
docker build \
  --build-arg GIT_SHA="${GIT_SHA}" \
  --build-arg BUILD_DATE="${BUILD_DATE}" \
  -t "${IMAGE}" .

echo "[2/3] docker save -> ${TAR} (самодостаточный архив для носителя)..."
docker save "${IMAGE}" -o "${TAR}"

echo "[3/3] sha256sum -> sha256sums.txt (проверка целостности после переноса)..."
sha256sum "${TAR}" > sha256sums.txt

# digest образа — для воспроизводимости (фиксируется в RUNBOOK.md)
DIGEST="$(docker image inspect "${IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo '<no-digest-local-build>')"

echo
echo "ГОТОВО. Перенести носителем в контур:"
echo "  - ${TAR}"
echo "  - sha256sums.txt"
echo "  - install-probe.sh, docker-compose.yml, RUNBOOK.md"
echo
echo "Образ:  ${IMAGE}  (base digest: ${DIGEST})"
cat sha256sums.txt
