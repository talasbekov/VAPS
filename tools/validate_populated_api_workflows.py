#!/usr/bin/env python3
"""Exercise the isolated populated LAN API and preserve HTTP evidence.

Credentials, reports, and downloaded documents must live outside the repository.
The script only connects to the explicitly reserved loopback port 18345. Default
checks are read-only; --mutate runs the configured synthetic expense workflow.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
import hashlib
import io
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import zipfile


REPOSITORY = Path(__file__).resolve().parents[1]
STAFF = "/api/staff_unit/staff-units/directorate/"
STRENGTH = "/api/operations/strength-report/"
SUBMISSIONS = "/api/operations/daily-submissions/"
SERVICE = "/api/ops/service-combat-duty/"
COMBAT = "/api/ops/combat-duty-shifts/"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def outside_repository(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == REPOSITORY or REPOSITORY in resolved.parents:
        raise ValueError("Credentials and generated artifacts must be outside Git")
    return resolved


def records(payload: object) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("results", "staff_units", "employees", "data"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def document_text(blob: bytes, file_format: str) -> str:
    if file_format == "csv":
        return blob.decode("utf-8-sig")
    if file_format in ("xlsx", "docx"):
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            assert archive.testzip() is None, "Corrupt document archive"
            names = [name for name in archive.namelist() if (
                name.startswith("xl/worksheets/") or name == "xl/sharedStrings.xml"
                or name == "word/document.xml"
            )]
            return "\n".join(" ".join(ET.fromstring(archive.read(name)).itertext()) for name in names)
    assert blob.startswith(b"%PDF-"), "Invalid PDF signature"
    return ""


def frozen_personal_cells(blob: bytes) -> tuple:
    """Compare the personal copy while its documented current-version flag changes."""
    namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        cells = []
        for name in sorted(archive.namelist()):
            if not name.startswith("xl/worksheets/") or not name.endswith(".xml"):
                continue
            for cell in ET.fromstring(archive.read(name)).findall(".//x:c", namespace):
                if name == "xl/worksheets/sheet1.xml" and cell.get("r") == "B5":
                    continue  # The passport explicitly states whether the version is current today.
                value = "".join(cell.itertext())
                if cell.get("t") == "s":
                    value = shared[int(value)]
                cells.append((name, cell.get("r"), value))
        assert any(name == "xl/worksheets/sheet1.xml" and reference == "A5" and value == "Действующая"
                   for name, reference, value in cells), "Unexpected personal passport layout"
        return tuple(cells)


class Response:
    def __init__(self, status: int, headers: dict, blob: bytes):
        self.status, self.headers, self.blob = status, {key.lower(): value for key, value in headers.items()}, blob
        self.payload = None
        if "json" in self.headers.get("content-type", ""):
            self.payload = json.loads(blob.decode("utf-8"))


class Audit:
    def __init__(self, api_url: str, actors: dict, fixtures: dict, output: Path):
        parsed = urlparse(api_url)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost")
                or parsed.port != 18345 or parsed.path not in ("", "/")
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError("Only the isolated http://127.0.0.1:18345 stand is allowed")
        self.api_url, self.actors, self.fixtures = api_url.rstrip("/"), actors, fixtures
        self.output = output
        self.output.mkdir(parents=True, exist_ok=True)
        self.tokens, self.permissions = {}, {}
        self.requests, self.cases = [], []
        self.divisions = []

    def request(self, actor: str | None, method: str, path: str, *, query=None, data=None) -> Response:
        url = self.api_url + path
        if query:
            url += "?" + urlencode(query)
        headers = {"Accept": "application/json"}
        if actor:
            if actor not in self.tokens:
                self.login(actor)
            headers["Authorization"] = "Bearer " + self.tokens[actor]
        body = json.dumps(data).encode("utf-8") if data is not None else None
        if body is not None:
            headers["Content-Type"] = "application/json"
        started = time.perf_counter()
        request = Request(url, data=body, headers=headers, method=method)
        try:
            raw = urlopen(request, timeout=90)
        except HTTPError as error:
            raw = error
        with raw:
            response = Response(raw.status, dict(raw.headers.items()), raw.read())
        evidence = {"actor": actor or "anonymous", "method": method, "path": path,
                    "query": query or {}, "status": response.status,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                    "bytes": len(response.blob), "sha256": hashlib.sha256(response.blob).hexdigest()}
        if data is not None:
            evidence["request_data"] = data
        if response.status >= 400:
            # Never persist login payloads or JWTs; error evidence is bounded.
            evidence["error"] = response.payload or response.blob[:1600].decode("utf-8", errors="replace")
        self.requests.append(evidence)
        return response

    def login(self, actor: str) -> None:
        account = self.actors[actor]
        request = Request(self.api_url + "/api/token/", method="POST",
                          data=json.dumps({"username": account["username"], "password": account["password"]}).encode(),
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=30) as response:
                token = json.loads(response.read())
        except HTTPError as error:
            raise AssertionError(f"Login failed for actor alias {actor}: HTTP {error.code}") from None
        self.tokens[actor] = token["access"]

    def case(self, name: str, operation) -> None:
        started = time.perf_counter()
        begin = len(self.requests)
        try:
            details = operation()
            if details is not None and len(json.dumps(details, ensure_ascii=False, default=str)) > 4000:
                details = {"response_keys": sorted(details) if isinstance(details, dict) else [],
                           "record_count": len(records(details))}
            result = {"name": name, "passed": True, "details": details}
        except Exception as error:
            result = {"name": name, "passed": False, "error": f"{type(error).__name__}: {error}"}
        result.update(elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                      request_indices=list(range(begin, len(self.requests))))
        self.cases.append(result)
        print(f"{'PASS' if result['passed'] else 'FAIL'} {name}", flush=True)
        self.save()

    def save(self) -> None:
        report = {"api_url": self.api_url, "cases": self.cases, "requests": self.requests,
                  "passed": sum(case["passed"] for case in self.cases),
                  "failed": sum(not case["passed"] for case in self.cases)}
        (self.output / "api-workflows.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, actor, path, query=None, expected=200):
        response = self.request(actor, "GET", path, query=query)
        assert response.status == expected, f"HTTP {response.status}, expected {expected}: {str(response.payload)[:1000]}"
        return response.payload

    def allowed(self, actor, code):
        return bool({"*", code} & self.permissions[actor])

    def alias(self, key, fallback=None):
        value = self.fixtures.get("actor_aliases", {}).get(key, key)
        return value if value in self.actors else fallback

    def descendants(self, root):
        found = {root}
        while True:
            newer = found | {row["id"] for row in self.divisions if row.get("parent") in found}
            if newer == found:
                return found
            found = newer

    def run_read_checks(self):
        protected = [STRENGTH, STAFF, SERVICE, COMBAT, "/api/core/employees/", "/api/operations/accounts/"]
        for path in protected:
            self.case("anonymous " + path, lambda p=path: self.get(None, p, expected=401))
        for actor in self.actors:
            def identity(a=actor):
                payload = self.get(a, "/api/operations/my-permissions/")
                self.permissions[a] = set(payload["permissions"])
                return {"permissions": sorted(self.permissions[a]), "roles": payload.get("roles", [])}
            self.case("identity " + actor, identity)
        admin = self.alias("admin")
        if not admin:
            admin = next((a for a, permissions in self.permissions.items() if "*" in permissions), None)
        if not admin:
            raise ValueError("An admin actor alias or wildcard actor is required")
        def hierarchy():
            self.divisions = records(self.get(admin, "/api/core/divisions/", {"limit": 1000}))
            return {"divisions": len(self.divisions)}
        self.case("global hierarchy reference", hierarchy)
        day = self.fixtures["business_date"]
        for actor in self.permissions:
            for path, code, query in ((SERVICE, "duty.view", {"business_date": day}),
                                      (COMBAT, "duty.view", None),
                                      (STRENGTH, "status.view", {"business_date": day}),
                                      ("/api/core/employees/", "personnel.view", {"limit": 1000}),
                                      ("/api/operations/accounts/", "admin.roles", None)):
                expected = 200 if self.allowed(actor, code) else 403
                self.case(f"permission {actor} {path}", lambda a=actor, p=path, q=query, e=expected: self.get(a, p, q, e))
        reader = self.alias("dept_reader", admin)
        own = self.fixtures.get("department_id")
        foreign = self.fixtures.get("foreign_division_id")
        if own and reader != admin:
            scope = self.descendants(own)
            if self.allowed(reader, "personnel.view"):
                def personnel_scope():
                    people = records(self.get(reader, "/api/core/employees/", {"limit": 1000}))
                    leaked = [person["id"] for person in people if person.get("division") not in scope]
                    assert not leaked, f"Foreign employee IDs: {leaked}"
                    return {"visible_people": len(people)}
                self.case("scoped employee list", personnel_scope)
            if self.allowed(reader, "duty.view"):
                def combat_scope(path):
                    payload = self.get(reader, path, {"business_date": day})
                    groups = payload.get("combat_groups", []) if path == SERVICE else records(payload)
                    leaked = []
                    for group in groups:
                        if path == COMBAT and group.get("submission") is None:
                            # A draft is a planning requirement; ownership is not
                            # established until a roster is submitted.
                            continue
                        frozen = group.get("division_id") if path == SERVICE else (group.get("submission") or {}).get("submittedByDivisionId")
                        if frozen not in scope:
                            leaked.append({"id": group.get("shift_id", group.get("id")), "division_id": frozen})
                    assert not leaked, f"Foreign or unidentified combat groups: {leaked}"
                    global_payload = self.get(admin, path, {"business_date": day})
                    global_groups = global_payload.get("combat_groups", []) if path == SERVICE else records(global_payload)
                    expected = {
                        str(group.get("shift_id", group.get("id"))) for group in global_groups
                        if (group.get("division_id") if path == SERVICE else
                            (group.get("submission") or {}).get("submittedByDivisionId")) in scope
                    }
                    actual = {str(group.get("shift_id", group.get("id"))) for group in groups}
                    assert expected and expected <= actual, f"Own combat groups missing: {sorted(expected - actual)}"
                    return {"visible_groups": len(groups), "scope_division_ids": sorted(scope)}
                self.case("scoped service combat groups", lambda: combat_scope(SERVICE))
                self.case("scoped legacy combat groups", lambda: combat_scope(COMBAT))
            if foreign and self.allowed(reader, "status.view"):
                for endpoint in (STRENGTH, STRENGTH + "submitted/", STRENGTH + "export/"):
                    self.case("foreign scope denied " + endpoint,
                              lambda p=endpoint: self.get(reader, p, {"division_id": foreign, "business_date": day}, 403))
        staff_actor = reader if self.allowed(reader, "status.view") else admin
        for parameter, value in (("division_id", "bad"), ("division_id", "0"),
                                 ("division_id", "-1"), ("division_id", "1.5"), ("division_id", " "),
                                 ("directorate_id", "bad"), ("directorate_id", "-1"),
                                 ("employee_ids", "bad"), ("position_level_max", "bad")):
            self.case(f"staff invalid {parameter}={value}",
                      lambda p=parameter, v=value: self.get(staff_actor, STAFF, {p: v}, 400))
        def page_clamping():
            payload = self.get(staff_actor, STAFF, {"page": 0, "page_size": 10001})
            assert payload["page"] == 1 and payload["page_size"] == 200, "Staff page guard did not clamp to documented bounds"
            assert len(records(payload)) <= 200
            return {"page": payload["page"], "page_size": payload["page_size"], "returned_rows": len(records(payload))}
        self.case("staff pagination bounds clamp", page_clamping)
        for value in ("", "bad", "2026-02-31"):
            self.case("service combat invalid date " + repr(value),
                      lambda v=value: self.get(admin, SERVICE, {"business_date": v}, 400))
        directorate = self.fixtures.get("directorate_id")
        if directorate:
            def filtered_staff():
                payload = self.get(staff_actor, STAFF, {"directorate_id": directorate, "with_summary": 1, "page": 1, "page_size": 10})
                rows = records(payload)
                allowed = self.descendants(directorate)
                assert all(row.get("division", {}).get("id") in allowed for row in rows), "Directorate filter leaked other units"
                assert len(rows) <= 10, "Pagination ignored"
                assert all("department_id" in row and "directorate_id" in row for row in rows), "Missing hierarchy metadata"
                return {"rows": len(rows), "count": payload.get("count"), "summary": payload.get("summary")}
            self.case("directorate staff hierarchy filter and pagination", filtered_staff)
        for path in ("/api/employees/import/", "/api/core/employees/import/", "/api/staff_unit/import/"):
            self.case("unrouted bulk import " + path, lambda p=path: self.get(admin, p, expected=404))
        snapshot_date = self.fixtures.get("snapshot_date")
        snapshot_unit = self.fixtures.get("snapshot_division_id", self.fixtures.get("division_id"))
        if snapshot_date and snapshot_unit:
            self.export_checks(admin, snapshot_unit, snapshot_date, "historical")

    def export_checks(self, actor, division, day, label, *, summary=False):
        query = {"division_id": division, "business_date": day}
        if not summary:
            self.case(label + " submitted counts", lambda: self.get(actor, STRENGTH + "submitted/", query))
        endpoint = "/api/operations/daily-summaries/export/" if summary else STRENGTH + "export/"
        for file_format in ("csv", "xlsx", "docx", "pdf"):
            def export(fmt=file_format):
                response = self.request(actor, "GET", endpoint, query={**query, "file_format": fmt})
                assert response.status == 200, f"Export returned {response.status}: {response.payload}"
                assert "attachment" in response.headers.get("content-disposition", ""), "Missing attachment disposition"
                text = document_text(response.blob, fmt)
                (self.output / f"{label}-{division}-{day}.{fmt}").write_bytes(response.blob)
                if fmt in ("xlsx", "docx"):
                    assert text.strip(), "Document has no readable text"
                    if label == "historical":
                        for expected in self.fixtures.get("snapshot_expected_text", []):
                            assert expected in text, f"Frozen personnel detail missing: {expected}"
                if fmt == "csv":
                    assert len(list(csv.reader(io.StringIO(text), delimiter=";"))) > 1, "CSV has no records"
                return {"bytes": len(response.blob), "text_characters": len(text), "content_type": response.headers.get("content-type")}
            self.case(label + " expense export " + file_format, export)
        self.case(label + " invalid export format", lambda: self.get(actor, endpoint, {**query, "file_format": "unknown"}, 400))

    def run_summary_checks(self, parent):
        actor = self.alias("admin")
        child = self.fixtures["workflow_division_id"]
        day = self.fixtures["business_date"]
        metadata = next((row for row in self.divisions if row["id"] == parent), None)
        assert metadata and metadata.get("code", "").startswith("SEED-") and child in self.descendants(parent), "Only the configured synthetic parent may be summarized"
        state = {}
        query = {"division_id": parent, "business_date": day}
        endpoint = "/api/operations/daily-summaries/"
        def assemble():
            response = self.request(actor, "POST", endpoint, data={**query, "allow_incomplete": True})
            assert response.status == 201, f"Summary returned {response.status}: {response.payload}"
            state["summary"] = response.payload
            state["detail"] = self.get(actor, SUBMISSIONS + str(response.payload["id"]) + "/")
            exported = self.request(actor, "GET", endpoint + "export/", query={**query, "file_format": "csv"})
            assert exported.status == 200, f"Summary export returned {exported.status}: {exported.payload}"
            state["csv"] = exported.blob
            (self.output / f"summary-{response.payload['id']}-before.csv").write_bytes(exported.blob)
            assert any(pin["division_id"] == child for pin in state["detail"]["snapshot"]["sources"]), "Submitted child version is not pinned"
            (self.output / "summary-before.json").write_text(json.dumps(state["detail"], ensure_ascii=False, indent=2), encoding="utf-8")
            return {"submission_id": response.payload["id"], "version": response.payload["version"], "pins": state["detail"]["snapshot"]["sources"]}
        self.case("summary assemble incomplete synthetic department", assemble)
        if "csv" not in state:
            return
        self.export_checks(actor, parent, day, "summary-original", summary=True)
        def leadership():
            leaders = records(self.get(actor, STAFF, {"division_id": parent, "position_level_max": 2}))
            names = [" ".join(row["employee"].get(key) or "" for key in ("last_name", "first_name", "middle_name")).strip() for row in leaders if row.get("employee")]
            assert len(names) >= 2, "Synthetic parent must have chief and deputy fixtures"
            text = document_text((self.output / f"summary-original-{parent}-{day}.xlsx").read_bytes(), "xlsx")
            assert all(name in text for name in names), "Department chief or deputy omitted from summary export"
            return {"expected_names": names}
        self.case("summary includes department chief and deputy", leadership)
        def send():
            missing_reason = self.request(actor, "POST", endpoint + "send/", data=query)
            assert missing_reason.status == 400 and missing_reason.payload.get("details", {}).get("laggards"), "Incomplete summary must require an explicit send reason"
            response = self.request(actor, "POST", endpoint + "send/", data={**query, "reason": "API-VAL тестовый неполный свод"})
            assert response.status == 200 and response.payload["sent_at"], f"Summary send returned {response.status}: {response.payload}"
            duplicate = self.request(actor, "POST", endpoint + "send/", data={**query, "reason": "API-VAL тестовый неполный свод"})
            assert duplicate.status == 409, "Summary may not be sent twice"
        self.case("summary incomplete send reason and duplicate guard", send)
        def pinned():
            current = records(self.get(actor, SUBMISSIONS, {"division_id": child, "business_date": day}))[0]
            response = self.request(actor, "POST", SUBMISSIONS + str(current["id"]) + "/amend/", data={"reason": "API-VAL проверка пинов свода", "sanction": "API-VAL тестовое согласование"})
            assert response.status == 201, f"Child amendment returned {response.status}: {response.payload}"
            after = self.get(actor, SUBMISSIONS + str(state["summary"]["id"]) + "/")
            assert after["snapshot"] == state["detail"]["snapshot"], "Parent snapshot or pins changed after child amendment"
            exported = self.request(actor, "GET", endpoint + "export/", query={**query, "file_format": "csv"})
            assert exported.status == 200 and exported.blob == state["csv"], "Pinned summary CSV changed after child amendment"
            (self.output / f"summary-{state['summary']['id']}-after.csv").write_bytes(exported.blob)
            freshness = self.get(actor, endpoint + "freshness/", query)
            assert freshness["status"] == "STALE" and any(row["division_id"] == child for row in freshness["superseded"]), "Summary freshness did not identify amended child"
            (self.output / "summary-after.json").write_text(json.dumps(after, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"current_child_version": response.payload["version"], "freshness": freshness}
        self.case("summary pinned snapshot and export remain stable after child amend", pinned)

    def run_mutation_checks(self):
        actor = self.alias("workflow_actor", self.alias("admin"))
        division = self.fixtures.get("workflow_division_id")
        employee = self.fixtures.get("workflow_employee_id")
        day = self.fixtures.get("workflow_date", self.fixtures["business_date"])
        assert actor and division and employee, "Mutation requires configured workflow actor, division and employee IDs"
        metadata = next((row for row in self.divisions if row["id"] == division), None)
        assert metadata and metadata.get("code", "").startswith("SEED-"), "Only synthetic SEED- units may be mutated"
        state = {}
        def submit():
            response = self.request(actor, "POST", SUBMISSIONS, data={"division_id": division, "business_date": day})
            assert response.status == 201, f"Submit returned {response.status}: {response.payload}"
            state["submission"] = response.payload
            state["detail"] = self.get(actor, SUBMISSIONS + str(response.payload["id"]) + "/")
            export = self.request(actor, "GET", SUBMISSIONS + str(response.payload["id"]) + "/export/")
            assert export.status == 200, f"Personal export returned {export.status}: {export.payload}"
            state["old_blob"] = export.blob
            (self.output / f"personal-{response.payload['id']}-before.xlsx").write_bytes(export.blob)
            (self.output / f"snapshot-{response.payload['id']}-before.json").write_text(
                json.dumps(state["detail"], ensure_ascii=False, indent=2), encoding="utf-8")
            return {"submission_id": response.payload["id"], "version": response.payload["version"]}
        self.case("workflow submit synthetic day", submit)
        if "old_blob" not in state:
            return
        self.export_checks(actor, division, day, "workflow-original")
        mutation = {"employee_id": employee, "status_type_code": "SICK_LEAVE", "date_start": day,
                    "date_end": (date.fromisoformat(day) + timedelta(days=1)).isoformat(),
                    "comment": "API-VAL тестовое место назначения"}
        def rejected_retro_edit():
            response = self.request(actor, "POST", "/api/operations/statuses/", data=mutation)
            assert response.status == 422 and response.payload.get("error_code") == "AMENDMENT_REASON_REQUIRED", (
                f"Retro edit without reason returned {response.status}: {response.payload}")
            detail = self.get(actor, SUBMISSIONS + str(state["submission"]["id"]) + "/")
            assert detail["is_current"] and detail["snapshot"] == state["detail"]["snapshot"], "Rejected retro edit changed the submitted day"
        self.case("workflow retro status edit requires amendment reason", rejected_retro_edit)
        def retro_edit():
            response = self.request(actor, "POST", "/api/operations/statuses/",
                                    data={**mutation, "amendment_reason": "API-VAL проверка замороженной версии"})
            assert response.status == 201, f"Status create returned {response.status}: {response.payload}"
            state["created_status_id"] = response.payload["id"]
            submissions = records(self.get(actor, SUBMISSIONS, {"division_id": division, "business_date": day}))
            current = next(row for row in submissions if row["is_current"])
            assert current["version"] == state["submission"]["version"] + 1, "Retro edit did not create one automatic amendment"
            detail = self.get(actor, SUBMISSIONS + str(current["id"]) + "/")
            assert detail["snapshot"] != state["detail"]["snapshot"], "New status did not change current snapshot"
            state["current"] = current
            return {"status_id": response.payload["id"], "current_version": current["version"]}
        self.case("workflow retro status edit automatically amends current version", retro_edit)
        if "current" not in state:
            return
        def amend():
            response = self.request(actor, "POST", SUBMISSIONS + str(state["current"]["id"]) + "/amend/",
                                    data={"reason": "API-VAL проверка версий", "sanction": "API-VAL тестовое согласование"})
            assert response.status == 201, f"Amend returned {response.status}: {response.payload}"
            assert response.payload["version"] == state["current"]["version"] + 1, "Amend did not advance version"
            state["amended"] = response.payload
            return {"submission_id": response.payload["id"], "version": response.payload["version"]}
        self.case("workflow amend advances version", amend)
        def stable_old():
            old_id = state["submission"]["id"]
            detail = self.get(actor, SUBMISSIONS + str(old_id) + "/")
            assert detail["snapshot"] == state["detail"]["snapshot"], "Old snapshot changed after amend"
            response = self.request(actor, "GET", SUBMISSIONS + str(old_id) + "/export/")
            assert response.status == 200
            assert frozen_personal_cells(response.blob) == frozen_personal_cells(state["old_blob"]), "Frozen personal export cells changed"
            assert not detail["is_current"], "Superseded submission is still current"
            (self.output / f"personal-{old_id}-after.xlsx").write_bytes(response.blob)
            (self.output / f"snapshot-{old_id}-after.json").write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"old_version": detail["version"], "old_submission_id": old_id}
        self.case("workflow old snapshot and personal export remain frozen", stable_old)
        self.export_checks(actor, division, day, "workflow-amended")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--credentials", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mutate", action="store_true")
    parser.add_argument("--workflow-actor", help="Actor alias for the explicitly scheduled synthetic expense workflow")
    parser.add_argument("--workflow-date", help="Business date for the explicitly scheduled synthetic expense workflow")
    parser.add_argument("--summary-division-id", type=int, help="Explicit synthetic parent for a separately scheduled summary workflow")
    args = parser.parse_args()
    credentials = read_json(outside_repository(args.credentials))
    actors = credentials.get("actors", credentials.get("accounts", {}))
    fixtures = dict(credentials.get("fixtures", {}))
    if args.manifest:
        manifest = read_json(outside_repository(args.manifest))
        fixtures.update(manifest.get("api_workflows", manifest.get("fixtures", manifest)))
    if args.workflow_actor:
        fixtures.setdefault("actor_aliases", {})["workflow_actor"] = args.workflow_actor
    if args.workflow_date:
        fixtures["workflow_date"] = args.workflow_date
    if not actors:
        raise ValueError("Credentials JSON must contain an actors or accounts object")
    audit = Audit(args.api_url, actors, fixtures, outside_repository(args.output))
    try:
        audit.run_read_checks()
        if args.mutate:
            audit.run_mutation_checks()
        if args.summary_division_id:
            audit.run_summary_checks(args.summary_division_id)
    finally:
        audit.save()
    print(json.dumps({"passed": sum(case["passed"] for case in audit.cases),
                      "failed": sum(not case["passed"] for case in audit.cases),
                      "report": str(audit.output / "api-workflows.json")}, ensure_ascii=False))
    return 1 if any(not case["passed"] for case in audit.cases) else 0


if __name__ == "__main__":
    sys.exit(main())
