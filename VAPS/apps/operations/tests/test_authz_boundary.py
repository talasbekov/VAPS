"""Boundary-guard: бизнес-слой не консультирует Django-auth (Story 2.9).

Хвост ревью 2.8 (deferred-work.md#L209): ``PermissionsMixin`` сделал
``has_perm``/``has_module_perms``/``is_staff``/``is_superuser`` живыми на
``User`` app-wide, а суперюзер шунтирует ВСЕ Django-проверки. Авторизация
бизнес-логики ОСТАЁТСЯ за in-house ``PermissionService`` (ARCH-SEC-031);
Django-permissions — только для admin-поверхности (стори 2.10+).

Этот тест ловит, если api/services/selectors начнут консультировать
Django-auth (включая ``request.user``, обходящий контракт X-User-Id /
``request.actor_id``). Аппарат — AST-скан, прецедент
``apps/*/tests/test_isolation.py``.
"""
import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[2]
CORE_DIR = APPS_DIR / "core"
CORE_AUTH_DIR = CORE_DIR / "auth"
CORE_MODELS = CORE_DIR / "models.py"

# Django-auth-механика, запрещённая в бизнес-слое.
FORBIDDEN_ATTRS = {"has_perm", "has_module_perms", "is_staff", "is_superuser"}


def _business_files():
    """Бизнес-слой: вся логика operations + core api/services/selectors.

    Исключены: tests/migrations; ``core/models.py`` (там легитимны
    ``is_staff``/``is_superuser`` из ``PermissionsMixin``); ``core/auth/``
    (единственная точка контракта X-User-Id).
    """
    files = []
    for path in (APPS_DIR / "operations").rglob("*.py"):
        if "tests" in path.parts or "migrations" in path.parts:
            continue
        files.append(path)
    for path in (CORE_DIR / "api").rglob("*.py"):
        if "tests" in path.parts:
            continue
        files.append(path)
    for name in ("services.py", "selectors.py"):
        fp = CORE_DIR / name
        if fp.exists():
            files.append(fp)
    for pkg in ("services", "selectors"):
        pkg_dir = CORE_DIR / pkg
        if pkg_dir.is_dir():
            for path in pkg_dir.rglob("*.py"):
                if "tests" in path.parts:
                    continue
                files.append(path)
    return files


def _violations(path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        if node.attr in FORBIDDEN_ATTRS:
            found.append(node.attr)
        elif node.attr == "user":
            base = ast.unparse(node.value)
            if base == "request" or base.endswith(".request"):
                found.append(f"{base}.user")
    return found


def test_business_layer_does_not_consult_django_auth():
    offenders = []
    for path in _business_files():
        for hit in _violations(path):
            offenders.append((str(path), hit))
    assert offenders == [], (
        "бизнес-слой консультирует Django-auth "
        f"(используй PermissionService): {offenders}"
    )


def test_guard_excludes_legitimate_django_auth_sites():
    # Sanity: легитимные дома Django-auth существуют и НЕ сканируются —
    # core/models.py (User.is_staff/is_superuser) и core/auth/ (X-User-Id).
    assert CORE_MODELS.exists()
    assert CORE_AUTH_DIR.is_dir()
    scanned = set(_business_files())
    # Анти-вакуум: если пути сломаны и scanned пуст, основной guard прошёл
    # бы ни о чём (offenders == []).
    assert scanned, "boundary-скан пуст — сломаны пути _business_files()"
    assert any("operations" in p.parts for p in scanned), (
        "operations не попал в boundary-скан"
    )
    assert CORE_MODELS not in scanned
    assert not any(p.is_relative_to(CORE_AUTH_DIR) for p in scanned)
