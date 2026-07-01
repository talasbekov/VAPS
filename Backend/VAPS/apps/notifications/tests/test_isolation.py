"""Story 5.7c — app-isolation guard for ``notifications`` (closes 5.7a defer F6).

Mirror of ``apps/operations/tests/test_isolation.py``: an AST scan asserting no
module under ``apps/notifications`` imports ``apps.core.models`` directly
(ARCH-003/ARCH-004 — cross-context references are flat ids resolved via
selectors, never a core-model import). Today nothing violates it (the 5.7c
read-API touches only ``apps.notifications.models``); the guard is forward
protection now that the app has grown an API layer — a future file importing
``apps.core.models`` unnoticed would silently break the boundary.
"""

import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[2]


def _module_files(context: str):
    ctx_dir = APPS_DIR / context
    return [p for p in ctx_dir.rglob("*.py") if "tests" not in p.parts]


def _imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


def test_notifications_does_not_import_core_models():
    offenders = []
    for path in _module_files("notifications"):
        for mod in _imports(path):
            if mod == "apps.core.models" or mod.startswith("apps.core.models."):
                offenders.append((str(path), mod))
    assert offenders == [], f"notifications imports core.models directly: {offenders}"
