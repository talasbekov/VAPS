# PDN Consent Gate (hd-7-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block operators (non-superusers) from doing anything on the site until they
electronically sign the current version of the PDN non-disclosure obligation, right
after the existing forced-password-change step.

**Architecture:** Two new models (`PdnConsentDocument`, versioned text; `PdnConsentSignature`,
the signed record) plus one new middleware (`PdnConsentGateMiddleware`) that mirrors
the existing `ForcePasswordChangeMiddleware` and sits directly after it in
`MIDDLEWARE`. One view function holds the actual sign logic; RU/KZ/EN URL entries
are thin wrappers around it (deliberate deviation from this codebase's usual
full-triplication pattern for legacy views — justified because this is new,
security-relevant logic where one source of truth is safer than three copies; see
plan Task 3 notes). `django.contrib.auth.authenticate` re-checks the operator's own
password as the confirmation step.

**Tech Stack:** Django 5.1.3, DRF (unused here — this is server-rendered), SQLite
test settings (`eventproject.settings_test`), Django admin for document text editing.

**Spec:** `docs/superpowers/specs/2026-08-21-pdn-consent-gate-design.md`

## Global Constraints

- Test command: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test` (SQLite; per `docs/WIKI/development-guide.md` and project memory — do NOT use `.venv_new`).
- Every significant action must go through `eventproject.audit.audit_log(user, action, obj_type, obj_id, ip, extra=None)` — synchronous, in the caller's transaction, never via signals/Celery/on_commit.
- New audit action strings must be registered in `eventproject/audit.py::SIGNIFICANT_ACTIONS` AND covered in `eventproject/tests/test_audit_action_coverage.py::ACTION_COVERAGE` (exact set-equality meta-test) or the full suite fails.
- `ip` fields on audit-adjacent models are `CharField(max_length=45)` in this codebase (see `AuditLog.ip`), not `GenericIPAddressField` — follow that convention for consistency.
- RU templates live in `templates/`, KZ in `templates/kz/`, EN in `templates/en/` — established convention (see `templates/change_password.html` vs `templates/kz/change_password.html`).
- Any HTML/UI work (page layout, copy, accessibility) MUST go through the `ui-ux-pro-max` skill before finalizing markup — standing instruction from the project owner, applies even to this legacy Bootstrap-style `gov_base.html` visual language.
- Never commit secrets; no destructive migrations (this plan only adds tables, no drops/alters of existing ones).
- Local commits only, on branch `security-hardening`. No push, no merge to main.

---

### Task 1: Data models — `PdnConsentDocument` and `PdnConsentSignature`

**Files:**
- Modify: `eventproject/models.py` (append after the `AuditLog` class at end of file)
- Modify: `eventproject/admin.py` (register `PdnConsentDocument` for text editing)
- Create: `eventproject/migrations/0030_pdn_consent.py` (via `makemigrations`)
- Test: `eventproject/tests/test_pdn_consent_models.py`

**Interfaces:**
- Produces: `PdnConsentDocument` (fields: `version` autoincrement PK, `text_ru`,
  `text_kz`, `text_en` TextField, `is_active` BooleanField default False,
  `created_at` auto_now_add, `created_by` FK(User, null=True, on_delete=SET_NULL)).
  Classmethod `PdnConsentDocument.get_active()` → active instance or `None`.
- Produces: `PdnConsentSignature` (fields: `operator` FK(Operator, on_delete=CASCADE,
  related_name="pdn_consent_signatures"), `document_version` FK(PdnConsentDocument,
  on_delete=PROTECT), `signed_at` auto_now_add, `ip` CharField(max_length=45,
  blank=True), `user_agent` CharField(max_length=512, blank=True, default="")).
  `unique_together = ("operator", "document_version")`.

- [ ] **Step 1: Write the failing model tests**

```python
# eventproject/tests/test_pdn_consent_models.py
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.test import TestCase

from eventproject.models import Operator, PdnConsentDocument, PdnConsentSignature


def _make_operator(username):
    user = User.objects.create_user(username=username, password="StrongPass123!")
    return Operator.objects.create(user=user, patronymic="", phone_number="")


class PdnConsentDocumentTests(TestCase):
    def test_activating_a_version_deactivates_the_others(self):
        v1 = PdnConsentDocument.objects.create(
            text_ru="v1", text_kz="v1", text_en="v1", is_active=True
        )
        v2 = PdnConsentDocument.objects.create(
            text_ru="v2", text_kz="v2", text_en="v2", is_active=True
        )
        v1.refresh_from_db()
        self.assertFalse(v1.is_active)
        self.assertTrue(v2.is_active)

    def test_get_active_returns_the_active_version(self):
        PdnConsentDocument.objects.create(
            text_ru="old", text_kz="old", text_en="old", is_active=False
        )
        active = PdnConsentDocument.objects.create(
            text_ru="new", text_kz="new", text_en="new", is_active=True
        )
        self.assertEqual(PdnConsentDocument.get_active().pk, active.pk)

    def test_get_active_returns_none_when_no_document_exists(self):
        self.assertIsNone(PdnConsentDocument.get_active())


class PdnConsentSignatureTests(TestCase):
    def test_duplicate_signature_for_same_operator_and_version_raises(self):
        operator = _make_operator("op1")
        doc = PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        PdnConsentSignature.objects.create(operator=operator, document_version=doc)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PdnConsentSignature.objects.create(
                    operator=operator, document_version=doc
                )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_models --settings=eventproject.settings_test -v 2`
Expected: FAIL / ERROR — `PdnConsentDocument` and `PdnConsentSignature` don't exist yet (ImportError).

- [ ] **Step 3: Add the models**

Append to the end of `eventproject/models.py` (after the `AuditLog` class):

```python
class PdnConsentDocument(models.Model):
    """hd-7-3: версионированный текст обязательства о неразглашении ПДн.

    Ровно одна запись с is_active=True в любой момент времени — save()
    гарантирует это, снимая флаг со всех остальных версий.
    """

    version = models.AutoField(primary_key=True)
    text_ru = models.TextField()
    text_kz = models.TextField()
    text_en = models.TextField()
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL
    )

    def save(self, *args, **kwargs):
        with transaction.atomic():
            super().save(*args, **kwargs)
            if self.is_active:
                PdnConsentDocument.objects.exclude(pk=self.pk).update(
                    is_active=False
                )

    @classmethod
    def get_active(cls):
        return cls.objects.filter(is_active=True).order_by("-created_at").first()

    def __str__(self):
        return f"PdnConsentDocument v{self.version} (active={self.is_active})"


class PdnConsentSignature(models.Model):
    """hd-7-3: неизменяемая запись о подписании обязательства оператором."""

    operator = models.ForeignKey(
        Operator, on_delete=models.CASCADE, related_name="pdn_consent_signatures"
    )
    document_version = models.ForeignKey(
        PdnConsentDocument, on_delete=models.PROTECT
    )
    signed_at = models.DateTimeField(auto_now_add=True)
    ip = models.CharField(max_length=45, blank=True, default="")
    user_agent = models.CharField(max_length=512, blank=True, default="")

    class Meta:
        unique_together = ("operator", "document_version")

    def __str__(self):
        return f"PdnConsentSignature operator={self.operator_id} v={self.document_version_id}"
```

Add `from django.db import models, transaction` — check the top of `eventproject/models.py`
for the existing import line and add `transaction` to it if not already imported
(`grep -n "^from django.db import" eventproject/models.py`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_models --settings=eventproject.settings_test -v 2`
Expected: still FAIL — no migration yet (`no such table`).

- [ ] **Step 5: Generate and inspect the migration**

Run: `.venv/bin/python manage.py makemigrations eventproject --settings=eventproject.settings_test`
Expected output file: `eventproject/migrations/0030_pdn_consent.py` (number may differ
if other migrations landed first — check `ls eventproject/migrations/ | sort | tail -3`
before running and adjust). Open the generated file and confirm it only creates the
two new tables (no alters to existing ones).

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_models --settings=eventproject.settings_test -v 2`
Expected: PASS (4 tests).

- [ ] **Step 7: Register the model in Django admin**

In `eventproject/admin.py`, add:

```python
from .models import Event, Operator, Request, Attendee, PdnConsentDocument


@admin.register(PdnConsentDocument)
class PdnConsentDocumentAdmin(admin.ModelAdmin):
    list_display = ("version", "is_active", "created_at", "created_by")
    list_filter = ("is_active",)
    readonly_fields = ("created_at",)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
```

(`PdnConsentSignature` is intentionally NOT admin-editable — it's an append-only
audit-adjacent record, same posture as `AuditLog`.)

- [ ] **Step 8: Run the full suite to check for regressions**

Run: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test`
Expected: PASS, no regressions (compare failure count to pre-task baseline — should be 0 new failures).

- [ ] **Step 9: Commit**

```bash
git add eventproject/models.py eventproject/admin.py eventproject/migrations/0030_pdn_consent.py eventproject/tests/test_pdn_consent_models.py
git commit -m "feat(hd-7-3): PdnConsentDocument + PdnConsentSignature models"
```

---

### Task 2: Gate middleware

**Files:**
- Create: `eventproject/middleware/pdn_consent_gate.py`
- Modify: `eventproject/settings.py` (add to `MIDDLEWARE`, directly after
  `"eventproject.middleware.force_password_change.ForcePasswordChangeMiddleware"`)
- Test: `eventproject/tests/test_pdn_consent_gate_middleware.py`

**Interfaces:**
- Consumes: `PdnConsentDocument.get_active()` (Task 1), `Operator` via
  `request.user.operator` (existing pattern from `force_password_change.py`).
- Produces: `PdnConsentGateMiddleware` class with `__init__(self, get_response)` and
  `__call__(self, request)`, matching the existing middleware protocol.

- [ ] **Step 1: Write the failing middleware tests**

```python
# eventproject/tests/test_pdn_consent_gate_middleware.py
from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from eventproject.models import Operator, PdnConsentDocument, PdnConsentSignature

PASSWORD = "StrongPass123!"


def _make_operator(username):
    user = User.objects.create_user(username=username, password=PASSWORD)
    return Operator.objects.create(user=user, patronymic="", phone_number="")


class PdnConsentGateMiddlewareTests(TestCase):
    def setUp(self):
        self.operator = _make_operator("op_gate")
        self.client.login(username="op_gate", password=PASSWORD)

    def test_redirects_html_request_when_no_active_document(self):
        # fail-open: no document created yet at all -> NOT gated
        resp = self.client.get("/application/")
        self.assertNotEqual(resp.status_code, 302)

    def test_redirects_html_request_when_unsigned(self):
        PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        resp = self.client.get("/application/", follow=False)
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.url, "/pdn_consent/")

    def test_api_request_returns_403_json_when_unsigned(self):
        PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        resp = self.client.get("/api/health/")
        # /api/health/ is exempt (matches _EXEMPT_PREFIXES) — use a real gated API path
        resp = self.client.get("/api/v1/events/")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "pdn_consent_required")

    def test_passes_when_operator_signed_active_version(self):
        doc = PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        PdnConsentSignature.objects.create(operator=self.operator, document_version=doc)
        resp = self.client.get("/application/")
        self.assertNotEqual(resp.status_code, 302)

    def test_gates_again_after_new_version_activated(self):
        doc1 = PdnConsentDocument.objects.create(
            text_ru="t1", text_kz="t1", text_en="t1", is_active=True
        )
        PdnConsentSignature.objects.create(operator=self.operator, document_version=doc1)
        PdnConsentDocument.objects.create(
            text_ru="t2", text_kz="t2", text_en="t2", is_active=True
        )
        resp = self.client.get("/application/", follow=False)
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.url, "/pdn_consent/")

    def test_does_not_gate_superuser(self):
        su = User.objects.create_superuser(username="su_gate", password=PASSWORD, email="")
        self.client.login(username="su_gate", password=PASSWORD)
        PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        resp = self.client.get("/avmac/")
        self.assertNotEqual(resp.status_code, 302)

    def test_exempt_paths_are_not_gated(self):
        PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        for path in ("/pdn_consent/", "/logout/"):
            resp = self.client.get(path, follow=False)
            self.assertNotEqual(resp.status_code, 302, msg=path)
```

Note: `/pdn_consent/` doesn't exist yet (Task 3) — this test file will only fully
pass once Task 3 lands the URL/view. For THIS task, run only the tests that don't
require `/pdn_consent/` to exist as a real endpoint (the `test_exempt_paths_are_not_gated`
case checking `/pdn_consent/` itself will 404 rather than redirect, which still
satisfies `assertNotEqual(resp.status_code, 302)` — so it's fine to run the full
file now).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_gate_middleware --settings=eventproject.settings_test -v 2`
Expected: FAIL — middleware doesn't exist / isn't wired in yet, so nothing redirects.

- [ ] **Step 3: Write the middleware**

```python
# eventproject/middleware/pdn_consent_gate.py
"""hd-7-3 — гейт обязательства о неразглашении ПДн.

Оператор (не суперпользователь), у которого нет подписи на текущую активную
версию `PdnConsentDocument`, перенаправляется на страницу подписания. Зеркалит
`force_password_change.py` — тот же протокол middleware, тот же стиль exempt-путей
(точное совпадение СЕГМЕНТА пути, не подстроки).

Fail-open: если активного документа нет вообще (админ ещё не создал ни одного),
гейт НЕ блокирует — иначе выкладка фичи блокирует всех операторов до того, как
кто-то зайдёт в admin и создаст первый документ.
"""

import logging

from django.http import JsonResponse
from django.shortcuts import redirect

from eventproject.models import PdnConsentDocument, PdnConsentSignature

logger = logging.getLogger("eventproject")

PDN_CONSENT_PATH = "/pdn_consent/"

_EXEMPT_SEGMENTS = {"pdn_consent", "change_password", "new_password", "logout"}
_EXEMPT_PREFIXES = ("/static", "/media", "/api/health")


class PdnConsentGateMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._should_gate(request):
            if request.path.startswith("/api/"):
                return JsonResponse(
                    {
                        "detail": "Требуется подписание обязательства о "
                        "неразглашении ПДн.",
                        "code": "pdn_consent_required",
                    },
                    status=403,
                )
            return redirect(PDN_CONSENT_PATH)
        return self.get_response(request)

    def _should_gate(self, request):
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated or user.is_superuser:
            return False

        path = request.path
        if path.startswith(_EXEMPT_PREFIXES):
            return False
        segments = {seg for seg in path.split("/") if seg}
        if segments & _EXEMPT_SEGMENTS:
            return False

        operator = getattr(user, "operator", None)
        if operator is None:
            return False

        active_doc = PdnConsentDocument.get_active()
        if active_doc is None:
            logger.warning(
                "pdn_consent_gate: no active PdnConsentDocument — failing open"
            )
            return False

        return not PdnConsentSignature.objects.filter(
            operator=operator, document_version=active_doc
        ).exists()
```

- [ ] **Step 4: Wire the middleware into settings**

In `eventproject/settings.py`, in the `MIDDLEWARE` list, add the new middleware
directly after `ForcePasswordChangeMiddleware`:

```python
    "eventproject.middleware.force_password_change.ForcePasswordChangeMiddleware",
    "eventproject.middleware.pdn_consent_gate.PdnConsentGateMiddleware",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_gate_middleware --settings=eventproject.settings_test -v 2`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test`
Expected: PASS, no new failures. (Watch specifically for any existing test that logs
in as an operator and then hits a non-exempt path without expecting a redirect — if
one exists and starts failing, it needs `PdnConsentDocument` left absent in its
`setUp`, which the fail-open behavior already guarantees, so this should be a
non-issue; investigate and log any surprise in `docs/OUTPUT/overnight-2026-08-21.md`
rather than silently patching unrelated tests.)

- [ ] **Step 7: Commit**

```bash
git add eventproject/middleware/pdn_consent_gate.py eventproject/settings.py eventproject/tests/test_pdn_consent_gate_middleware.py
git commit -m "feat(hd-7-3): PdnConsentGateMiddleware (mirrors ForcePasswordChangeMiddleware)"
```

---

### Task 3: Sign view (RU/KZ/EN) + templates + audit registry

This task is intentionally one unit: the audit coverage meta-test
(`test_audit_action_coverage.py::test_every_registry_action_has_explicit_checklist_test`)
requires exact set-equality between `SIGNIFICANT_ACTIONS` and `ACTION_COVERAGE`, and
this codebase's established convention (see `user.login`, `attendee.delete` in that
file) is to cover every live route of a multi-route action individually. Landing RU
only would leave the meta-test's per-route expectation unmet until KZ/EN exist, so
all three ship together.

**Files:**
- Create: `eventproject/views/pdn_consent.py` (shared logic + RU entry point)
- Modify: `kz_event/views.py` (thin wrapper calling the shared view with `lang="kz"`)
- Modify: `en_event/views.py` (thin wrapper calling the shared view with `lang="en"`)
- Create: `templates/pdn_consent.html`, `templates/kz/pdn_consent.html`, `templates/en/pdn_consent.html`
- Modify: `eventproject/urls.py` (add `/pdn_consent/`, `/kz/pdn_consent/`, `/en/pdn_consent/`)
- Modify: `eventproject/audit.py` (add `"pdn_consent.sign"` to `SIGNIFICANT_ACTIONS["edit"]`)
- Modify: `eventproject/tests/test_audit_action_coverage.py` (add `PdnConsentAuditTests` + `ACTION_COVERAGE` entry)
- Test: `eventproject/tests/test_pdn_consent_view.py`

**Interfaces:**
- Consumes: `PdnConsentDocument.get_active()`, `PdnConsentSignature` (Task 1);
  `eventproject.views.views._safe_next_url` (existing, reused as-is); `eventproject.audit.audit_log`.
- Produces: `eventproject.views.pdn_consent.pdn_consent_view(request, lang="ru")` — the
  shared GET/POST handler. `kz_event.views.pdn_consent(request)` and
  `en_event.views.pdn_consent(request)` — thin wrappers.

- [ ] **Step 1: Write the failing view tests**

```python
# eventproject/tests/test_pdn_consent_view.py
from django.contrib.auth.models import User
from django.test import TestCase

from eventproject.audit import audit_log  # noqa: F401 (imported for readability of intent)
from eventproject.models import Operator, PdnConsentDocument, PdnConsentSignature

PASSWORD = "StrongPass123!"


def _make_operator(username):
    user = User.objects.create_user(username=username, password=PASSWORD)
    return Operator.objects.create(user=user, patronymic="", phone_number="")


class PdnConsentViewTests(TestCase):
    def setUp(self):
        self.operator = _make_operator("op_view")
        self.doc = PdnConsentDocument.objects.create(
            text_ru="Текст RU", text_kz="Текст KZ", text_en="Text EN", is_active=True
        )
        self.client.login(username="op_view", password=PASSWORD)

    def test_get_renders_active_document_text(self):
        resp = self.client.get("/pdn_consent/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Текст RU")

    def test_wrong_password_does_not_sign(self):
        resp = self.client.post(
            "/pdn_consent/", {"agree": "on", "password": "wrong"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            PdnConsentSignature.objects.filter(
                operator=self.operator, document_version=self.doc
            ).exists()
        )

    def test_unchecked_box_does_not_sign(self):
        resp = self.client.post("/pdn_consent/", {"password": PASSWORD})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            PdnConsentSignature.objects.filter(
                operator=self.operator, document_version=self.doc
            ).exists()
        )

    def test_correct_password_and_checkbox_signs_and_redirects(self):
        resp = self.client.post(
            "/pdn_consent/", {"agree": "on", "password": PASSWORD}, follow=False
        )
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(
            PdnConsentSignature.objects.filter(
                operator=self.operator, document_version=self.doc
            ).exists()
        )

    def test_double_submit_does_not_error(self):
        # get_or_create dedup — second identical submit is a no-op, not a 500.
        for _ in range(2):
            resp = self.client.post(
                "/pdn_consent/", {"agree": "on", "password": PASSWORD}, follow=False
            )
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(
            PdnConsentSignature.objects.filter(
                operator=self.operator, document_version=self.doc
            ).count(),
            1,
        )

    def test_kz_route_renders_kz_text(self):
        resp = self.client.get("/kz/pdn_consent/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Текст KZ")

    def test_en_route_renders_en_text(self):
        resp = self.client.get("/en/pdn_consent/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Text EN")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_view --settings=eventproject.settings_test -v 2`
Expected: FAIL — `/pdn_consent/` doesn't resolve (404s), no view module yet.

- [ ] **Step 3: Use ui-ux-pro-max to design the sign page**

Before writing the template, invoke the `ui-ux-pro-max` skill for the `/pdn_consent/`
page layout and copy (checkbox label, password field, submit button, error states),
working within the existing `gov_base.html` visual language (see
`templates/change_password.html` for the component classes already in use:
`form-control__input`, `form-input-text__input`, `button--color-blue`, etc.). Do not
invent a new visual system — the skill should guide copy/UX/accessibility choices
within the existing constraints, not a redesign.

- [ ] **Step 4: Write the shared view**

```python
# eventproject/views/pdn_consent.py
"""hd-7-3 — страница подписания обязательства о неразглашении ПДн.

Общая логика для всех трёх языковых маршрутов (RU/KZ/EN) — в отличие от
устоявшегося в проекте паттерна полного дублирования (см. kz_event/views.py,
en_event/views.py), здесь один источник правды для проверки пароля, создания
подписи и аудита: это новая security-критичная логика, где дублирование в 3
копии увеличивает риск рассинхрона (например, кто-то поправит RU-ветку и забудет
KZ/EN). RU/KZ/EN различаются только текстом документа и шаблоном.
"""

import logging

from django.contrib.auth import authenticate
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import render

from eventproject.audit import audit_log
from eventproject.models import PdnConsentDocument, PdnConsentSignature
from eventproject.view_helpers import require_operator
from eventproject.views.views import _safe_next_url

logger = logging.getLogger("eventproject")

_TEMPLATES = {
    "ru": "pdn_consent.html",
    "kz": "kz/pdn_consent.html",
    "en": "en/pdn_consent.html",
}
_ERROR_MESSAGES = {
    "ru": "Отметьте согласие и введите правильный пароль.",
    "kz": "Келісіміңізді белгілеп, дұрыс құпиясөзді енгізіңіз.",
    "en": "Check the agreement box and enter the correct password.",
}
_DEFAULT_REDIRECT = {"ru": "/application/", "kz": "/kz/application/", "en": "/en/application/"}


def pdn_consent_view(request, lang="ru"):
    template = _TEMPLATES[lang]
    active_doc = PdnConsentDocument.get_active()
    text = getattr(active_doc, f"text_{lang}", "") if active_doc else ""

    if request.method == "POST":
        agree = request.POST.get("agree") == "on"
        password = request.POST.get("password", "")
        user = request.user
        authed = agree and authenticate(
            request, username=user.username, password=password
        )
        if authed is not None and active_doc is not None:
            operator = require_operator(user)
            ip = request.META.get("REMOTE_ADDR", "")
            with transaction.atomic():
                _, created = PdnConsentSignature.objects.get_or_create(
                    operator=operator,
                    document_version=active_doc,
                    defaults={
                        "ip": ip,
                        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:512],
                    },
                )
                if created:
                    try:
                        audit_log(
                            user=user,
                            action="pdn_consent.sign",
                            obj_type="PdnConsentDocument",
                            obj_id=active_doc.pk,
                            ip=ip,
                        )
                    except Exception:
                        logger.exception(
                            "failed to record pdn_consent.sign audit for user=%s",
                            user.id,
                        )
            next_url = _safe_next_url(request)
            return HttpResponseRedirect(next_url or _DEFAULT_REDIRECT[lang])
        return render(
            request,
            template,
            {"text": text, "error_message": _ERROR_MESSAGES[lang]},
        )

    return render(request, template, {"text": text})
```

Check `eventproject/view_helpers.py` for `require_operator`'s exact signature before
using it (`grep -n "def require_operator" eventproject/view_helpers.py`) — it's
already imported the same way in `kz_event/views.py`, so the call shape should match.

- [ ] **Step 5: Add thin RU-facing entry point**

At the bottom of `eventproject/views/pdn_consent.py`, add:

```python
def pdn_consent(request):
    return pdn_consent_view(request, lang="ru")
```

- [ ] **Step 6: Add KZ and EN thin wrappers**

In `kz_event/views.py`, add (near the other view functions, after imports):

```python
from eventproject.views.pdn_consent import pdn_consent_view


def pdn_consent(request):
    return pdn_consent_view(request, lang="kz")
```

In `en_event/views.py`, add the equivalent:

```python
from eventproject.views.pdn_consent import pdn_consent_view


def pdn_consent(request):
    return pdn_consent_view(request, lang="en")
```

- [ ] **Step 7: Write the three templates**

`templates/pdn_consent.html`:

```html
{% extends 'gov_base.html' %}
{% load static %}
{% block body_block %}
<div class="container flex-column flex-sm-row align-items-sm-center ministry-header-top">
    <div class="row justify-content-between align-items-center">
        <div class="col-lg-12">
            <br>
            <h2>Обязательство о неразглашении персональных данных</h2>
            <hr>
        </div>
    </div>
    <div class="row justify-content-md-center">
        <div class="col-lg-8">
            <div class="form-control__input form-control__input--visible-first form-input-text col-md-12 mb-3">
                {{ text|linebreaks }}
            </div>
        </div>
        <div class="col-lg-4">
            <form class="form-control row flex-column flex-wrap" method="post" action="/pdn_consent/">
                {% csrf_token %}
                <div class="form-control__input form-control__input--visible-first form-input-text col-md-12 mb-2">
                    <label for="title" class="color_red">{{ error_message }}</label>
                </div>
                <div class="form-control__input form-control__input--visible-first form-input-text col-md-12 mb-2">
                    <label>
                        <input type="checkbox" name="agree" /> Ознакомлен(а) и согласен(на)
                    </label>
                </div>
                <div class="form-control__input form-control__input--visible-first form-input-text col-md-12 mb-2">
                    <label for="password">Подтвердите паролем</label>
                    <div class="d-flex pos_relative">
                        <input type="password" class="form-input-text__input typography__variant-body color_white__bg form-input-text__input--outlined" name="password" autocomplete="off" />
                    </div>
                </div>
                <div class="my-3 col-md-12">
                    <button class="button button--transition button--color-blue mr-3 col-md-12 ripple" type="submit">Подписать</button>
                </div>
            </form>
        </div>
    </div>
</div>
{% endblock %}
```

`templates/kz/pdn_consent.html` and `templates/en/pdn_consent.html`: same structure,
translated labels (Қазақша / English) — use the `ui-ux-pro-max`-reviewed copy from
Step 3 for the exact wording; keep the same class names and form field names
(`agree`, `password`) so the shared view works unchanged.

- [ ] **Step 8: Wire the URLs**

In `eventproject/urls.py`, add the import and three paths (near the
`change_password` entries):

```python
from eventproject.views.pdn_consent import pdn_consent
```

```python
    path("pdn_consent/", pdn_consent, name="pdn_consent"),
    path("kz/pdn_consent/", kviews.pdn_consent, name="kz_pdn_consent"),
    path("en/pdn_consent/", eviews.pdn_consent, name="en_pdn_consent"),
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_view --settings=eventproject.settings_test -v 2`
Expected: PASS (7 tests). Also re-run Task 2's middleware tests — they depend on
`/pdn_consent/` existing for the exempt-path check:

Run: `.venv/bin/python manage.py test eventproject.tests.test_pdn_consent_gate_middleware --settings=eventproject.settings_test -v 2`
Expected: PASS (7 tests, all now fully exercised).

- [ ] **Step 10: Register the audit action and its coverage test**

In `eventproject/audit.py`, in `SIGNIFICANT_ACTIONS`, change:

```python
    "edit": ["attendee.update", "attendee.iin_discarded", "user.change_password"],
```

to:

```python
    "edit": [
        "attendee.update", "attendee.iin_discarded", "user.change_password",
        "pdn_consent.sign",
    ],
```

In `eventproject/tests/test_audit_action_coverage.py`, add to `ACTION_COVERAGE`
(anywhere in the dict — alongside `"user.change_password"` reads naturally):

```python
    "pdn_consent.sign": [
        "PdnConsentAuditTests.test_ru_sign_emits_pdn_consent_sign",
        "PdnConsentAuditTests.test_kz_sign_emits_pdn_consent_sign",
        "PdnConsentAuditTests.test_en_sign_emits_pdn_consent_sign",
    ],
```

Add the imports this test class needs at the top of the file:

```python
from eventproject.models import Operator, PdnConsentDocument
```

Add the test class (anywhere after `ChangePasswordAuditTests`, matching that class's
style):

```python
class PdnConsentAuditTests(AuditChecklistMixin, TestCase):
    """hd-7-3: подписание NDA аудируется на всех трёх языковых маршрутах."""

    PASSWORD = "StrongPass123!"

    def setUp(self):
        user = User.objects.create_user(username="op_audit", password=self.PASSWORD)
        self.operator = Operator.objects.create(
            user=user, patronymic="", phone_number=""
        )
        PdnConsentDocument.objects.create(
            text_ru="t", text_kz="t", text_en="t", is_active=True
        )
        self.client.login(username="op_audit", password=self.PASSWORD)

    def _assert_sign_audited(self, url):
        with self.assertLogs("eventproject", level="INFO") as cm:
            resp = self.client.post(url, {"agree": "on", "password": self.PASSWORD})
        self.assertEqual(resp.status_code, 302)
        self.assertIn("pdn_consent.sign", self._actions_of(cm))

    def test_ru_sign_emits_pdn_consent_sign(self):
        self._assert_sign_audited("/pdn_consent/")

    def test_kz_sign_emits_pdn_consent_sign(self):
        self._assert_sign_audited("/kz/pdn_consent/")

    def test_en_sign_emits_pdn_consent_sign(self):
        self._assert_sign_audited("/en/pdn_consent/")
```

Note: each of these three tests uses a fresh `self.client` (Django's `TestCase`
gives each test method its own client/DB transaction), so signing via `/pdn_consent/`
in the RU test doesn't leave the operator already-signed for the KZ test — each
posts against the one active document independently and each should get its own
`PdnConsentSignature` row (same operator, same document — wait: `unique_together`
would reject the 2nd and 3rd sign attempts for the SAME operator+document pair
across test methods only if they shared a DB, which `TestCase` prevents via
per-test transaction rollback — safe).

- [ ] **Step 11: Run the audit coverage meta-test**

Run: `.venv/bin/python manage.py test eventproject.tests.test_audit_action_coverage --settings=eventproject.settings_test -v 2`
Expected: PASS — `test_every_registry_action_has_explicit_checklist_test` and
`test_registry_has_exactly_expected_categories` both pass (the categories set is
unchanged — `pdn_consent.sign` went into the existing `"edit"` bucket, not a new one).

- [ ] **Step 12: Run the full suite**

Run: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test`
Expected: PASS, 0 new failures vs. the Task 2 baseline.

- [ ] **Step 13: Commit**

```bash
git add eventproject/views/pdn_consent.py kz_event/views.py en_event/views.py \
  templates/pdn_consent.html templates/kz/pdn_consent.html templates/en/pdn_consent.html \
  eventproject/urls.py eventproject/audit.py eventproject/tests/test_audit_action_coverage.py \
  eventproject/tests/test_pdn_consent_view.py
git commit -m "feat(hd-7-3): PDN consent sign page (RU/KZ/EN) + audit registry"
```

---

### Task 4: Update the design doc and roadmap status

**Files:**
- Modify: `_bmad-output/implementation-artifacts/sprint-status.yaml` (mark
  `hd-7-3-pdn-consent-record` as done with a short note)
- Modify: `docs/OUTPUT/overnight-2026-08-21.md` and `docs/LOG.md` (final status for item 1)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update sprint-status.yaml**

Find the line `hd-7-3-pdn-consent-record: backlog` and change it to:

```yaml
  hd-7-3-pdn-consent-record: done  # 2026-08-21 автономная ночная сессия: PdnConsentDocument/PdnConsentSignature + PdnConsentGateMiddleware (после ForcePasswordChangeMiddleware) + sign-страница RU/KZ/EN (упрощённая e-подпись: чекбокс+пароль, не PKI/ЭЦП) + audit pdn_consent.sign. Открытые вопросы для Erda: юридическая достаточность упрощённой подписи vs формулировка "ЭЦП" в докладной; немедленный гейт для существующих операторов без льготного периода. См. docs/superpowers/specs/2026-08-21-pdn-consent-gate-design.md §7.
```

- [ ] **Step 2: Update the overnight log**

Append to `docs/OUTPUT/overnight-2026-08-21.md`, updating the status table's item 1
line to "done", and add a short summary paragraph: what was built, the two open
questions from spec §7, and the full list of new files.

Append one line to `docs/LOG.md`:
`- [2026-08-21 HH:MM] hd-7-3 PDN consent gate реализован (модели, middleware, sign-страница RU/KZ/EN, audit); см. docs/OUTPUT/overnight-2026-08-21.md`

- [ ] **Step 3: Commit**

```bash
git add _bmad-output/implementation-artifacts/sprint-status.yaml docs/OUTPUT/overnight-2026-08-21.md docs/LOG.md
git commit -m "docs(hd-7-3): mark done in sprint-status, log overnight summary"
```

---

## After this plan

Item 1 of the memo (`hd-7-3`) is complete. Next: brainstorm → spec → plan → implement
item 2 (dashboard statistics) as its own independent cycle, per the same process —
new plan file, not an extension of this one.
