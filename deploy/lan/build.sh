#!/usr/bin/env bash
# Build with locally prepared dependencies; export only runtime layers for transfer.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
OUT="${1:?Usage: build.sh /new/absolute/bundle-directory}"
[[ "$OUT" == /* && ! -e "$OUT" && "$OUT" != "$ROOT"/* ]] || { echo 'Use a new absolute output directory outside the repository' >&2; exit 2; }
[[ -z "$(git -C "$ROOT" status --porcelain -- Backend/PersonnelStatus deploy/contour deploy/lan)" ]] || { echo 'Commit application/deployment source first' >&2; exit 1; }
for image in smart-josparlau/contour-python-deps:1 smart-josparlau/contour-node-base:1 smart-josparlau/contour-node-deps:1 smart-josparlau/contour-node-prod-deps:1 postgres:16 redis:7-alpine nginx:1.28-alpine; do
  docker image inspect "$image" >/dev/null || { echo "Prepare missing dependency online before building: $image" >&2; exit 1; }
done
WHEELHOUSE="${2:-$HOME/.cache/smart-josparlau/lan-wheelhouse}"
python3 - "$HERE/ui-assets.lock.json" "$WHEELHOUSE" <<'PYASSETS'
import hashlib,json,sys
from pathlib import Path
lock=json.loads(Path(sys.argv[1]).read_text()); wheel=Path(sys.argv[2])/lock['filename']
if not wheel.exists() or hashlib.sha256(wheel.read_bytes()).hexdigest()!=lock['sha256']:
    raise SystemExit('Prepare UI assets online first: python3 deploy/lan/prepare-assets.py')
PYASSETS
mkdir -p "$OUT"
REV="$(git -C "$ROOT" rev-parse HEAD)"
TAG="1172-${REV:0:12}"
printf '%s\n' "$REV" > "$OUT/source-revision.txt"
docker version --format '{{.Server.Os}}/{{.Server.Arch}}' > "$OUT/platform.txt"
python3 "$ROOT/deploy/contour/snapshot.py" "$ROOT" "$OUT/source"
mkdir -p "$OUT/source/deploy/lan"
for file in docker-compose.yml .env.example settings.py nginx-backend.conf configure.py ctl.sh install.sh data.sh sanitize-copy.py prepare-assets.py ui-assets.lock.json build.sh; do
  cp "$HERE/$file" "$OUT/$file"
  cp "$HERE/$file" "$OUT/source/deploy/lan/$file"
done
mkdir -p "$OUT/source/deploy/lan/wheelhouse"
cp "$WHEELHOUSE"/drf_spectacular_sidecar-*.whl "$OUT/source/deploy/lan/wheelhouse/"
D="$OUT/source/deploy/contour"
export DOCKER_BUILDKIT=1
docker build --network=none --pull=false -f "$D/Dockerfile.backend" -t "smart-josparlau/lan-backend-base:$TAG" "$OUT/source"
cat > "$OUT/source/deploy/lan/Dockerfile.backend" <<DOCKERFILE
FROM smart-josparlau/lan-backend-base:$TAG
COPY deploy/lan/settings.py /app/organization_management/config/settings/lan.py
COPY deploy/lan/wheelhouse/ /tmp/lan-wheelhouse/
RUN pip install --no-index --no-deps /tmp/lan-wheelhouse/*.whl && pip check && rm -rf /tmp/lan-wheelhouse
ENV DJANGO_SETTINGS_MODULE=organization_management.config.settings.lan
DOCKERFILE
docker build --network=none --pull=false -f "$OUT/source/deploy/lan/Dockerfile.backend" -t "smart-josparlau/lan-backend:$TAG" "$OUT/source"
docker build --network=none --pull=false -f "$D/Dockerfile.frontend" -t "smart-josparlau/lan-frontend:$TAG" "$OUT/source"
cp "$D/Dockerfile.proxy" "$OUT/source/deploy/lan/Dockerfile.proxy"
echo 'COPY deploy/lan/nginx-backend.conf /etc/nginx/conf.d/lan-backend.conf' >> "$OUT/source/deploy/lan/Dockerfile.proxy"
docker build --network=none --pull=false -f "$OUT/source/deploy/lan/Dockerfile.proxy" -t "smart-josparlau/lan-proxy:$TAG" "$OUT/source"
# Unique local tags pin the selected runtime images without a registry at install.
docker tag postgres:16 "smart-josparlau/lan-postgres:$TAG"
docker tag redis:7-alpine "smart-josparlau/lan-redis:$TAG"
cat > "$OUT/images.env" <<IMAGES
BACKEND_IMAGE=smart-josparlau/lan-backend:$TAG
FRONTEND_IMAGE=smart-josparlau/lan-frontend:$TAG
PROXY_IMAGE=smart-josparlau/lan-proxy:$TAG
POSTGRES_IMAGE=smart-josparlau/lan-postgres:$TAG
REDIS_IMAGE=smart-josparlau/lan-redis:$TAG
IMAGES
mapfile -t IMAGES < <(cut -d= -f2 "$OUT/images.env")
docker image inspect "${IMAGES[@]}" --format '{{json .RepoTags}} {{.Id}} {{.Os}}/{{.Architecture}}' > "$OUT/images-manifest.txt"
docker save "${IMAGES[@]}" | gzip -1 > "$OUT/runtime-images.tar.gz"
# Source snapshot is included for traceability; build dependencies are not required to run.
(cd "$OUT" && find source -type f -print0 | sort -z | xargs -0 sha256sum > source-sha256sums.txt)
(cd "$OUT" && sha256sum runtime-images.tar.gz source-revision.txt platform.txt images.env images-manifest.txt source-sha256sums.txt docker-compose.yml .env.example settings.py nginx-backend.conf configure.py ctl.sh install.sh data.sh sanitize-copy.py prepare-assets.py ui-assets.lock.json build.sh > sha256sums.txt)
echo "Runtime bundle ready: $OUT"
