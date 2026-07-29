"""Story 4.6 — audit-coverage CI guard (AR-9). No production code: this IS the guard.

Two facets:

* **B — source-derived closed world.** AST-scan every ``record()``/``record_many()``
  call site across ``apps/**`` and collect the ``action`` codes the code ACTUALLY
  emits; assert ``emitted ⊆ docs/registries/audit-events.yaml::actions``. This
  replaces story 4.4's hand-maintained literal ``_STORY_4_4_ACTIONS`` (the
  deferred-work.md:401 gap): ``literal ⊆ registry`` → ``source ⊆ registry``, so a
  service emitting an unregistered code **in literal form** turns CI red.

  INVARIANT this guard relies on (and which the codebase must keep): an audit
  ``action`` code is a STRING LITERAL passed directly to ``record``/``record_many``
  (kwarg ``record(action="X")`` or dict-literal value), and audit rows are written
  only via ``record()``/``record_many()`` (enforced by ``test_audit_write_boundary``).
  The scan deliberately does NOT resolve non-literal forms — ``action=SOME_CONST`` /
  f-strings / a list bound to a variable then passed to ``record_many(var)`` /
  ``record`` re-imported under an alias / a direct ``AuditLog.objects.create(...)``
  would be INVISIBLE here (silent false-green). All current emissions are literal,
  so the guard is exact today; a future emitter using a non-literal form must either
  keep the invariant or extend this scan. (Hardening the scan to FAIL on a non-literal
  ``action=`` is deferred — deferred-work.md, code review 4.6.)
* **A — route-coverage living registry.** Walk the URL resolver, take every
  mutating route (POST/PUT/PATCH/DELETE incl. write ``@action``), and require each
  to be classified in ``AUDIT_MATRIX`` as ``_Audited`` | ``_DeferredAudit(ref)``.
  A new mutating route absent from the matrix → red (AR-9: "новая мутация без
  аудита не пройдёт CI"). Audit is wired at the SERVICE level (4.4); the two
  submissions routes are the first ``_Audited`` (5.9 — submit_day/amend_day emit,
  test_submission_audit pins through the route), the rest stay ``_DeferredAudit``.

Only ONE direction is asserted for facet B (``emitted ⊆ registry``): the registry
is a forward seed carrying codes for not-yet-built epics (AUTH_*/ASSIGNMENT_*/...),
so ``registry ⊆ emitted`` (no-orphans) would fail and is deliberately NOT asserted.

Mirrors: ``test_rbac_matrix`` (resolver walk + ``_DeferredGate``),
``exception_handler.emitted_codes`` (source-derived ⊆ registry),
``test_audit_write_boundary`` (AST rglob+walk, skip ``tests/``). PyYAML is absent
in the venv → the registry is parsed indent-aware (same as ``test_status_audit``).
"""

import ast
import re
from pathlib import Path

from django.conf import settings
from django.urls import get_resolver
from django.urls.resolvers import URLPattern, URLResolver

_APPS_DIR = Path(settings.BASE_DIR) / "apps"
_REGISTRY = Path(settings.BASE_DIR).parent.parent / "docs/registries/audit-events.yaml"


# ---------------------------------------------------------------------------
# Facet B — source-derived emitted action codes (AST scan)
# ---------------------------------------------------------------------------
_RECORD_FUNCS = {"record", "record_many"}


def _call_name(func):
    """Callable name from an ``ast.Call.func`` — ``record(...)`` (Name) or
    ``services.record(...)`` (Attribute)."""
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _actions_in_tree(tree):
    """All ``action`` string literals emitted via ``record``/``record_many`` in
    one parsed module. Catches both LITERAL forms, and ONLY record/record_many calls:

    * keyword: ``record(action="STATUS_CREATED", ...)``
    * dict-literal: ``record_many([{"action": "STATUS_CREATED", ...}, ...])``
      (bulk_status_service builds entry dicts in a list-comp — the action is a
      dict VALUE, not a kwarg).

    Scoping to ``record``/``record_many`` calls keeps DRF ``@action(...)``
    decorators and unrelated dicts with an "action" key out of the result.

    LIMITATION (see module docstring invariant): only string LITERALS sitting
    directly in the call are extracted. A non-literal ``action`` (named constant,
    f-string, conditional) or a dict/list bound to a variable then passed to
    ``record_many(var)`` is NOT resolved and stays invisible to the scan. The
    codebase keeps audit codes as direct literals, so this is exact today.
    """
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or _call_name(node.func) not in _RECORD_FUNCS:
            continue
        # (a) keyword form
        for kw in node.keywords:
            if (
                kw.arg == "action"
                and isinstance(kw.value, ast.Constant)
                and isinstance(kw.value.value, str)
            ):
                found.add(kw.value.value)
        # (b) dict-literal form (inside list/comprehension args)
        for arg in node.args:
            for sub in ast.walk(arg):
                if not isinstance(sub, ast.Dict):
                    continue
                for key, value in zip(sub.keys, sub.values):
                    if (
                        isinstance(key, ast.Constant)
                        and key.value == "action"
                        and isinstance(value, ast.Constant)
                        and isinstance(value.value, str)
                    ):
                        found.add(value.value)
    return found


def _emitted_actions():
    """Every audit ``action`` code emitted by production source under ``apps/**``
    (``tests/`` excluded — test files carry literals that would self-pollute)."""
    actions = set()
    for path in _APPS_DIR.rglob("*.py"):
        if "tests" in path.parts:
            continue
        actions |= _actions_in_tree(ast.parse(path.read_text(encoding="utf-8")))
    return actions


def _registry_actions():
    """``audit_logs.action`` codes from the registry — indent-aware parse (no
    PyYAML), reading ONLY the ``actions:`` section (NOT the separate
    ``status_history_action_codes:`` dictionary). Mirrors
    ``test_status_audit._registry_actions``."""
    actions, in_actions = set(), False
    for line in _REGISTRY.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line.startswith(" "):
            in_actions = stripped == "actions:"
            continue
        if in_actions:
            m = re.match(r"^  ([A-Z][A-Z0-9_]*):", line)
            if m:
                actions.add(m.group(1))
    return actions


def test_emitted_actions_subset_of_registry():
    # source ⊆ registry. The reverse (registry ⊆ emitted) is intentionally NOT
    # asserted: audit-events.yaml is a forward seed with codes for not-yet-built
    # epics (AUTH_*/ASSIGNMENT_*/...), so no-orphans would fail today (реш. №3).
    missing = _emitted_actions() - _registry_actions()
    assert not missing, (
        f"эмитируемые код(ы) вне audit-events.yaml actions: {sorted(missing)} "
        "(growth_rule: добавь action в реестр тем же PR)"
    )


def test_emission_scan_not_vacuous():
    # Anti-green-vacuum: a broken AST walk / wrong paths must fail, not pass on 0.
    # Floor = the 11 codes story 4.4 wired into the E3 services.
    emitted = _emitted_actions()
    assert len(emitted) >= 11, emitted


def test_scan_detects_both_emission_forms():
    # Guards the guard: the scanner catches kwarg AND dict-literal forms, and
    # ignores a same-named kwarg on a non-record call.
    snippet = (
        'record(action="KWARG_FORM", entity_type="x", entity_id=1)\n'
        'record_many([{"actor": a, "action": "DICT_FORM"} for x in xs])\n'
        'some_other_call(action="NOT_A_RECORD_CALL")\n'
    )
    assert _actions_in_tree(ast.parse(snippet)) == {"KWARG_FORM", "DICT_FORM"}


# ---------------------------------------------------------------------------
# Facet A — route-coverage living registry (mirror of test_rbac_matrix)
# ---------------------------------------------------------------------------
_WRITE_METHODS = {"post", "put", "patch", "delete"}
_NON_ENDPOINT_NAMES = {"api-root"}


class _Audited:
    """A mutating route that emits an AuditLog row (directly or via its service
    layer) AND carries a behavioral test pinning the emission through the route
    (the 5.9 HTTP-smoke pair in test_submission_audit is the pattern)."""

    audited = True


class _DeferredAudit:
    """A mutating route NOT yet audited — audit deferred to ``fix_ref``. Audit
    (4.4) is wired at the SERVICE level; a route flips to ``_Audited`` when its
    service emits + a behavioral test proves it through the route (5.9 flipped
    the first two). The value of this gate is COMPLETENESS — a new mutating
    route must be classified, or CI goes red (AR-9)."""

    audited = False

    def __init__(self, fix_ref):
        self.fix_ref = fix_ref


# Why these are deferred (no mutating route audits today — verified):
_CORE = (
    "core CRUD-мутации не аудируются — E4-аудит покрыл только E3-статусы на "
    "сервис-уровне (4.4); аудит core-путей = будущая hardening-стори"
)
_RBAC = "RBAC-admin мутации не аудируются — будущая admin-аудит стори"
_NOTIF = (
    "отметка прочтения — личная UX-мутация на своей же строке (self-scope, "
    "не RBAC-право), не бизнес-событие с compliance-следом; аудит не "
    "мотивирован тем же обоснованием, что _CORE/_RBAC"
)
_BUGREPORTS = (
    "story 13.1a: BugReport-строка САМА является append-only записью "
    "(created_at/created_by/user_id) — не бизнес-мутация с юридическим/"
    "финансовым следом (в отличие от DOCUMENT_ISSUED/DAILY_SUBMISSION_*), "
    "аналогично _NOTIF; отдельный AuditLog-канал не мотивирован"
)

# Declarative registry: route name → audit verdict. UPDATE when a mutating route
# is added (AR-9 living registry; a missing row fails test_audit_matrix_covers_*).
AUDIT_MATRIX = {
    # core personnel.* (Employee + StaffingSlot):
    "employee-list": _DeferredAudit(_CORE),
    "employee-detail": _DeferredAudit(_CORE),
    "employee-archive": _DeferredAudit(_CORE),
    "employee-restore": _DeferredAudit(_CORE),
    "staffing-slot-list": _DeferredAudit(_CORE),
    "staffing-slot-detail": _DeferredAudit(_CORE),
    "staffing-slot-assign-employee": _DeferredAudit(_CORE),
    "staffing-slot-release": _DeferredAudit(_CORE),
    # core orgstructure.* (Division + Position + Rank):
    "division-list": _DeferredAudit(_CORE),
    "division-detail": _DeferredAudit(_CORE),
    "position-list": _DeferredAudit(_CORE),
    "position-detail": _DeferredAudit(_CORE),
    "rank-list": _DeferredAudit(_CORE),
    "rank-detail": _DeferredAudit(_CORE),
    # operations RBAC admin:
    "ops-user-role-list": _DeferredAudit(_RBAC),
    "ops-user-role-detail": _DeferredAudit(_RBAC),
    "ops-temp-duty-list": _DeferredAudit(_RBAC),
    "ops-temp-duty-expire": _DeferredAudit(_RBAC),
    # submissions (5.8a → 5.9): DAILY_SUBMISSION_SUBMITTED эмитится на
    # СЕРВИС-уровне (submit_day, канон 4.4); поведенческие пины + HTTP-smoke
    # сквозь роут — test_submission_audit (5.9).
    "ops-daily-submission-list": _Audited(),
    # amend (5.8b → 5.9): DAILY_SUBMISSION_AMENDED эмитится в amend_day (один
    # канал на HTTP 5.8b и хук 5.4b); пины — test_submission_audit (5.9).
    "ops-daily-submission-amend": _Audited(),
    # attachments upload (6.1): ATTACHMENT_UPLOADED эмитится на СЕРВИС-уровне
    # (create_attachment, канон 4.4) в той же транзакции; HTTP-smoke сквозь
    # роут — test_attachment_api (паттерн test_submission_audit 5.9).
    "documents-attachment-list": _Audited(),
    # expense-report POST issue (6.10a): DOCUMENT_ISSUED/DOCUMENT_SUPERSEDED
    # эмитятся в issue_expense_document (6.5) в той же транзакции; период —
    # GET-only, не мутирует. (GET-by-date на том же роуте read-only.)
    "ops-expense-report-list": _Audited(),
    # override «на завтра»-блока (6.10b): TOMORROW_BLOCK_OVERRIDDEN эмитится в
    # override_tomorrow_block (5.6b/5.9) в той же транзакции.
    "ops-expense-report-override-tomorrow-block": _Audited(),
    # bugreports POST create (13.1a): see _BUGREPORTS above.
    "bugreport-list": _DeferredAudit(_BUGREPORTS),
    # bulk-создание статусов (10.1a): STATUS_CREATED (record_many, по строке) +
    # STATUS_BULK_CREATED (summary) эмитятся в bulk_create_statuses (3.8/4.4) в
    # той же транзакции; HTTP-smoke сквозь роут — test_bulk_status_api
    # (test_bulk_emits_audit_through_route, паттерн test_submission_audit 5.9).
    "ops-status-bulk": _Audited(),
    # отметка прочтения уведомления (11.4a): личная UX-мутация на своей же
    # строке (read_at), не бизнес-событие, требующее compliance-следа, как
    # смена статуса/выпуск документа — тот же класс, что _CORE/_RBAC ниже.
    "notification-mark-read": _DeferredAudit(_NOTIF),
}


def _walk(resolver):
    for pattern in resolver.url_patterns:
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern)
        elif isinstance(pattern, URLPattern):
            cb = pattern.callback
            yield pattern.name, getattr(cb, "cls", None), getattr(cb, "actions", None)


def _served_mutating():
    """name → set(write-methods) for every route serving ≥1 mutating verb. Same
    introspection as ``test_rbac_matrix._served_routes`` (both DRF patterns:
    router-ViewSet via ``callback.actions``, plain APIView via handlers ∩
    ``http_method_names``), narrowed to write verbs."""
    served = {}
    for name, cls, actions in _walk(get_resolver()):
        if cls is None or name in _NON_ENDPOINT_NAMES:
            continue
        allowed = {m.lower() for m in getattr(cls, "http_method_names", [])}
        if actions:
            methods = {m for m in actions if m in allowed}
        else:
            methods = {
                m
                for m in allowed
                if m in _WRITE_METHODS and callable(getattr(cls, m, None))
            }
        methods = {m for m in methods if m in _WRITE_METHODS}
        if methods:
            served.setdefault(name, set()).update(methods)
    return served


def test_audit_matrix_covers_every_mutating_route():
    """Every mutating route ∈ AUDIT_MATRIX; no stale rows (AR-9 completeness)."""
    served = set(_served_mutating())
    matrix = set(AUDIT_MATRIX)
    missing = served - matrix
    stale = matrix - served
    assert not missing, (
        f"мутирующие роуты без строки в AUDIT_MATRIX (AR-9 — классифицируй "
        f"_Audited/_DeferredAudit): {sorted(missing)}"
    )
    assert not stale, (
        f"протухшие строки AUDIT_MATRIX (роут удалён — убери): {sorted(stale)}"
    )


def test_route_introspection_not_vacuous():
    # Anti-green-vacuum: a broken URLconf must fail, not pass on an empty walk.
    assert _served_mutating(), (
        "интроспекция вернула 0 мутирующих роутов — сломан резолвер/URLconf"
    )


def test_audit_matrix_verdicts_are_explicit():
    for name, spec in AUDIT_MATRIX.items():
        assert isinstance(spec, (_Audited, _DeferredAudit)), (
            f"{name}: неизвестный вердикт"
        )
        if isinstance(spec, _DeferredAudit):
            assert spec.fix_ref, f"{name}: _DeferredAudit без fix_ref"
