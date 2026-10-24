# Face ID CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing delta-export (`views/export.py::export_delta`) also produce a
directly-loadable CSV file for Face ID terminals via `?format=csv`, reusing the exact
same delta-selection/atomic-transition/audit mechanics as the existing JSON+ZIP path —
only the output serialization differs.

**Architecture:** One new pure function `build_export_csv_rows` in
`eventproject/services/export.py` (reuses the same field values as
`build_export_object`, flattened for CSV, no photo/doc filenames). `export_delta`
branches near the end on `request.GET.get("format")`: `csv` skips the ZIP-tempfile
path entirely, builds the CSV in memory, and returns `text/csv; charset=utf-8-sig`;
default (no param, or `format=json`) is byte-for-byte the existing ZIP behavior. The
shared atomic block (delta selection, `ExportLog`, status transition) runs exactly
once regardless of format; only the `audit_log` action string and the final response
differ.

**Tech Stack:** Django, Python's stdlib `csv` module, existing test conventions in
`eventproject/tests/test_export_delta.py`.

**Spec:** `docs/superpowers/specs/2026-08-21-face-id-csv-export-design.md`

## Global Constraints

- Test command: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test` (SQLite; do NOT use `.venv_new`).
- New audit action `export.delta_csv` goes into the EXISTING `SIGNIFICANT_ACTIONS["export"]` category, not a new one — `test_audit_action_coverage.py`'s `test_registry_has_exactly_expected_categories` asserts the exact category set.
- CSV: `csv.writer` with `quoting=csv.QUOTE_ALL`, `\r\n` line terminator (RFC 4181), `utf-8-sig` encoding (BOM) for Cyrillic + Windows-oriented terminal software.
- The delta-selection/atomic-transaction/ExportLog/status-transition logic must run EXACTLY ONCE per request regardless of format — no duplicated business logic between the CSV and ZIP paths.
- Local commits only, on branch `security-hardening`. No push, no merge.
- Column schema is the existing Integration Spec v1.1 field set (from `build_export_object`) — NOT vendor-confirmed for the specific Face ID terminal software; flag this in the commit/log, don't present it as verified against the real terminal.

---

### Task 1: `build_export_csv_rows` + tests

**Files:**
- Modify: `eventproject/services/export.py` (add new function, near `build_export_object`)
- Test: `eventproject/tests/test_export_delta.py` (new test class)

**Interfaces:**
- Produces: `build_export_csv_rows(attendees, dir_names=None) -> tuple[list[str], list[list[str]]]` — `(header, rows)`. `header` is a fixed list of column names; each row is a list of string values in the same order, one per attendee, in the same iteration order as the input list.

- [ ] **Step 1: Write the failing tests**

```python
# append to eventproject/tests/test_export_delta.py

class BuildExportCsvRowsTests(ExportDeltaBase):
    def test_header_matches_expected_columns(self):
        header, _ = export_service.build_export_csv_rows([], {})
        self.assertEqual(
            header,
            [
                "attendee_id", "schema_version", "event_id", "event_code",
                "category", "status", "surname", "firstname", "patronymic",
                "transcription", "birth_date", "iin", "is_resident",
                "sex_id", "sex_name", "country_id", "country_name", "post",
                "doc_type_id", "doc_type_name", "doc_series", "doc_number",
                "doc_begin", "doc_end", "doc_issue", "visit_objects", "date_add",
            ],
        )

    def test_row_values_match_build_export_object(self):
        attendee = self._make_ready_attendee(surname="Иванов")
        dir_names = export_service.load_directory_names()
        header, rows = export_service.build_export_csv_rows([attendee], dir_names)
        obj = export_service.build_export_object(attendee, dir_names)
        row = dict(zip(header, rows[0]))
        self.assertEqual(row["surname"], "Иванов")
        self.assertEqual(row["attendee_id"], str(obj["attendee_id"]))
        self.assertEqual(row["event_code"], obj["event_code"])

    def test_non_resident_has_empty_iin_field(self):
        attendee = self._make_ready_attendee(is_resident=False, iin=None)
        header, rows = export_service.build_export_csv_rows(
            [attendee], export_service.load_directory_names()
        )
        row = dict(zip(header, rows[0]))
        self.assertEqual(row["iin"], "")

    def test_special_characters_survive_csv_round_trip(self):
        # Докладная п.4: "запятые и двоеточия" не должны ломать структуру строки.
        attendee = self._make_ready_attendee(
            surname='Ива"нов, Тест: спец', post="A, B: C"
        )
        header, rows = export_service.build_export_csv_rows(
            [attendee], export_service.load_directory_names()
        )
        buf = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        writer.writerow(header)
        writer.writerows(rows)
        buf.seek(0)
        parsed = list(csv.reader(buf))
        self.assertEqual(len(parsed), 2)  # header + 1 row
        parsed_row = dict(zip(parsed[0], parsed[1]))
        self.assertEqual(parsed_row["surname"], 'Ива"нов, Тест: спец')
        self.assertEqual(parsed_row["post"], "A, B: C")
```

Add `import csv` and `import io` to the top of `test_export_delta.py` if not already
present (check first — `io` is likely already imported for the ZIP tests).

`ExportDeltaBase` already has exactly the helper you need — DO NOT add a new one:
`self._mk(status, *, is_resident=True, iin="900101300007", photo="img.jpg", doc="img.jpg", request=None, dateAdd=None, **over)`
creates an `Attendee` against `self.category` (the test `Request` instance) by
default. Use `self._mk("ready", surname="Иванов")` etc. in your new tests — replace
every `self._make_ready_attendee(...)` in the test snippets below with
`self._mk("ready", ...)` (same kwargs, just the existing helper's name and its
`status` positional-first signature). `self._url()` already returns
`f"/export_delta/{self.event.id}/{self.category.id}/"` — reuse it instead of
hardcoding the path in Task 2's tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.tests.test_export_delta.BuildExportCsvRowsTests --settings=eventproject.settings_test -v 2`
Expected: FAIL/ERROR — `build_export_csv_rows` doesn't exist yet.

- [ ] **Step 3: Implement `build_export_csv_rows`**

Add to `eventproject/services/export.py`, near `build_export_object`:

```python
import csv
import io

_CSV_COLUMNS = [
    "attendee_id", "schema_version", "event_id", "event_code",
    "category", "status", "surname", "firstname", "patronymic",
    "transcription", "birth_date", "iin", "is_resident",
    "sex_id", "sex_name", "country_id", "country_name", "post",
    "doc_type_id", "doc_type_name", "doc_series", "doc_number",
    "doc_begin", "doc_end", "doc_issue", "visit_objects", "date_add",
]


def build_export_csv_rows(attendees, dir_names=None):
    """Плоские CSV-строки для терминалов Face ID (докладная п.4).

    Переиспользует ТЕ ЖЕ значения полей, что `build_export_object` (Integration
    Spec v1.1) — единственный согласованный набор данных участника, — но БЕЗ
    photo_file/doc_scan_file (фото передаются отдельно через ?format=json/ZIP;
    CSV — только данные участника, готовые к прямой загрузке в стойку).

    Схема колонок НЕ подтверждена вендором конкретного терминального ПО —
    отправная точка: существующий согласованный формат. Локализовано здесь,
    в одной функции — смена маппинга колонок не требует трогать view/бизнес-логику.
    """
    if dir_names is None:
        dir_names = load_directory_names()
    rows = []
    for attendee in attendees:
        obj = build_export_object(attendee, dir_names)
        rows.append([
            "" if obj.get(col) is None else str(obj[col])
            for col in _CSV_COLUMNS
        ])
    return list(_CSV_COLUMNS), rows


def write_csv_bytes(header, rows):
    """Сериализует (header, rows) в bytes — QUOTE_ALL, \\r\\n, utf-8-sig (BOM)."""
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8-sig")
```

Place the `import csv` / `import io` lines with the other stdlib imports at the top
of the file (check current import block — `io` may already be imported elsewhere in
the codebase's export modules, but check THIS file specifically).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_export_delta.BuildExportCsvRowsTests --settings=eventproject.settings_test -v 2`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full export test module to check for regressions**

Run: `.venv/bin/python manage.py test eventproject.tests.test_export_delta eventproject.tests.test_export_contract --settings=eventproject.settings_test -v 2`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add eventproject/services/export.py eventproject/tests/test_export_delta.py
git commit -m "feat(export): hd-2-6 build_export_csv_rows — flat CSV rows for Face ID terminals"
```

---

### Task 2: Wire `?format=csv` into `export_delta` + audit registry

**Files:**
- Modify: `eventproject/views/export.py` (branch on `format` param)
- Modify: `eventproject/audit.py` (add `"export.delta_csv"` to `SIGNIFICANT_ACTIONS["export"]`)
- Modify: `eventproject/tests/test_audit_action_coverage.py` (add `ACTION_COVERAGE` entry + test class)
- Test: `eventproject/tests/test_export_delta.py` (new view-level test class)

**Interfaces:**
- Consumes: `export_service.build_export_csv_rows`, `export_service.write_csv_bytes` (Task 1).

- [ ] **Step 1: Write the failing view tests**

Add to `eventproject/tests/test_export_delta.py` (inspect `ExportViewTests` in this
same file first — reuse its setup pattern for logging in as `self.super_user` and
posting to the `export_delta` URL; match its exact URL-building helper if one
exists rather than hardcoding paths):

```python
class ExportDeltaCsvFormatTests(ExportDeltaBase):
    def test_csv_format_returns_text_csv_content_type(self):
        self._make_ready_attendee(surname="Тест")
        self.client.force_login(self.super_user)
        resp = self.client.post(
            f"/export_delta/{self.event.id}/{self.request.id}/?format=csv"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "text/csv; charset=utf-8-sig")

    def test_csv_format_contains_the_same_attendee_as_json_format_would(self):
        attendee = self._make_ready_attendee(surname="УникальнаяФамилия")
        self.client.force_login(self.super_user)
        resp = self.client.post(
            f"/export_delta/{self.event.id}/{self.request.id}/?format=csv"
        )
        self.assertIn(b"\xd0\xa3\xd0\xbd\xd0\xb8\xd0\xba\xd0\xb0\xd0\xbb\xd1\x8c\xd0\xbd\xd0\xb0\xd1\x8f\xd0\xa4\xd0\xb0\xd0\xbc\xd0\xb8\xd0\xbb\xd0\xb8\xd1\x8f".decode("utf-8").encode("utf-8-sig")[3:], resp.content)
        attendee.refresh_from_db()
        from eventproject.state_machine import AttendeeStatus
        self.assertEqual(attendee.status, AttendeeStatus.EXPORTED)

    def test_csv_export_does_not_duplicate_audit_or_status_transition(self):
        # Тот же участник не должен выгрузиться дважды между json/csv вызовами —
        # это гарантируется delta-выборкой (ready→exported после первого раза),
        # но явно проверяем, что csv-путь идёт через ТУ ЖЕ атомарную транзакцию.
        self._make_ready_attendee(surname="Раз")
        self.client.force_login(self.super_user)
        from eventproject.models import ExportLog
        resp1 = self.client.post(
            f"/export_delta/{self.event.id}/{self.request.id}/?format=csv"
        )
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(ExportLog.objects.count(), 1)
        resp2 = self.client.post(
            f"/export_delta/{self.event.id}/{self.request.id}/?format=csv"
        )
        # Нет новых ready-участников → AC-5 "нет новых записей", не пустой CSV.
        self.assertIn("Нет новых записей", resp2.content.decode("utf-8"))
        self.assertEqual(ExportLog.objects.count(), 1)

    def test_csv_export_emits_export_delta_csv_audit_action(self):
        self._make_ready_attendee(surname="Аудит")
        self.client.force_login(self.super_user)
        with self.assertLogs("eventproject", level="INFO") as cm:
            resp = self.client.post(
                f"/export_delta/{self.event.id}/{self.request.id}/?format=csv"
            )
        self.assertEqual(resp.status_code, 200)
        actions = [getattr(r, "action", None) for r in cm.records]
        self.assertIn("export.delta_csv", actions)

    def test_json_format_unchanged_when_no_format_param(self):
        self._make_ready_attendee(surname="ДефолтJSON")
        self.client.force_login(self.super_user)
        resp = self.client.post(f"/export_delta/{self.event.id}/{self.request.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/zip")
```

Before writing these, check `ExportDeltaBase.setUp` for the ACTUAL attribute names
(`self.request` may not exist — inspect and adjust the URL-building and attendee
helper accordingly; this brief uses placeholder names, match the real ones).

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.tests.test_export_delta.ExportDeltaCsvFormatTests --settings=eventproject.settings_test -v 2`
Expected: FAIL — `?format=csv` currently has no effect, still returns a ZIP.

- [ ] **Step 3: Branch `export_delta` on `format`**

In `eventproject/views/export.py`, modify `export_delta`. The current structure
(after `attendees`/`dir_names`/`objects` are computed) is:

```python
    # Временный файл — на хосте (/tmp), не внутри контейнера (как file_download.py).
    with tempfile.NamedTemporaryFile(dir="/tmp", suffix=".zip", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        # Архив пишем ВНЕ транзакции — без долгих блокировок строк во время файлового I/O.
        export_service.write_export_archive(tmp_path, attendees, objects)
```

Change it to only build the ZIP tempfile when NOT csv format, and compute csv_bytes
otherwise:

```python
    is_csv = request.GET.get("format") == "csv"
    tmp_path = None
    csv_bytes = None

    if is_csv:
        header, rows = export_service.build_export_csv_rows(attendees, dir_names)
        csv_bytes = export_service.write_csv_bytes(header, rows)
    else:
        # Временный файл — на хосте (/tmp), не внутри контейнера (как file_download.py).
        with tempfile.NamedTemporaryFile(dir="/tmp", suffix=".zip", delete=False) as tmp:
            tmp_path = tmp.name
        # Архив пишем ВНЕ транзакции — без долгих блокировок строк во время файлового I/O.
        export_service.write_export_archive(tmp_path, attendees, objects)

    try:
```

Then inside the existing `with transaction.atomic():` block, change the
`audit_log(action="export.download", ...)` call to pick the action dynamically:

```python
                audit_log(
                    user=request.user,
                    action="export.delta_csv" if is_csv else "export.download",
                    obj_type="Event",
                    obj_id=event_id,
                    ip=request.META.get("REMOTE_ADDR"),
                    extra={
                        "category": category.name,
                        "count": len(committed_ids),
                        "export_log_id": export_log.id,
                    },
                )
```

After the `if not committed_ids:` early-return block (which currently does
`Path(tmp_path).unlink(missing_ok=True)` — guard that for the CSV case, where
`tmp_path` is `None`):

```python
        if not committed_ids:
            if tmp_path is not None:
                Path(tmp_path).unlink(missing_ok=True)
            return _no_new_response(last_export)
```

Then, where the response is currently built (`FileResponse(...)`), branch:

```python
        cache.delete(f"dashboard:event:{event_id}")

        ts = now.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")

        if is_csv:
            filename = f"attendees_{event_id}_{_safe_category(category.name)}_{ts}.csv"
            return HttpResponse(
                csv_bytes,
                content_type="text/csv; charset=utf-8-sig",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        filename = f"export_{event_id}_{_safe_category(category.name)}_{ts}.zip"
        response = FileResponse(
            _open_and_unlink(tmp_path),
            as_attachment=True,
            filename=filename,
            content_type="application/zip",
        )
        original_close = response.close

        def _close(*args, **kwargs):
            original_close()
            Path(tmp_path).unlink(missing_ok=True)

        response.close = _close
        return response
    except Exception:
        if tmp_path is not None:
            Path(tmp_path).unlink(missing_ok=True)
        raise
```

Read the full current function body first (`eventproject/views/export.py`) before
editing — this brief shows the shape of the change, match it precisely against the
real current line numbers and surrounding code rather than pattern-matching blindly.

- [ ] **Step 4: Register the audit action and its coverage test**

In `eventproject/audit.py`, change:

```python
    "export": [
        "export.download", "export.event_sent", "export.guests_sent",
        "export.guests_all", "export.request",
    ],
```

to:

```python
    "export": [
        "export.download", "export.event_sent", "export.guests_sent",
        "export.guests_all", "export.request", "export.delta_csv",
    ],
```

In `eventproject/tests/test_audit_action_coverage.py`, add to `ACTION_COVERAGE`:

```python
    "export.delta_csv": [
        "ExportDeltaCsvAuditTests.test_csv_export_emits_export_delta_csv",
    ],
```

Add the test class (this can be the SAME test as
`test_csv_export_emits_export_delta_csv_audit_action` from Task 2 Step 1 — if you
already wrote it there in `test_export_delta.py`, either move it here or duplicate
a minimal version; the coverage meta-test just needs to find a real, passing test
method under this exact class/method name in `test_audit_action_coverage.py`'s own
module namespace, so it must live in THIS file, not just `test_export_delta.py`):

```python
class ExportDeltaCsvAuditTests(AuditChecklistMixin, TestCase):
    def setUp(self):
        Country.objects.create(
            country_code=KZ, name_rus="Казахстан", name_kaz="", name_eng="",
            country_iso="KZ",
        )
        Sex.objects.create(sex_code="M", name_rus="Мужской", name_kaz="", name_eng="")
        DocumentType.objects.create(
            doc_code="passport", name_rus="Паспорт", name_kaz="", name_eng=""
        )
        self.superuser = User.objects.create_superuser(
            username="su_csv", password=PASSWORD, email=""
        )
        _, operator = _make_operator("oper_csv", "operator")
        self.event = Event.objects.create(
            name_rus="Событие", event_code="CSV01", city_code="ALA"
        )
        self.category = Request.objects.create(
            name="Охрана", event=self.event, status="Active",
            created_by=operator, registration_time=timezone.now(),
        )

    def test_csv_export_emits_export_delta_csv(self):
        _make_attendee(
            self.category, status="ready", docTypeId="passport",
            photo="img.jpg", docScan="img.jpg",
        )
        self.client.force_login(self.superuser)
        with self.assertLogs("eventproject", level="INFO") as cm:
            resp = self.client.post(
                f"/export_delta/{self.event.id}/{self.category.id}/?format=csv"
            )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("export.delta_csv", self._actions_of(cm))
```

This mirrors `ExportDeltaAuditTests` already in this file (check it for the exact
`_make_attendee`/`_make_operator` import paths already used at the top of
`test_audit_action_coverage.py` — reuse them, don't re-import differently).

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_export_delta eventproject.tests.test_audit_action_coverage --settings=eventproject.settings_test -v 2`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test`
Expected: PASS, 0 new failures vs. baseline (617, per this session's last full run).

- [ ] **Step 7: Commit**

```bash
git add eventproject/views/export.py eventproject/audit.py eventproject/tests/test_audit_action_coverage.py eventproject/tests/test_export_delta.py
git commit -m "feat(export): hd-2-6 wire ?format=csv into export_delta (Face ID terminals)"
```

---

## After this plan

Item 4 of the memo is functionally complete, with one explicit caveat carried into
the overnight log: the CSV column schema is the existing Integration Spec v1.1 field
set, not vendor-confirmed against the specific Face ID terminal software. Flag this
clearly — do not present it as verified.
