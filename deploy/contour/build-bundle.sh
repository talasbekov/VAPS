#!/usr/bin/env bash
# Extends spike-1.9: separate online dependency preparation from offline source build.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
MODE="${1:-}"
OUT="${2:-}"
if [[ ! "$MODE" =~ ^(prepare|build)$ || -z "$OUT" ]]; then
  echo 'Usage: build-bundle.sh prepare|build /absolute/path/to/bundle' >&2
  exit 2
fi
mkdir -p -- "$OUT"
OUT="$(cd -- "$OUT" && pwd)"
export DOCKER_BUILDKIT=1
if [[ "$MODE" == prepare ]]; then
  ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
  if [[ -n "$(git -C "$ROOT" status --porcelain -- Backend/PersonnelStatus/Personnel-Records Backend/PersonnelStatus/PersonalRecordFront deploy/contour)" ]]; then
    echo 'Commit application/deployment changes before prepare; the snapshot must match source-revision.txt.' >&2
    exit 1
  fi
  [[ ! -e "$OUT/source" ]] || { echo 'Use a new output directory; snapshot already exists.' >&2; exit 1; }
  python3 "$HERE/snapshot.py" "$ROOT" "$OUT/source"
  git -C "$ROOT" rev-parse HEAD > "$OUT/source-revision.txt"
  docker version --format '{{.Server.Os}}/{{.Server.Arch}}' > "$OUT/platform.txt"
  for image in python:3.12-bookworm node:22-alpine postgres:15 redis:7-alpine nginx:1.28-alpine; do
    docker pull "$image"
  done
  D="$OUT/source/deploy/contour"
  docker build --pull=false --network=default -f "$D/Dockerfile.python-deps" \
    -t smart-josparlau/contour-python-deps:1 "$OUT/source/backend"
  for target in base deps prod-deps; do
    docker build --pull=false --network=default --target "$target" \
      -f "$D/Dockerfile.node-deps" -t "smart-josparlau/contour-node-$target:1" "$OUT/source/frontend"
  done
  # Preserve wheels separately for inspection/use without any runtime download.
  ID="$(docker create smart-josparlau/contour-python-deps:1)"
  trap 'docker rm "$ID" >/dev/null 2>&1 || true' EXIT
  docker cp "$ID:/wheelhouse" "$OUT/wheelhouse"
  docker rm "$ID" >/dev/null
  trap - EXIT
  docker save python:3.12-bookworm node:22-alpine postgres:15 redis:7-alpine nginx:1.28-alpine \
    smart-josparlau/contour-python-deps:1 smart-josparlau/contour-node-base:1 \
    smart-josparlau/contour-node-deps:1 smart-josparlau/contour-node-prod-deps:1 \
    | gzip -1 > "$OUT/prepared-images.tar.gz"
  (cd "$OUT" && sha256sum prepared-images.tar.gz > prepared-sha256sums.txt)
  echo 'ONLINE PREPARE COMPLETE. Next: build-bundle.sh build <same directory>; all source RUN steps use --network=none.'
  exit 0
fi

cd "$OUT"
sha256sum -c prepared-sha256sums.txt
# Loading archives also makes offline rebuilding on a second machine explicit.
docker load -i prepared-images.tar.gz
D="$OUT/source/deploy/contour"
docker build --pull=false --network=none -f "$D/Dockerfile.backend" \
  -t smart-josparlau/contour-backend:1 "$OUT/source"
docker build --pull=false --network=none -f "$D/Dockerfile.frontend" \
  -t smart-josparlau/contour-frontend:1 "$OUT/source"
docker build --pull=false --network=none -f "$D/Dockerfile.proxy" \
  -t smart-josparlau/contour-proxy:1 "$OUT/source"
docker save smart-josparlau/contour-backend:1 smart-josparlau/contour-frontend:1 \
  smart-josparlau/contour-proxy:1 postgres:15 redis:7-alpine | gzip -1 > runtime-images.tar.gz
for file in install.sh docker-compose.yml .env.example README.md build-bundle.sh; do
  cp "$D/$file" "$OUT/$file"
done
docker image inspect python:3.12-bookworm node:22-alpine postgres:15 redis:7-alpine nginx:1.28-alpine \
  smart-josparlau/contour-python-deps:1 smart-josparlau/contour-node-base:1 \
  smart-josparlau/contour-node-deps:1 smart-josparlau/contour-node-prod-deps:1 \
  smart-josparlau/contour-backend:1 smart-josparlau/contour-frontend:1 smart-josparlau/contour-proxy:1 \
  --format '{{json .RepoTags}} {{.Id}} {{json .RepoDigests}}' > images-manifest.txt
find source wheelhouse -type f -print0 | sort -z | xargs -0 sha256sum > source-sha256sums.txt
sha256sum prepared-images.tar.gz runtime-images.tar.gz source-sha256sums.txt \
  source-revision.txt platform.txt images-manifest.txt install.sh docker-compose.yml \
  .env.example README.md build-bundle.sh > sha256sums.txt
echo 'BUNDLE BUILT. Transfer this complete directory. Configure .env, then bash install.sh.'
