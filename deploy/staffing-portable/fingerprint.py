"""Fingerprint deployed Python sources, ignoring caches and test-only files."""

import hashlib
import json
from pathlib import Path


def fingerprint(root):
    result = {}
    for path in sorted((root / "organization_management").rglob("*.py")):
        rel = path.relative_to(root)
        if (
            "tests" in rel.parts
            or path.name == "tests.py"
            or path.name.startswith(("test_", "tests_"))
        ):
            continue
        result[rel.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


if __name__ == "__main__":
    print(json.dumps(fingerprint(Path("/app")), sort_keys=True))
