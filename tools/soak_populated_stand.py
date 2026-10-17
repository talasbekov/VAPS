#!/usr/bin/env python3
"""Bounded, read-only monitoring of the explicitly isolated populated stand."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import time
from urllib.request import urlopen

from validate_populated_api_workflows import Audit, outside_repository, read_json


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--until", required=True, help="Aware ISO datetime at which monitoring ends.")
    parser.add_argument("--interval", type=float, default=10.0, help="Seconds between individual requests.")
    args = parser.parse_args()
    deadline = datetime.fromisoformat(args.until.replace("Z", "+00:00"))
    if deadline.tzinfo is None:
        parser.error("--until requires a timezone")
    remaining = (deadline - datetime.now(timezone.utc)).total_seconds()
    if not 0 < remaining <= 4 * 3600:
        parser.error("The monitoring deadline must be within the next four hours")
    if not 1 <= args.interval <= 300:
        parser.error("--interval must be between 1 and 300 seconds")
    credentials = read_json(outside_repository(args.credentials))
    output = outside_repository(args.output)
    audit = Audit(credentials["api_url"], credentials["actors"], credentials["fixtures"], output)
    unit = audit.fixtures["division_id"]
    day = audit.fixtures["business_date"]
    checks = [
        ("divisions", "admin", "/api/core/divisions/", None),
        ("staff", "admin", "/api/staff_unit/staff-units/directorate/", {"page_size": 200}),
        ("scoped_staff", "dept_reader", "/api/staff_unit/staff-units/directorate/", {"division_id": unit}),
        ("strength", "admin", "/api/operations/strength-report/", {"business_date": day, "division_id": unit}),
        ("service_combat", "admin", "/api/ops/service-combat-duty/", {"business_date": day}),
        ("scoped_combat", "dept_reader", "/api/ops/combat-duty-shifts/", None),
    ]
    started = datetime.now(timezone.utc)
    samples: list[dict] = []
    index = 0
    report_path = output / "soak.json"

    def save(complete: bool = False) -> None:
        totals = {}
        for label in sorted({sample["label"] for sample in samples}):
            group = [sample for sample in samples if sample["label"] == label]
            elapsed = sorted(sample["elapsed_ms"] for sample in group)
            totals[label] = {
                "requests": len(group), "failures": sum(not sample["ok"] for sample in group),
                "median_ms": round(statistics.median(elapsed), 1),
                "p95_ms": elapsed[min(len(elapsed) - 1, int(len(elapsed) * 0.95))],
                "max_ms": max(elapsed),
            }
        temporary = report_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({
            "started_at": started.isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
            "deadline": deadline.isoformat(), "complete": complete,
            "requests": len(samples), "failures": sum(not sample["ok"] for sample in samples),
            "totals": totals, "samples": samples,
            "note": "Sequential read-only sampling; scheduled restarts are retained as failures, not silently removed.",
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(report_path)

    while datetime.now(timezone.utc) < deadline:
        label, actor, path, query = checks[index % len(checks)]
        before = time.perf_counter()
        sample = {"at": datetime.now(timezone.utc).isoformat(), "label": label, "ok": False}
        try:
            response = audit.request(actor, "GET", path, query=query)
            sample.update(status=response.status, bytes=len(response.blob))
            sample["ok"] = response.status == 200 and response.payload is not None
            if not sample["ok"]:
                sample["error"] = "Expected HTTP200 JSON"
        except Exception as error:
            # URL text can contain auth material; persist the exception class only.
            sample["error"] = type(error).__name__
        sample["elapsed_ms"] = round((time.perf_counter() - before) * 1000, 1)
        samples.append(sample)
        if index % 12 == 0:
            before = time.perf_counter()
            frontend = {"at": datetime.now(timezone.utc).isoformat(), "label": "frontend", "ok": False}
            try:
                with urlopen("http://127.0.0.1:3345/", timeout=30) as response:
                    frontend.update(status=response.status, bytes=len(response.read()))
                    frontend["ok"] = response.status == 200
            except Exception as error:
                frontend["error"] = type(error).__name__
            frontend["elapsed_ms"] = round((time.perf_counter() - before) * 1000, 1)
            samples.append(frontend)
        save()
        if index % 12 == 0:
            print(json.dumps({"requests": len(samples), "failures": sum(not s["ok"] for s in samples)}), flush=True)
        index += 1
        seconds = min(args.interval, max(0, (deadline - datetime.now(timezone.utc)).total_seconds()))
        time.sleep(seconds)
    save(complete=True)
    print("Monitoring complete: " + str(report_path), flush=True)
    return int(any(not sample["ok"] for sample in samples))


if __name__ == "__main__":
    raise SystemExit(main())
