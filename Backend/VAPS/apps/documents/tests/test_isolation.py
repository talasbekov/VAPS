"""Story 6.1 — app-isolation guard для ``documents`` (канон «в каждом новом
app», зеркало ``apps/notifications/tests/test_isolation.py`` из 5.7c).

Два инварианта границы (ARCH-003/ARCH-004: cross-context ссылки — плоские id
через селекторы, не model-импорты):

* ``apps.operations.*`` — запрещён ВЕЗДЕ (documents не знает operations;
  владелец ссылается на Attachment, не наоборот — Ловушка №1);
* ``apps.core.models`` — запрещён вне ``models.py`` (исключение по Д1:
  ``models.py`` легально импортирует abstract-базу ``UUIDTimeStampedModel``).

Наследует hardening 5.7c: ``_imports`` резолвит relative-уровни и
``from pkg import submodule``-алиасинг; пустой ``rglob`` валит тест
(анти-зелёный-вакуум).
"""

import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[2]


def _module_files():
    ctx_dir = APPS_DIR / "documents"
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
            names.extend(f"{module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


def test_documents_does_not_import_operations():
    files = _module_files()
    assert files, f"no modules scanned under {APPS_DIR / 'documents'}"
    offenders = []
    for path in files:
        for mod in _imports(path):
            if mod == "apps.operations" or mod.startswith("apps.operations."):
                offenders.append((str(path), mod))
    assert offenders == [], f"documents imports operations: {offenders}"


def test_documents_does_not_import_core_models_outside_models():
    files = _module_files()
    assert files, f"no modules scanned under {APPS_DIR / 'documents'}"
    offenders = []
    for path in files:
        if path.name == "models.py":
            continue  # Д1: легальный импорт abstract-базы UUIDTimeStampedModel
        for mod in _imports(path):
            if mod == "apps.core.models" or mod.startswith("apps.core.models."):
                offenders.append((str(path), mod))
    assert offenders == [], (
        f"documents imports core.models outside models.py: {offenders}"
    )
