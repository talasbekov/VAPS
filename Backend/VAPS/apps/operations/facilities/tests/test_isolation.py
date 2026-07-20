"""AST isolation guards for the facilities subdomain (14.1).

The parent guard (apps/operations/tests/test_isolation.py) already bans
apps.core.models imports across ALL of operations, including this app. What it
does NOT pin is the subdomain topology: facilities is a standalone subdomain —
architecture.md's dependency table (L585-594) names no arrow to or from it, and
"silence = STOP" means no import until the architecture says otherwise (the
14.6 OM_AUTO projection will define the sanctioned seam towards statuses).
"""

import ast
from pathlib import Path

FACILITIES_DIR = Path(__file__).resolve().parents[1]

_FORBIDDEN_PREFIXES = (
    "apps.operations.statuses",
    "apps.operations.submissions",
    "apps.operations.rbac",
)


def _module_files():
    return [p for p in FACILITIES_DIR.rglob("*.py") if "tests" not in p.parts]


def _imports(path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            names.append(node.module)
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


def test_facilities_does_not_import_sibling_subdomains():
    offenders = []
    for path in _module_files():
        for mod in _imports(path):
            if mod in _FORBIDDEN_PREFIXES or mod.startswith(
                tuple(p + "." for p in _FORBIDDEN_PREFIXES)
            ):
                offenders.append((str(path), mod))
    assert offenders == [], f"facilities imports sibling subdomains: {offenders}"
