"""Stories 11.1/11.2 — architectural guards for WS transport and delivery.

Invariants the epic calls out explicitly, all enforced as pytest tests rather
than CI steps: the only CI workflow in the repo runs the DONOR
(``Backend/PersonnelStatus``), so the de-facto gate for VAPS is the local
``make gate`` (README.md:15, architecture.md#L341). «fail CI» therefore means
«fail inside gate» (Решение №5).

From 11.1 (the transport):

1. The channel layer is Redis-backed and cannot be swapped by configuration —
   an in-memory layer drops ``group_send`` from any other process silently.
2. Consumers never touch the ORM outside ``database_sync_to_async``. Forward
   protection: today's consumer has no ORM access at all; the guard stands
   before 11.2/11.4 want to read ``Notification`` inside the socket.

From 11.2 (the first sender):

3. Every ``Notification.Kind`` exists in ``docs/registries/ws-message-types.yaml``
   — the registry declares a СТОП-rule for itself but, until now, no test made it
   binding, which is exactly how the one kind the product emits came to be
   missing from it.
4. ``group_send`` is only ever reached from a ``transaction.on_commit`` callback
   (architecture.md#L459). An inline send passes every happy-path test and fails
   only on a rollback, in production, announcing a row that no longer exists.

Style mirrors ``apps/notifications/tests/test_isolation.py``: AST-based (never
grep — see below), with an anti-vacuum ``assert files`` so a layout move fails
loudly instead of scanning nothing and reporting «no offenders».
"""

import ast
import re
import tomllib
from pathlib import Path

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from config.asgi import application
from config.settings import channel_layers_from_env

BACKEND_DIR = Path(__file__).resolve().parents[3]
APPS_DIR = BACKEND_DIR / "apps"
CONFIG_DIR = BACKEND_DIR / "config"
TESTS_DIR = Path(__file__).resolve().parent
WS_REGISTRY = BACKEND_DIR.parent.parent / "docs/registries/ws-message-types.yaml"

_FORBIDDEN_LAYER = "InMemoryChannelLayer"
_WRAPPER = "database_sync_to_async"

# Manager-level access is caught by the `.objects` rule below; these are the
# instance/queryset calls that would otherwise slip past it.
_ORM_CALLS = {
    "save",
    "delete",
    "get",
    "filter",
    "create",
    "get_or_create",
    "update",
    "refresh_from_db",
}


def _string_constants(tree):
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


def test_channel_layer_is_redis_backed():
    assert (
        settings.CHANNEL_LAYERS["default"]["BACKEND"]
        == "channels_redis.core.RedisChannelLayer"
    )


# ---------------------------------------------------------------------------
# ASGI wiring (AC-3)
# ---------------------------------------------------------------------------


def test_asgi_application_routes_http_and_websocket():
    # Losing either key is a silent outage of a whole protocol: no HTTP branch
    # means the REST API stops existing under ASGI, no websocket branch means
    # every handshake is rejected by the router rather than by the consumer.
    assert set(application.application_mapping) == {"http", "websocket"}


def test_asgi_entrypoint_is_the_configured_one():
    # A correct config/asgi.py that nothing points at would leave the deployed
    # server on the old stack while every test here stays green.
    assert settings.ASGI_APPLICATION == "config.asgi.application"
    assert "channels" in settings.INSTALLED_APPS
    # architecture: the project runs ASGI-only; a resurrected WSGI entrypoint
    # would serve HTTP without ever mounting the websocket branch.
    assert settings.WSGI_APPLICATION is None


# ---------------------------------------------------------------------------
# The channel-layer env helper (AC-2)
# ---------------------------------------------------------------------------


def test_channel_layers_defaults_to_loopback_redis():
    layers = channel_layers_from_env({})
    assert layers["default"]["CONFIG"]["hosts"] == ["redis://127.0.0.1:6379/0"]


@pytest.mark.parametrize(
    "url",
    [
        # Set-but-empty is NOT «unset»: an operator wiring an empty secret must
        # get a boot failure, not a silent fallback to loopback (review 11.1).
        "",
        "   ",
        "memory://",
        "http://127.0.0.1:6379",
        "amqp://127.0.0.1:5672",
        "127.0.0.1:6379",
    ],
)
def test_channel_layers_refuses_a_non_redis_url(url):
    # Fail on boot, not silently: a channel layer pointed at something that is
    # not Redis does not error at send time — group_send simply goes nowhere.
    with pytest.raises(ImproperlyConfigured):
        channel_layers_from_env({"VAPS_REDIS_URL": url})


def test_channel_layer_class_is_not_selectable_by_env():
    # The env picks the ADDRESS, never the class. Anything else would put the
    # InMemory layer one environment variable away from production.
    layers = channel_layers_from_env(
        {"VAPS_REDIS_URL": "rediss://user:secret@redis.internal:6380/1"}
    )
    assert (
        layers["default"]["BACKEND"] == "channels_redis.core.RedisChannelLayer"
    )
    assert layers["default"]["CONFIG"]["hosts"] == [
        "rediss://user:secret@redis.internal:6380/1"
    ]


def test_in_memory_channel_layer_is_absent_from_config():
    # AST string constants, NOT a grep over the text. The rationale for banning
    # the in-memory layer has to live in settings.py, and a grep could not tell a
    # `#`-comment (invisible to the AST) from a docstring — the explanation itself
    # would trip the guard. Comments are the required form there; this scan is
    # what makes that requirement consistent instead of contradictory.
    files = list(CONFIG_DIR.rglob("*.py"))
    assert files, f"no modules scanned under {CONFIG_DIR}"
    offenders = []
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for value in _string_constants(tree):
            if _FORBIDDEN_LAYER in value:
                offenders.append((str(path), value))
    assert offenders == [], (
        f"{_FORBIDDEN_LAYER} referenced under config/: {offenders} — group_send "
        "from another process would be dropped silently (architecture.md#L337)"
    )


# ---------------------------------------------------------------------------
# ORM inside async consumers (AC-7)
# ---------------------------------------------------------------------------


def _dotted(node):
    return ast.unparse(node)


def _root_name(node):
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _model_symbols(tree):
    """Names imported from a ``models`` module — the «model symbols» whose method
    calls count as ORM access. Without this, banning ``.get()`` outright would
    flag every ``self.scope.get("actor_id")`` in the file."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module == "models" or node.module.endswith(".models"):
                names.update(alias.asname or alias.name for alias in node.names)
    return names


def _is_wrapper_call(node):
    return isinstance(node, ast.Call) and _dotted(node.func).endswith(_WRAPPER)


def _walk_unwrapped(node):
    """Descendants of *node*, skipping subtrees handed to ``database_sync_to_async``
    (both the ``database_sync_to_async(fn)()`` call form and a nested sync
    function carrying it as a decorator)."""
    for child in ast.iter_child_nodes(node):
        if _is_wrapper_call(child):
            continue
        if isinstance(child, ast.FunctionDef) and any(
            _dotted(d).endswith(_WRAPPER) for d in child.decorator_list
        ):
            continue
        yield child
        yield from _walk_unwrapped(child)


def _orm_in_async(tree):
    """``(function, expression)`` for every unwrapped ORM access inside an
    ``async def``. Blocking ORM calls on the event loop stall EVERY socket the
    process serves, not just the offending one."""
    models = _model_symbols(tree)
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for sub in _walk_unwrapped(node):
            if isinstance(sub, ast.Attribute) and sub.attr == "objects":
                offenders.append((node.name, _dotted(sub)))
            elif (
                isinstance(sub, ast.Call)
                and isinstance(sub.func, ast.Attribute)
                and sub.func.attr in _ORM_CALLS
                and _root_name(sub.func.value) in models
            ):
                offenders.append((node.name, _dotted(sub)))
    return offenders


def _consumer_files():
    return sorted(APPS_DIR.rglob("consumers*.py"))


def test_consumers_use_database_sync_to_async():
    files = _consumer_files()
    assert files, f"no consumers*.py scanned under {APPS_DIR}"
    offenders = []
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        offenders.extend((str(path), *item) for item in _orm_in_async(tree))
    assert offenders == [], (
        f"ORM access inside async def without {_WRAPPER}: {offenders}"
    )


def test_notify_message_type_routes_to_an_existing_handler():
    # The exported contract for 11.2: Channels dispatches an envelope by turning
    # the dots of its `type` into underscores. If the shared constant and the
    # handler name ever drift, group_send from notify() would crash the consumer
    # at runtime («No handler for message type»), not fail a lint.
    from apps.notifications.consumers import NotificationConsumer
    from apps.notifications.groups import NOTIFY_MESSAGE_TYPE

    handler = getattr(
        NotificationConsumer, NOTIFY_MESSAGE_TYPE.replace(".", "_"), None
    )
    assert callable(handler), (
        f"no consumer handler for channel-layer type {NOTIFY_MESSAGE_TYPE!r}"
    )


def test_scan_detects_orm_in_async():
    # Guards the guard (pattern: test_audit_coverage::test_scan_detects_both_
    # emission_forms). A scanner that silently matches nothing would keep the
    # test above forever-green.
    snippet = (
        "from apps.notifications.models import Notification\n"
        "from channels.db import database_sync_to_async\n"
        "class C:\n"
        "    async def bad_manager(self):\n"
        "        return Notification.objects.filter(read_at=None).count()\n"
        "    async def bad_instance(self, n):\n"
        "        Notification.get(n)\n"
        "    async def ok_wrapped(self):\n"
        "        return await database_sync_to_async("
        "lambda: Notification.objects.count())()\n"
        "    def sync_is_fine(self):\n"
        "        return Notification.objects.count()\n"
        "    async def dict_get_is_not_orm(self):\n"
        '        return self.scope.get("actor_id")\n'
    )
    flagged = {name for name, _ in _orm_in_async(ast.parse(snippet))}
    assert flagged == {"bad_manager", "bad_instance"}, flagged


# ---------------------------------------------------------------------------
# Dependency boundaries (AC-1, AC-9)
# ---------------------------------------------------------------------------


def _dist_name(spec):
    """``"channels-redis>=4.3,<5"`` → ``"channels-redis"``; PEP-503 normalised."""
    bare = re.split(r"[<>=!~;\[ ]", spec, maxsplit=1)[0]
    return bare.strip().lower().replace("_", "-")


def _declared_dependencies():
    data = tomllib.loads((BACKEND_DIR / "pyproject.toml").read_text(encoding="utf-8"))
    runtime = [_dist_name(s) for s in data["project"]["dependencies"]]
    dev = [
        _dist_name(s) for s in data["project"]["optional-dependencies"]["dev"]
    ]
    return runtime, dev


def test_ws_transport_declares_its_own_dependencies():
    runtime, dev = _declared_dependencies()
    assert runtime, "no runtime dependencies parsed from pyproject.toml"
    # channels-redis is not optional: without it the layer falls back to nothing
    # that carries group_send across processes.
    assert {"channels", "channels-redis"} <= set(runtime)
    assert "pytest-asyncio" in dev


def test_no_server_or_worker_stack_is_introduced():
    """AC-9 boundary: 11.1 ships a transport, not a deployment.

    ``daphne``/``uvicorn`` belong to 12.1 and ``celery`` is forbidden outright
    (epics.md#L759, ARCH-DEFERRED-048). Each of them also drags C-extensions into
    the offline mirror of the контур, so «it came in transitively» is not a
    detail that can be noticed later — hence a test rather than a code review.
    """
    runtime, dev = _declared_dependencies()
    declared = set(runtime) | set(dev)
    assert declared, "no dependencies parsed from pyproject.toml"
    intruders = declared & {"daphne", "uvicorn", "celery"}
    assert intruders == set(), (
        f"out-of-scope dependencies declared: {sorted(intruders)} — "
        "servers are 12.1, Celery is forbidden (AC-9)"
    )


# ---------------------------------------------------------------------------
# The gate really brings Redis up (AC-8)
# ---------------------------------------------------------------------------


def test_gate_starts_redis_and_points_the_suite_at_it():
    """The published port and the URL the gate exports must agree.

    Asserting the literal 6380 would break the moment the port is (legitimately)
    changed; asserting they MATCH breaks only when they drift apart — which is
    the actual failure, and it surfaces as «tests connected to someone else's
    Redis», not as an error.
    """
    compose = (BACKEND_DIR / "docker-compose.yml").read_text(encoding="utf-8")
    makefile = (BACKEND_DIR / "Makefile").read_text(encoding="utf-8")

    published = re.search(r'"(\d+):6379"', compose)
    assert published, "docker-compose.yml publishes no redis port"

    exported = re.search(r"VAPS_REDIS_URL=(\S+)", makefile)
    assert exported, "the gate exports no VAPS_REDIS_URL"
    assert f":{published.group(1)}/" in exported.group(1), (
        f"gate points at {exported.group(1)} but compose publishes "
        f"{published.group(1)}"
    )

    # Every recipe line that starts the DB must start Redis too — a target that
    # brings up Postgres alone leaves the WS suite failing on connection refused
    # instead of on anything meaningful. Comment lines are not recipes.
    starts = [
        line.strip()
        for line in makefile.splitlines()
        if "docker compose up" in line and not line.strip().startswith("#")
    ]
    assert starts, "no target starts the compose services"
    assert all("redis" in line for line in starts), (
        f"a target starts the DB without redis: {starts}"
    )


# ---------------------------------------------------------------------------
# The message-type registry is a CONTRACT, not a document (11.2 AC-2)
# ---------------------------------------------------------------------------


def _registry_types():
    """UPPER_SNAKE codes from the ``types:`` section of ``ws-message-types.yaml``.

    Indent-aware parse, no PyYAML — mirror of
    ``test_audit_coverage._registry_actions``. ``import yaml`` does work in the
    venv (PyYAML rides in transitively as a hard dependency of drf-spectacular),
    but it is NOT declared in pyproject.toml: pinning a gate test to an
    undeclared transitive dependency makes it disappear the day drf-spectacular
    changes its own deps.

    Reading ONLY ``types:`` matters — ``meta:`` carries ``priorities`` and
    ``payload_fields`` lists that are not message types.
    """
    types, in_types = set(), False
    for line in WS_REGISTRY.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line.startswith(" "):
            in_types = stripped == "types:"
            continue
        if in_types:
            m = re.match(r"^  ([A-Z][A-Z0-9_]*):", line)
            if m:
                types.add(m.group(1))
    return types


def test_notification_kinds_subset_of_ws_registry():
    """code ⊆ registry. The reverse («no orphans») is deliberately NOT asserted:
    the other 24 codes are forward seeds for epics 14-20 with no emitter today,
    so registry ⊆ code would be red on arrival — exact mirror of решение №3 in
    ``test_audit_coverage.test_emitted_actions_subset_of_registry``.

    Until 11.2 the registry was referenced by ZERO tests, which is precisely how
    ``SUBMISSION_LAGGING`` — the one kind the product actually emits — lived
    outside it for two epics. The СТОП-rule the file declares for itself only
    binds anything once something enforces it.
    """
    from apps.notifications.models import Notification

    missing = set(Notification.Kind.values) - _registry_types()
    assert not missing, (
        f"Notification.Kind вне ws-message-types.yaml: {sorted(missing)} "
        "(growth_rule: «Тип не в реестре → СТОП. Новые типы — тем же PR.»)"
    )


def test_registry_parse_is_not_vacuous():
    # Anti-green-vacuum: an empty set passes the subset check above trivially.
    # Floor = 24 donor seeds + SUBMISSION_LAGGING (11.2). Deliberately 25, not
    # 24: a floor of 24 would still be met by a parser that silently loses
    # exactly one entry.
    types = _registry_types()
    assert len(types) >= 25, types
    # The section boundary holds — `meta:` keys must not leak in as «types».
    assert "PRIORITIES" not in types and "PAYLOAD_FIELDS" not in types


def test_registry_has_no_misindented_type_blocks():
    """Ловушка №8: the parser above matches UPPER_SNAKE keys at EXACTLY two
    spaces, so a type block added one level deeper is invisible to it.

    Direction matters, and it is why this is a separate test. Re-indenting an
    EXISTING type is caught by the floor above — the parsed count drops to 24.
    Adding a NEW one at the wrong indent is not: the count never moves, so the
    floor is still met, the subset check still passes and the guard-the-guard
    still rejects a made-up code, while the type just declared silently does not
    exist as far as the СТОП-rule is concerned. YAML loads the file without
    complaint either way — verified by red probe, this test is the only one that
    goes red on that shape, which is exactly the one Task 1 warns about
    («лишний пробел = невидимый тип»).
    """
    stray, in_types = [], False
    for line in WS_REGISTRY.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line.startswith(" "):
            in_types = stripped == "types:"
            continue
        if not in_types:
            continue
        deeper = re.match(r"^( +)([A-Z][A-Z0-9_]*):\s*$", line)
        if deeper and len(deeper.group(1)) != 2:
            stray.append((deeper.group(2), len(deeper.group(1))))
    assert stray == [], (
        f"type blocks at a non-standard indent: {stray} — invisible to "
        "_registry_types(), so the СТОП-rule would not cover them"
    )


def test_registry_parse_rejects_unknown_kind():
    # Guards the guard (pattern: test_audit_coverage::test_scan_detects_both_
    # emission_forms). A parser matching everything — or the comparison being
    # done in the wrong direction — would keep the subset test forever-green.
    synthetic = {"SUBMISSION_LAGGING", "TOTALLY_MADE_UP"}
    assert synthetic - _registry_types() == {"TOTALLY_MADE_UP"}


def test_ws_tests_are_never_skipped():
    """AC-8, anti-vacuum: «skip = зелёно» is the exact hole ретро E9 AI-1 closed.

    The gate starts Redis itself, so a WS test has no legitimate reason to skip.
    Marking one `skipif(redis is unreachable)` would turn the central AC-6
    assertion green on a machine where delivery never worked at all —
    indistinguishable from having no test.
    """
    files = sorted(TESTS_DIR.glob("test_ws_*.py"))
    assert files, f"no WS test modules scanned under {TESTS_DIR}"
    offenders = []
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in {
                "skip",
                "skipif",
                "importorskip",
            }:
                offenders.append((path.name, _dotted(node)))
    assert offenders == [], f"skips found in WS tests: {offenders}"


# ---------------------------------------------------------------------------
# group_send travels ONLY through transaction.on_commit (11.2 AC-10)
# ---------------------------------------------------------------------------


def _on_commit_targets(tree):
    """Names of functions whose OBJECT is handed to ``transaction.on_commit``.

    Resolves the ``partial(fn, ...)`` form as well as a bare ``on_commit(fn)``.
    A lambda deliberately resolves to nothing: ``on_commit(lambda: _publish(n))``
    passes a function that merely CALLS the sender, and this guard is about the
    sender itself being the registered callback.
    """
    targets = set()
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call) and _dotted(node.func).endswith("on_commit")
        ):
            continue
        for arg in node.args:
            if isinstance(arg, ast.Name):
                targets.add(arg.id)
            elif isinstance(arg, ast.Call) and _dotted(arg.func).endswith("partial"):
                if arg.args and isinstance(arg.args[0], ast.Name):
                    targets.add(arg.args[0].id)
    return targets


def _group_send_sites(tree):
    """Innermost enclosing named function for every ``group_send`` reference.

    An ATTRIBUTE scan, not a call scan: the sender is written
    ``async_to_sync(layer.group_send)(...)``, where ``group_send`` is passed as a
    value and never appears as the func of a Call. ``None`` means the reference
    sits at module level (or only inside a lambda) — inline by definition.
    """
    sites = set()

    def visit(node, enclosing):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, child.name)
                continue
            if isinstance(child, ast.Attribute) and child.attr == "group_send":
                sites.add(enclosing)
            visit(child, enclosing)

    visit(tree, None)
    return sites


def _group_send_outside_on_commit(tree):
    targets = _on_commit_targets(tree)
    return {site for site in _group_send_sites(tree) if site not in targets}


def test_group_send_only_inside_on_commit():
    """architecture.md#L459: «отправка ТОЛЬКО через transaction.on_commit».

    Forward protection. Today there is exactly one sender (``notify()``), but
    11.4 (mark-as-read) and 11.5 (kill-switch) add more, and an inline
    ``group_send`` is the failure that passes every happy-path test and only
    shows up on a rollback in production — announcing a row that no longer
    exists. The rule has to outlive the author who learned it.
    """
    files = [p for p in APPS_DIR.rglob("*.py") if "tests" not in p.parts]
    assert files, f"no production modules scanned under {APPS_DIR}"

    offenders, sites = [], 0
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        sites += len(_group_send_sites(tree))
        offenders.extend(
            (str(path), name) for name in _group_send_outside_on_commit(tree)
        )

    # Anti-vacuum, second layer: `assert files` proves the scan saw modules, this
    # proves it still recognises a sender. Were group_send renamed upstream, the
    # guard would otherwise keep passing while enforcing nothing at all.
    assert sites >= 1, "no group_send site found in production code at all"
    assert offenders == [], (
        f"group_send outside a transaction.on_commit callback: {offenders} — "
        "an inline send announces rows a rollback then removes "
        "(architecture.md#L459)"
    )


def test_scan_detects_group_send_outside_on_commit():
    # Guards the guard. Covers all four shapes that matter: the partial form used
    # by notify(), a bare function reference, a plain inline call, and the lambda
    # — which is NOT accepted, because what reaches on_commit there is the
    # lambda, not the sender (`partial` also avoids the late-binding trap).
    snippet = (
        "from functools import partial\n"
        "from django.db import transaction\n"
        "def _partial_target(n):\n"
        "    async_to_sync(get_channel_layer().group_send)(g, m)\n"
        "def _bare_target(n):\n"
        "    layer.group_send(g, m)\n"
        "def _inline(n):\n"
        "    async_to_sync(get_channel_layer().group_send)(g, m)\n"
        "def _lambda_target(n):\n"
        "    layer.group_send(g, m)\n"
        "def caller(n):\n"
        "    transaction.on_commit(partial(_partial_target, n))\n"
        "    transaction.on_commit(_bare_target)\n"
        "    transaction.on_commit(lambda: _lambda_target(n))\n"
        "    _inline(n)\n"
    )
    assert _group_send_outside_on_commit(ast.parse(snippet)) == {
        "_inline",
        "_lambda_target",
    }
