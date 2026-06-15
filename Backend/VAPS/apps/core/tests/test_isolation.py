import ast
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]
APPS_DIR = BASE_DIR / "apps"
CONFIG_DIR = BASE_DIR / "config"
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


def _string_constants(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


def test_x_user_id_literal_only_in_core_auth():
    # Boundary contract (ARCH-SEC-030): the X-User-Id header is read only by
    # the authentication class in apps/core/auth/. Catches both spellings:
    # "X-User-Id" (headers API) and "HTTP_X_USER_ID" (META). config/ is in
    # scope too: settings or middleware could read the header just as easily.
    auth_dir = APPS_DIR / "core" / "auth"
    offenders = []
    for path in [*APPS_DIR.rglob("*.py"), *CONFIG_DIR.rglob("*.py")]:
        if (
            "tests" in path.parts
            or path.name == "tests.py"
            or path.is_relative_to(auth_dir)
        ):
            continue
        for value in _string_constants(path):
            normalized = value.lower().replace("-", "_")
            if "x_user_id" in normalized:
                offenders.append((str(path), value))
    assert offenders == [], f"X-User-Id read outside core/auth: {offenders}"


WALL_CLOCK_DENYLIST = (
    "timezone.now",
    "timezone.localtime",
    "timezone.localdate",
    "date.today",
    "datetime.now",
    "datetime.today",
    "datetime.utcnow",
    "datetime.fromtimestamp",
    "time.time",
)

_WALL_CLOCK_SUFFIXES = tuple("." + entry for entry in WALL_CLOCK_DENYLIST)


def _is_wall_clock(dotted):
    # Dot boundary: user_timezone.now() must not match "timezone.now".
    return ("." + dotted).endswith(_WALL_CLOCK_SUFFIXES)


def _import_aliases(tree):
    # local name -> canonical dotted origin, so aliased reads (tz.now(),
    # dt.datetime.now()) and bare-name reads (`from django.utils.timezone
    # import now; now()`) resolve to their real wall-clock source.
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    aliases[alias.asname] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return aliases


def _domain_layer_files():
    # services/models of every app: bare services.py/models.py files and the
    # contents of services/ or models/ packages (covers future nested apps
    # like apps/operations/<sub>/). tests/ and migrations/ are out of scope.
    files = []
    for path in APPS_DIR.rglob("*.py"):
        if "tests" in path.parts or "migrations" in path.parts:
            continue
        if path.name in ("services.py", "models.py"):
            files.append(path)
        elif "services" in path.parts or "models" in path.parts:
            files.append(path)
    return files


def test_no_wall_clock_reads_in_domain_layers():
    # ARCH-DATA-022: core.clock.Clock is the single wall-clock read point.
    # Attribute calls are matched both raw and canonicalized through import
    # aliases; bare-name calls catch `from ... import now`. auto_now /
    # auto_now_add are keyword arguments, not calls, so models stay green.
    offenders = []
    for path in _domain_layer_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        aliases = _import_aliases(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Attribute):
                dotted = ast.unparse(node.func)
                head, _, rest = dotted.partition(".")
                canonical = f"{aliases.get(head, head)}.{rest}"
                if _is_wall_clock(dotted) or _is_wall_clock(canonical):
                    offenders.append((str(path), dotted))
            elif isinstance(node.func, ast.Name):
                canonical = aliases.get(node.func.id)
                if canonical and _is_wall_clock(canonical):
                    offenders.append((str(path), node.func.id))
    assert offenders == [], f"wall clock read outside core.clock: {offenders}"


def test_core_does_not_import_other_context_models():
    offenders = []
    for path in _module_files("core"):
        for mod in _imports(path):
            for ctx in FORBIDDEN_CROSS_CONTEXT:
                prefix = f"apps.{ctx}"
                if mod.startswith(f"{prefix}.models") or mod.startswith(prefix):
                    offenders.append((str(path), mod))
    assert offenders == [], f"core imports forbidden cross-context modules: {offenders}"
