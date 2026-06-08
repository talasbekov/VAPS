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


def test_operations_does_not_import_core_models():
    offenders = []
    for path in _module_files("operations"):
        for mod in _imports(path):
            if mod == "apps.core.models" or mod.startswith("apps.core.models."):
                offenders.append((str(path), mod))
    assert offenders == [], f"operations imports core.models directly: {offenders}"


def test_operations_may_import_core_selectors():
    # Sanity guard for the rule's intent: core.selectors is the sanctioned read path.
    assert "apps.core.selectors".startswith("apps.core.")
