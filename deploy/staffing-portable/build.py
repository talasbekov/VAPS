"""Build a single transferable shell file using already available code/images."""

import argparse
import base64
import hashlib
import io
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BACKEND = REPO / "Backend/PersonnelStatus/Personnel-Records"
SOURCE_COMMIT = "ab7ccb0ba0681b3719e324923cfc3b05d37b06e3"
SOURCE_BASE = "cbac0f704fdfa2cf9d5c711ff2a1974b174522de^"
PREFIX = "Backend/PersonnelStatus/Personnel-Records/"
CTL = """#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec docker compose --env-file images.env --env-file .env -f docker-compose.yml "$@"
"""


# Exact delivered manifests; maps are rebuilt from reviewed historical Git bytes.
# The older digest uses the same delivered base/compatibility fingerprints.
PREVIOUS_RELEASES = (
    (
        "8d88fea8b1bfac4be04b686874be7679a7b36409",
        "04f7dd1d8f3e65d81aa1736bab187a0cb30b387cefe0dcc3e44c20bca6de08e3",
    ),
    (
        "c1f852312059cd3d98e13d654338c1e6378499d9",
        "2e238226f1309b36c57c8c47fe9448f9f7711e1428637554e86f8386e4f2de0f",
    ),
    (
        "f3d03fc3acae676a76f1bfbd10219813b2a66b45",
        "70b30e60678355315604ba093ae13683680a4c23bdca6d8a85382da1cccf5a41",
    ),
    (
        "dbd9a0c3c7e08e641ca9743656150cc245af8d78",
        "b0881be67dc144a6cb2d2cf2eb3e33660af40ff6ec4cda9c06e64395fd75ae8d",
    ),
    (
        "05e4d78b1f5a8da47c2ab9e8cb3db50af4e410a3",
        "b3c9deee03303eae8d5bf0a9d147f8bf4941c4cf06b8958c665a31826b00fe80",
    ),
)


def previous_versions():
    versions = []
    for commit, digest in PREVIOUS_RELEASES:
        paths = subprocess.check_output(
            ["git", "diff", "--name-only", SOURCE_BASE, commit], cwd=REPO, text=True
        ).splitlines()
        files = {}
        for path in paths:
            if path.startswith(PREFIX) and "/tests/" not in path:
                data = subprocess.check_output(
                    ["git", "show", commit + ":" + path], cwd=REPO
                )
                files[path[len(PREFIX) :]] = hashlib.sha256(data).hexdigest()
        versions.append({"manifest_sha256": digest, "files": files})
    return versions


def read_password_file(path):
    try:
        with path.open("rb") as stream:
            raw = stream.read(1025)
        password = raw.decode("utf-8-sig").removesuffix("\n").removesuffix("\r")
    except (OSError, UnicodeError):
        raise SystemExit("Не удалось прочитать файл пароля.") from None
    if not password or len(raw) > 1024 or any(c in password for c in "\r\n\0"):
        raise SystemExit(
            "Файл пароля должен содержать одну непустую строку, не более 1024 байт."
        )
    return raw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-image", default="smart-josparlau/lan-backend:1172-c637e8264c2a"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--account-password-file",
        type=Path,
        help="Приватный файл общего пароля; вкладывается только в переносимый артефакт, не в исходники.",
    )
    parser.add_argument("--compatible-image", action="append", default=[])
    args = parser.parse_args()
    password = None
    if args.account_password_file:
        password = read_password_file(args.account_password_file)
    files = subprocess.check_output(
        ["git", "diff", "--name-only", SOURCE_BASE, SOURCE_COMMIT],
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
                "--pull=never",
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
                    "--pull=never",
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
    if password is not None:
        content["account-password.txt"] = password
    for rel in files:
        # Pin the code to the reviewed commit, independent of uncommitted work.
        content["files/" + rel] = subprocess.check_output(
            ["git", "show", SOURCE_COMMIT + ":" + PREFIX + rel], cwd=REPO
        )
    manifest = {
        "source_commit": SOURCE_COMMIT,
        "previous_versions": previous_versions(),
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
original_shell = Path(sys.argv[1]).absolute()
os.environ["STAFFING_ORIGINAL_SHELL"] = str(original_shell)
raw = original_shell.read_bytes().split(b"\\n__STAFFING_PAYLOAD__\\n", 1)[1]
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
    with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(output)
            stream.flush()
            os.fchmod(stream.fileno(), 0o700 if password is not None else 0o755)
            os.fsync(stream.fileno())
            os.replace(temporary, args.output)
        finally:
            temporary.unlink(missing_ok=True)
    checksum = hashlib.sha256(output).hexdigest()
    args.output.with_suffix(args.output.suffix + ".sha256").write_text(
        checksum + "  " + args.output.name + "\n"
    )
    print(
        f"Built {args.output.name}: {len(output)} bytes; {len(files)} backend files; {len(base)} source fingerprints"
    )


if __name__ == "__main__":
    main()
