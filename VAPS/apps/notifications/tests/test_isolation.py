"""Story 5.7c — app-isolation guard for ``notifications`` (closes 5.7a defer F6).

Mirror of ``apps/operations/tests/test_isolation.py``: an AST scan asserting no
module under ``apps/notifications`` imports ``apps.core.models`` directly
(ARCH-003/ARCH-004 — cross-context references are flat ids resolved via
selectors, never a core-model import). Today nothing violates it (the 5.7c
read-API touches only ``apps.notifications.models``); the guard is forward
protection now that the app has grown an API layer — a future file importing
``apps.core.models`` unnoticed would silently break the boundary.

Hardened over the operations mirror (5.7c code-review): ``_imports`` resolves
relative levels and ``from pkg import submodule`` aliasing, so
``from apps.core import models`` and ``from ..core.models import X`` are caught
too — binding the submodule under an alias is the cheapest bypass. The scan
also asserts it found modules at all: an empty ``rglob`` after a layout move
would otherwise keep the guard forever-green while scanning nothing.
"""

import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[2]


def _module_files(context: str):
    ctx_dir = APPS_DIR / context
    return [p for p in ctx_dir.rglob("*.py") if "tests" not in p.parts]


def _imports(path: Path):
    """Absolute dotted paths imported by *path* (relative levels and
    ``from pkg import submodule`` aliasing resolved)."""
    package = list(path.relative_to(APPS_DIR.parent).parts[:-1])
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                base = package[: len(package) - (node.level - 1)]
                module = ".".join(base + ([node.module] if node.module else []))
            else:
                module = node.module or ""
            names.append(module)
            # `from apps.core import models` binds the submodule — record the
            # full dotted path so the boundary check sees it.
            names.extend(f"{module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


def test_notifications_does_not_import_core_models():
    files = _module_files("notifications")
    # A guard that scans nothing is forever green — fail loudly if the app
    # layout moved out from under APPS_DIR instead of reporting "no offenders".
    assert files, f"no modules scanned under {APPS_DIR / 'notifications'}"
    offenders = []
    for path in files:
        for mod in _imports(path):
            if mod == "apps.core.models" or mod.startswith("apps.core.models."):
                offenders.append((str(path), mod))
    assert offenders == [], f"notifications imports core.models directly: {offenders}"
