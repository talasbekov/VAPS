import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[3] / "apps"
FORBIDDEN_CROSS_CONTEXT = {"operations", "analytics", "documents", "notifications"}


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


def test_core_does_not_import_other_context_models():
    offenders = []
    for path in _module_files("core"):
        for mod in _imports(path):
            for ctx in FORBIDDEN_CROSS_CONTEXT:
                if mod.startswith(f"apps.{ctx}.models") or mod.startswith(f"apps.{ctx}"):
                    offenders.append((str(path), mod))
    assert offenders == [], f"core imports forbidden cross-context modules: {offenders}"
