"""Build a single transferable shell file using already available code/images."""

import argparse
import base64
import hashlib
import io
import json
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BACKEND = REPO / "Backend/PersonnelStatus/Personnel-Records"
SOURCE_COMMIT = "cbac0f704fdfa2cf9d5c711ff2a1974b174522de"
PREFIX = "Backend/PersonnelStatus/Personnel-Records/"
CTL = """#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec docker compose --env-file images.env --env-file .env -f docker-compose.yml "$@"
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-image", default="smart-josparlau/lan-backend:1172-c637e8264c2a"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compatible-image", action="append", default=[])
    args = parser.parse_args()
    files = subprocess.check_output(
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", SOURCE_COMMIT],
        cwd=REPO,
        text=True,
    ).splitlines()
    files = [
        p[len(PREFIX) :] for p in files if p.startswith(PREFIX) and "/tests/" not in p
    ]
    # The fingerprint program never initializes Django and runs without a network.
    base = json.loads(
        subprocess.check_output(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "python",
                args.base_image,
                "-c",
                (HERE / "fingerprint.py").read_text(),
            ]
        )
    )
    variants = [base]
    for image in args.compatible_image:
        variant = json.loads(
            subprocess.check_output(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--entrypoint",
                    "python",
                    image,
                    "-c",
                    (HERE / "fingerprint.py").read_text(),
                ]
            )
        )
        # Only the separately reviewed LAN documentation settings may differ.
        changed = {p for p in set(base) | set(variant) if base.get(p) != variant.get(p)}
        if changed - {"organization_management/config/settings/lan.py"}:
            raise SystemExit(
                "Additional image changes application code; review it before bundling."
            )
        if variant not in variants:
            variants.append(variant)
    content = {
        name: (HERE / name).read_bytes()
        for name in ("runtime.py", "probe.py", "fingerprint.py")
    }
    for rel in files:
        # Pin the code to the reviewed commit, independent of uncommitted work.
        content["files/" + rel] = subprocess.check_output(
            ["git", "show", SOURCE_COMMIT + ":" + PREFIX + rel], cwd=REPO
        )
    manifest = {
        "source_commit": SOURCE_COMMIT,
        "base_image": args.base_image,
        "ctl": CTL,
        "base_files": base,
        "base_variants": [
            {p: v for p, v in variant.items() if base.get(p) != v}
            for variant in variants
        ],
        "files": {p: hashlib.sha256(content["files/" + p]).hexdigest() for p in files},
    }
    content["manifest.json"] = json.dumps(manifest, sort_keys=True, indent=2).encode()
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(content.items()):
            entry = zipfile.ZipInfo(name, date_time=(2026, 9, 11, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o600 << 16
            z.writestr(entry, data)
    data = archive.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    wrapper = """#!/usr/bin/env bash
# Smart Josparlau: portable staffing import, Plane 1179.
# Исполнитель: Кодекс Астра 6. Requires Docker Compose and host Python 3.
set -uo pipefail
python3 - "$0" "$@" <<'PYTHON_LAUNCHER'
import base64, hashlib, io, os, runpy, sys, tempfile, zipfile
from pathlib import Path
os.umask(0o077)
raw = Path(sys.argv[1]).read_bytes().split(b"\\n__STAFFING_PAYLOAD__\\n", 1)[1]
payload = base64.b64decode(raw)
if hashlib.sha256(payload).hexdigest() != "PAYLOAD_SHA256":
    raise SystemExit("Повреждён скрипт: контрольная сумма не совпадает.")
with tempfile.TemporaryDirectory(prefix="staffing-1179-") as temporary:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        archive.extractall(temporary)
    sys.argv = [str(Path(temporary) / "runtime.py"), *sys.argv[2:]]
    runpy.run_path(sys.argv[0], run_name="__main__")
PYTHON_LAUNCHER
exit "$?"
__STAFFING_PAYLOAD__
""".replace("PAYLOAD_SHA256", digest)
    output = wrapper.encode() + base64.encodebytes(data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    args.output.chmod(0o755)
    checksum = hashlib.sha256(output).hexdigest()
    args.output.with_suffix(args.output.suffix + ".sha256").write_text(
        checksum + "  " + args.output.name + "\n"
    )
    print(
        f"Built {args.output.name}: {len(output)} bytes; {len(files)} backend files; {len(base)} source fingerprints"
    )


if __name__ == "__main__":
    main()
