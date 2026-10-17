#!/usr/bin/env python3
"""Export an immutable GitLab revision into the normalized GitHub checkout.

Default: compare only. --apply requires a clean destination and never commits,
pushes, changes branches, or removes files outside its recorded manifest.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

PREFIXES = {
    "PersonnelStatus/Personnel-Records/": "backend/",
    "PersonnelStatus/PersonalRecordFront/": "frontend/",
    "deploy/": "deploy/", "docs/": "docs/", "tools/": "tools/", ".ci/": ".ci/",
}
ROOT_FILES = {"README.md", "AGENTS.md", ".gitlab-ci.yml"}
MANIFEST = ".sync/gitlab-export.json"
EXCLUDED = {"node_modules", ".venv", "venv", ".git", "__pycache__", ".next", ".next-build", "test-results", "playwright-report"}
MAX_FILE_BYTES = 20 * 1024 * 1024

def git(root, *args, data=None):
    return subprocess.check_output(["git", "-C", str(root), *args], input=data)

def mapped(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError("Unsafe Git source path")
    if any(part in EXCLUDED or part.startswith(".next") for part in path.parts):
        return None
    if path.name.startswith(".env") and path.name != ".env.example":
        return None
    if path.name.endswith((".tar", ".tar.gz", ".db", ".sqlite3", ".dump", ".log", ".tsbuildinfo")):
        return None
    if name in ROOT_FILES:
        return name
    for prefix, target in PREFIXES.items():
        if name.startswith(prefix):
            return target + name[len(prefix):]
    return None

def export_tree(source, revision):
    commit = git(source, "rev-parse", "--verify", revision + "^{commit}").decode("ascii").strip()
    entries = {}
    for line in git(source, "ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
        if not line:
            continue
        metadata, encoded_name = line.split(b"\t", 1)
        mode, kind, oid = metadata.decode("ascii").split()
        name = encoded_name.decode("utf-8")
        target = mapped(name)
        if target is None:
            continue
        if kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"Unsupported tracked entry: {name}")
        if target in entries:
            raise ValueError(f"Duplicate export target: {target}")
        entries[target] = {"source": name, "git_blob": oid, "mode": mode}
    oids = sorted({entry["git_blob"] for entry in entries.values()})
    # One batch prevents fetching promisor objects individually.
    payload = git(source, "cat-file", "--batch", data="".join(oid + "\n" for oid in oids).encode("ascii"))
    position = 0
    blobs = {}
    for oid in oids:
        end = payload.index(b"\n", position)
        reported_oid, kind, length = payload[position:end].split()
        if reported_oid.decode() != oid or kind != b"blob":
            raise ValueError("Invalid Git object response")
        length = int(length)
        if length > MAX_FILE_BYTES:
            raise ValueError("Export file exceeds 20 MB; review the mapping explicitly")
        position = end + 1
        blobs[oid] = payload[position:position + length]
        position += length + 1
    return commit, entries, blobs

def target_path(target, relative):
    path = (target / relative).resolve()
    if path == target or not path.is_relative_to(target):
        raise ValueError("Export path escapes destination")
    # Resolving junctions also prevents writing into a linked, unrelated tree.
    return path

def synchronize(source, target, revision="HEAD", apply=False):
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target or source.is_relative_to(target) or target.is_relative_to(source):
        raise ValueError("Use separate source and destination repositories")
    if git(target, "rev-parse", "--show-toplevel").decode("utf-8").strip().replace("\\", "/") != target.as_posix():
        raise ValueError("Destination must be the Git checkout root")
    if apply and git(target, "status", "--porcelain", "-z"):
        raise ValueError("Destination has local changes; commit or resolve them before applying")
    commit, entries, blobs = export_tree(source, revision)
    manifest_path = target_path(target, MANIFEST)
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    previous_files = previous.get("files", {})
    stale = sorted(set(previous_files) - set(entries))
    for relative in stale:
        # Only remove destinations that the exporter could have owned.
        if not (relative in ROOT_FILES or relative.startswith(tuple(PREFIXES.values()))):
            raise ValueError("Untrusted previous manifest path")
        path = target_path(target, relative)
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() != previous_files[relative]["sha256"]:
            raise ValueError(f"Previously exported file changed: {relative}")
    files, changes = {}, []
    for relative, entry in sorted(entries.items()):
        data = blobs[entry["git_blob"]]
        digest = hashlib.sha256(data).hexdigest()
        files[relative] = {**entry, "sha256": digest}
        path = target_path(target, relative)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            changes.append(relative)
    manifest = {"format": 1, "source": "GitLab erda05508/smart-josparlau", "revision": commit, "files": files}
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    manifest_changed = not manifest_path.is_file() or manifest_path.read_bytes() != encoded
    if apply:
        for relative in changes:
            path = target_path(target, relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blobs[entries[relative]["git_blob"]])
        for relative, entry in entries.items():
            target_path(target, relative).chmod(0o755 if entry["mode"] == "100755" else 0o644)
        for relative in stale:
            path = target_path(target, relative)
            if path.exists():
                path.unlink()
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(encoded)
    result = {"revision": commit, "files": len(files), "changed": len(changes), "removed": len(stale), "manifest_changed": manifest_changed, "applied": apply}
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--revision", default="HEAD")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        result = synchronize(args.source, args.target, args.revision, args.apply)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(result, ensure_ascii=False))
    return 0 if args.apply or not (result["changed"] or result["removed"] or result["manifest_changed"]) else 1

if __name__ == "__main__":
    sys.exit(main())
