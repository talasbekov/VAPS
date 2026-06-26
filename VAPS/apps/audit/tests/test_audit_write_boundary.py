"""Story 4.3 — AST boundary: only apps/audit touches the model.

architecture.md §Communication Patterns: "MUST NOT: raw insert в аудит-таблицу."
Every write goes through ``apps.audit.services.record()``; no module OUTSIDE
``apps/audit`` may import ``apps.audit.models`` directly (reads, too, go through
the audit app — the read-API, story 4.5, lives inside ``apps/audit``). Mirrors
``apps/core/tests/test_isolation.py::_imports``.
"""

import ast
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]
APPS_DIR = BASE_DIR / "apps"
CONFIG_DIR = BASE_DIR / "config"
AUDIT_DIR = APPS_DIR / "audit"
_TARGET = "apps.audit.models"


def _imports_audit_models(path: Path) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            # from apps.audit.models import X / from apps.audit.models.y import X
            if node.module == _TARGET or node.module.startswith(_TARGET + "."):
                return True
            # from apps.audit import models
            if node.module == "apps.audit" and any(
                alias.name == "models" for alias in node.names
            ):
                return True
        elif isinstance(node, ast.Import):
            # import apps.audit.models [as m]
            if any(
                alias.name == _TARGET or alias.name.startswith(_TARGET + ".")
                for alias in node.names
            ):
                return True
    return False


def test_audit_models_not_imported_outside_audit_app():
    offenders = []
    for path in [*APPS_DIR.rglob("*.py"), *CONFIG_DIR.rglob("*.py")]:
        if (
            "tests" in path.parts
            or path.name == "tests.py"
            or path.is_relative_to(AUDIT_DIR)
        ):
            continue
        if _imports_audit_models(path):
            offenders.append(str(path))
    assert offenders == [], (
        "apps.audit.models imported outside apps/audit — write via "
        f"audit.services.record(): {offenders}"
    )


def test_ban_detects_each_import_form():
    # Guards the guard: every banned spelling is caught; a legit import isn't.
    banned = [
        "from apps.audit.models import AuditLog\n",
        "import apps.audit.models\n",
        "from apps.audit import models\n",
        "import apps.audit.models as m\n",
    ]
    for src in banned:
        with tempfile.NamedTemporaryFile("w", suffix=".py") as fh:
            fh.write(src)
            fh.flush()
            assert _imports_audit_models(Path(fh.name)), src
    with tempfile.NamedTemporaryFile("w", suffix=".py") as fh:
        fh.write("from apps.audit.services import record\n")
        fh.flush()
        assert not _imports_audit_models(Path(fh.name))
