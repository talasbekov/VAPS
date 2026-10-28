#!/usr/bin/env python3
"""Prepare dependencies online or build a new LAN bundle offline (Windows/Linux)."""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
APPLICATION_LAYOUTS = (
    ("PersonnelStatus/Personnel-Records", "PersonnelStatus/PersonalRecordFront"),
    ("Backend/PersonnelStatus/Personnel-Records", "Backend/PersonnelStatus/PersonalRecordFront"),
    ("backend", "frontend"),
)
REQUIRED_IMAGES = (
    "smart-josparlau/contour-runtime-base:1", "smart-josparlau/contour-python-deps:1",
    "smart-josparlau/contour-node-base:1", "smart-josparlau/contour-node-deps:1",
    "postgres:16-bookworm", "redis:7-alpine", "nginx:1.28-alpine",
)
BUNDLE_FILES = (
    "docker-compose.yml", ".env.example", "settings.py", "nginx-backend.conf",
    "configure.py", "ctl.sh", "install.sh", "data.sh", "sanitize-copy.py",
    "prepare-assets.py", "ui-assets.lock.json", "redoc.html", "INSTALL-RU.md",
    "UPDATE-RU.md", "update.py", "update-offline.py", "update-app-only.py", "obnovit-bez-bazy.py",
    "cleanup-old-releases.py",
    "update-with-migrations.py", "schema-transition-checks.py", "compose-network-transition.py", "import-smart-data.py",
    "SCHEMA-TRANSITION-RU.md", "SMART-UPDATE-RU.md", "PROD-UPDATE-RU.md",
    "build.py", "build.sh",
)
APPLICATION_FILES = (
    "application-images.tar", "source-revision.txt", "update.py", "update-offline.py",
    "update-app-only.py", "obnovit-bez-bazy.py", "cleanup-old-releases.py", "UPDATE-RU.md",
    "update-with-migrations.py", "schema-transition-checks.py", "compose-network-transition.py", "schema-transition.json",
    "migration-graph.json", "SCHEMA-TRANSITION-RU.md", "PROD-UPDATE-RU.md",
)


def transition_module():
    spec = importlib.util.spec_from_file_location('release_schema_transition', HERE / 'update-with-migrations.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def write_application_manifest(output, revision, images, graph):
    """Bind the current graph, transition policy and exact image contents together."""
    transition = transition_module()
    transition.checks.require_graph(graph, graph)
    def save(name, value):
        (output / name).write_bytes((json.dumps(value, sort_keys=True, indent=2) + '\n').encode('utf-8'))
    save('migration-graph.json', graph)
    selected = {key: images[key] for key in ('backend', 'frontend', 'proxy')}
    save('schema-transition.json', {
        'source_revision': revision, 'policy': transition.checks.RELEASE_POLICY, 'images': selected,
        'reviewed_migrations': [list(item) for item in transition.checks.APPROVED_PLAN],
        'graph_sha256': sha(output / 'migration-graph.json'),
        'files': {name: sha(output / name) for name in ('update-with-migrations.py', 'schema-transition-checks.py', 'compose-network-transition.py')},
    })
    release = {'source_revision': revision, 'compatibility_overlay': False,
               'images': selected, 'files': {name: sha(output / name) for name in APPLICATION_FILES}}
    save('release.json', release)

def run(args, *, capture=False):
    return subprocess.check_output(args).decode("utf-8").strip() if capture else subprocess.run(args, check=True)

def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def layout():
    for backend, frontend in APPLICATION_LAYOUTS:
        if (ROOT / backend / "manage.py").is_file() and (ROOT / frontend / "package-lock.json").is_file():
            return ROOT / backend, ROOT / frontend
    raise ValueError("Cannot find application directories")

def build_image(dockerfile, context, image, *, offline=True, extra=()):
    run(["docker", "build", "--pull=false", *(["--network=none"] if offline else []),
         *extra, "-f", str(dockerfile), "-t", image, str(context)])

def prepare():
    backend, frontend = layout()
    contour = ROOT / "deploy/contour"
    build_image(contour / "Dockerfile.runtime-base", ROOT, REQUIRED_IMAGES[0], offline=False)
    build_image(contour / "Dockerfile.python-deps", backend, REQUIRED_IMAGES[1], offline=False)
    build_image(contour / "Dockerfile.node-deps", frontend, REQUIRED_IMAGES[2], offline=False, extra=("--target", "base"))
    build_image(contour / "Dockerfile.node-deps", frontend, REQUIRED_IMAGES[3], offline=False)
    for image in REQUIRED_IMAGES[4:]:
        run(["docker", "pull", image])
    run([sys.executable, str(HERE / "prepare-assets.py"), str(HERE / "wheelhouse")])

def validate_output(output):
    output = Path(output).resolve()
    if output.exists() or output == ROOT or output.is_relative_to(ROOT):
        raise ValueError("Use a new output directory outside this repository")
    return output

def build(output, *, update_only=False):
    output = validate_output(output)
    if run(["git", "-C", str(ROOT), "status", "--porcelain"], capture=True):
        raise ValueError("Commit reviewed source before building a traceable release")
    revision = run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture=True)
    for image in REQUIRED_IMAGES:
        run(["docker", "image", "inspect", image], capture=True)
    backend, frontend = layout()
    # Refuse a cached npm environment from a different lockfile.
    cached = json.loads(subprocess.check_output(["docker", "run", "--rm", "--network", "none",
        "--entrypoint", "cat", REQUIRED_IMAGES[3], "/app/package-lock.json"]))
    if cached != json.loads((frontend / "package-lock.json").read_text(encoding="utf-8")):
        raise ValueError("Cached node dependencies differ from package-lock.json; run prepare online")
    lock = json.loads((HERE / "ui-assets.lock.json").read_text(encoding="utf-8"))
    wheel = HERE / "wheelhouse" / lock["filename"]
    if not wheel.is_file() or sha(wheel) != lock["sha256"]:
        raise ValueError("Offline UI wheel missing or changed; run prepare-assets.py online")
    output.mkdir(parents=True)
    (output / "source-revision.txt").write_text(revision + "\n", encoding="utf-8")
    (output / "platform.txt").write_text(run(["docker", "version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"], capture=True) + "\n")
    snapshot = output / "source"
    run([sys.executable, str(ROOT / "deploy/contour/snapshot.py"), str(ROOT), str(snapshot)])
    lan = snapshot / "deploy/lan"
    lan.mkdir(parents=True, exist_ok=True)
    for name in BUNDLE_FILES:
        shutil.copy2(HERE / name, output / name)
        shutil.copy2(HERE / name, lan / name)
    (lan / "wheelhouse").mkdir()
    shutil.copy2(wheel, lan / "wheelhouse" / wheel.name)
    tag = "reliability-" + revision[:12]
    images = {service: f"smart-josparlau/lan-{service}:{tag}" for service in ("backend", "frontend", "proxy", "postgres", "redis")}
    contour = snapshot / "deploy/contour"
    build_image(contour / "Dockerfile.backend", snapshot, f"smart-josparlau/lan-backend-base:{tag}")
    (lan / "Dockerfile.backend").write_text(
        f"FROM smart-josparlau/lan-backend-base:{tag}\n"
        "COPY deploy/lan/settings.py /app/organization_management/config/settings/lan.py\n"
        "COPY deploy/lan/redoc.html /app/lan-templates/drf_spectacular/redoc.html\n"
        "COPY deploy/lan/wheelhouse/ /tmp/lan-wheelhouse/\n"
        "RUN pip install --no-index --no-deps /tmp/lan-wheelhouse/*.whl && pip check && rm -rf /tmp/lan-wheelhouse\n"
        "ENV DJANGO_SETTINGS_MODULE=organization_management.config.settings.lan\n", encoding="utf-8")
    build_image(lan / "Dockerfile.backend", snapshot, images["backend"])
    build_image(contour / "Dockerfile.frontend", snapshot, images["frontend"])
    (lan / "Dockerfile.proxy").write_text((contour / "Dockerfile.proxy").read_text(encoding="utf-8") +
        "\nCOPY deploy/lan/nginx-backend.conf /etc/nginx/conf.d/lan-backend.conf\n", encoding="utf-8")
    build_image(lan / "Dockerfile.proxy", snapshot, images["proxy"])
    run(["docker", "tag", "postgres:16-bookworm", images["postgres"]])
    run(["docker", "tag", "redis:7-alpine", images["redis"]])
    (output / "images.env").write_text("".join(key.upper() + "_IMAGE=" + image + "\n" for key, image in images.items()), encoding="utf-8")
    metadata = {}
    for service, image in images.items():
        info = json.loads(subprocess.check_output(["docker", "image", "inspect", image]))[0]
        if info["Os"] != "linux" or info["Architecture"] != "amd64":
            raise ValueError("Release is only supported on linux/amd64")
        metadata[service] = {"tag": image, "id": info["Id"], "os": info["Os"], "architecture": info["Architecture"]}
    (output / "images-manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (output / "images-manifest.txt").write_text("".join(
        f"{item['tag']} {item['id']} {item['os']}/{item['architecture']}\n"
        for item in metadata.values()), encoding="utf-8")
    # Portable application updater: complete reviewed images, no legacy overlay.
    with (output / "application-images.tar").open("wb") as archive:
        subprocess.run(["docker", "save", images["backend"], images["frontend"], images["proxy"]], stdout=archive, check=True)
    transition = transition_module()
    graph = transition.run_json(transition.graph_command(images['backend']), 'graph')
    write_application_manifest(output, revision, metadata, graph)
    # The full install archive includes the application and infrastructure images.
    if not update_only:
        export_runtime_images(output, images)
    (output / "source-sha256sums.txt").write_text("".join(
        f"{sha(file)}  {file.relative_to(output).as_posix()}\n" for file in sorted(snapshot.rglob("*")) if file.is_file()), encoding="utf-8")
    (output / "sha256sums.txt").write_text("".join(
        f"{sha(file)}  {file.name}\n" for file in sorted(output.iterdir()) if file.is_file() and file.name != "sha256sums.txt"), encoding="utf-8")
    print("Offline release ready: " + str(output), flush=True)


def export_runtime_images(output, images):
    with (output / "runtime-images.tar.gz").open("wb") as destination:
        with gzip.GzipFile(fileobj=destination, mode="wb", compresslevel=1, mtime=0) as compressed:
            process = subprocess.Popen(["docker", "save", *images.values()], stdout=subprocess.PIPE)
            try:
                shutil.copyfileobj(process.stdout, compressed, length=4 * 1024 * 1024)
            finally:
                process.stdout.close()
            if process.wait():
                raise RuntimeError("Docker runtime image export failed")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "build"))
    parser.add_argument("output", nargs="?", type=Path)
    parser.add_argument('--update-only', action='store_true', help='Export only application images; omit the full-install infrastructure archive')
    args = parser.parse_args()
    try:
        if args.mode == "prepare":
            prepare()
        elif args.output is None:
            parser.error("build requires a new output directory")
        else:
            build(args.output, update_only=args.update_only)
    except (ValueError, RuntimeError, subprocess.CalledProcessError, OSError) as error:
        raise SystemExit(str(error)) from error

if __name__ == "__main__":
    main()
