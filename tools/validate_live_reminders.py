#!/usr/bin/env python3
"""Observe the reserved stand's real Beat reminders without invoking any task.

Only --submit-a writes: it submits the fixture unit A as its scoped chief.
Credentials and all captured evidence stay outside Git. The real wall clock,
worker schedule, unit B, and shared control settings are never changed.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
from urllib.parse import urlencode

import websockets

from validate_populated_api_workflows import Audit, outside_repository, read_json, records


NOTIFICATIONS = "/api/operations/notifications/"
PHASES = {"before_deadline", "overdue"}
WS_ENDPOINT = "ws://127.0.0.1:3345/ws/operations/notifications/"


def now():
    return datetime.now(timezone.utc)


class ReminderAudit:
    def __init__(self, args):
        self.output = outside_repository(args.output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.fixtures = read_json(outside_repository(args.fixtures))
        self.compose = outside_repository(args.compose)
        compose = read_json(self.compose)
        assert compose.get("name") == "smart-soak-20261007", "Unexpected Docker stand"
        assert set(compose.get("services", {})) == {"backend", "worker", "db", "redis"}
        assert self.fixtures["division_a"] == 38 and self.fixtures["division_b"] == 41
        assert self.fixtures["users"] == {"a_chief": 58, "a_deputy": 59, "b_chief": 60, "b_deputy": 61}
        self.day = self.fixtures["business_date"]
        self.deadline = datetime.fromisoformat(self.fixtures["deadline"]).replace(microsecond=0)
        assert now().astimezone(self.deadline.tzinfo).date().isoformat() == self.day, "Fixture is not today"
        self.end = self.deadline + timedelta(seconds=190)
        self.verify_existing_phase = args.verify_existing_phase
        if self.verify_existing_phase:
            self.end = now() + timedelta(seconds=330)
        environment = read_json(outside_repository(args.browser_env))
        accounts = read_json(outside_repository(args.credentials))["actors"]
        self.actors = {
            alias: {"username": "vld_reminder_" + alias, "password": environment["SMOKE_PASSWORD"]}
            for alias in self.fixtures["users"]
        }
        self.actors.update({alias: accounts[alias] for alias in ("admin", "no_rights")})
        self.api = Audit(args.api_url, self.actors, {}, self.output)
        self.events, self.connections, self.observations = [], [], []
        self.expected_user_ids = {alias: str(pk) for alias, pk in self.fixtures["users"].items()}
        self.connected = {alias: asyncio.Event() for alias in self.actors}
        self.submit_a = args.submit_a
        self.started_at = now().isoformat()
        self.result = {"state": "starting", "started_at": self.started_at,
                       "deadline": self.deadline.isoformat(), "observe_until": self.end.isoformat(),
                       "business_date": self.day, "transport": WS_ENDPOINT}
        self.baseline = None

    def save(self):
        self.api.save()
        evidence = {**self.result, "observations": self.observations,
                    "connections": self.connections, "websocket_events": self.events}
        (self.output / "reminder-evidence.json").write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")

    def db(self):
        # This subprocess reads only the reserved stand and never calls a task.
        code = '''import os,json,django
os.environ.setdefault('DJANGO_SETTINGS_MODULE','organization_management.config.settings.production')
django.setup()
from django.db import connection
from django.contrib.auth import get_user_model
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.models_submission import OpsSubmissionControlSettings,OpsDailySubmission
assert connection.settings_dict['NAME']=='smart_soak_20261007'
day=DAY_PLACEHOLDER
print(json.dumps({'database':connection.settings_dict['NAME'],
'users':list(get_user_model().objects.filter(pk__in=[58,59,60,61]).values('id','username','is_active')),
'notifications':list(OpsNotification.objects.filter(business_date=day,kind='SUBMISSION_LAGGING',dedupe_key__in=['submission:before_deadline','submission:overdue']).order_by('id').values('id','recipient','kind','business_date','dedupe_key','payload','created_at')),
'control':list(OpsSubmissionControlSettings.objects.all().values('control_hour','required_division_ids','default_notify_recipient')),
'submissions':list(OpsDailySubmission.objects.filter(division_id__in=[38,41],business_date=day).order_by('id').values('id','division_id','version','is_current','submitted_by','submitted_at'))},default=str,ensure_ascii=False))
'''.replace("DAY_PLACEHOLDER", repr(self.day))
        process = subprocess.run(["docker", "compose", "-f", str(self.compose), "exec", "-T", "backend", "python", "-"],
                                 input=code, text=True, capture_output=True, encoding="utf-8", timeout=30)
        assert process.returncode == 0, f"Readonly DB query failed with exit {process.returncode}"
        return json.loads(process.stdout)

    def relevant(self, rows):
        return [row for row in rows if row.get("kind") == "SUBMISSION_LAGGING"
                and row.get("business_date") == self.day
                and row.get("payload", {}).get("phase") in PHASES]

    def rest(self):
        result = {}
        for actor in self.actors:
            payload = self.api.get(actor, NOTIFICATIONS, {"page_size": 100, "recipient": "60"})
            rows = self.relevant(records(payload))
            if actor in self.expected_user_ids:
                assert all(row["recipient"] == self.expected_user_ids[actor] for row in rows), "Foreign REST notification"
            else:
                assert not rows, f"Reminder leaked into unrelated actor {actor}"
            result[actor] = rows
        return result

    def validate_db(self, db, overdue):
        assert db["control"] == [{"control_hour": "19:23:21", "required_division_ids": [38, 41],
                                   "default_notify_recipient": ""}], "Shared control changed"
        rows = db["notifications"]
        expected = {(str(pk), "before_deadline") for pk in self.fixtures["users"].values()}
        if overdue:
            expected |= {("60", "overdue"), ("61", "overdue")}
        actual = Counter((row["recipient"], row["payload"]["phase"]) for row in rows)
        assert set(actual) == expected and all(n == 1 for n in actual.values()), f"Wrong phase recipients/counts: {actual}"
        for row in rows:
            phase = row["payload"]["phase"]
            assert row["dedupe_key"] == "submission:" + phase
            unit = 38 if row["recipient"] in {"58", "59"} else 41
            assert row["payload"]["laggard_division_ids"] == [unit]
            assert datetime.fromisoformat(row["payload"]["deadline_at"]) == self.deadline
            if phase == "overdue":
                assert datetime.fromisoformat(row["created_at"]) >= self.deadline
        if self.baseline:
            before = [row for row in rows if row["payload"]["phase"] == "before_deadline"]
            baseline_before = [row for row in self.baseline["db"]["notifications"]
                               if row["payload"]["phase"] == "before_deadline"]
            assert before == baseline_before, "Existing reminders changed"

    async def capture(self, actor):
        while now() < self.end:
            # A reconnect uses a fresh access token, which is never written/logged.
            await asyncio.to_thread(self.api.login, actor)
            url = WS_ENDPOINT + "?" + urlencode({"token": self.api.tokens[actor]})
            try:
                async with websockets.connect(url, open_timeout=10, close_timeout=5,
                                               ping_interval=20, ping_timeout=20) as socket:
                    self.connections.append({"actor": actor, "at": now().isoformat(), "state": "connected"})
                    self.connected[actor].set()
                    self.save()
                    while now() < self.end:
                        try:
                            raw = await asyncio.wait_for(socket.recv(), timeout=min(30, max(1, (self.end-now()).total_seconds())))
                        except asyncio.TimeoutError:
                            continue
                        packet = json.loads(raw)
                        self.events.append({"actor": actor, "received_at": now().isoformat(), "packet": packet})
                        self.save()
                        print(f"WS packet actor={actor} type={packet.get('type')} notification_id={packet.get('payload', {}).get('id')}", flush=True)
            except Exception as error:
                # Exception strings may contain the token URL; record only safe fields.
                self.connections.append({"actor": actor, "at": now().isoformat(), "state": "disconnected",
                                         "error_type": type(error).__name__})
                self.save()
                await asyncio.sleep(5)

    async def observe(self, label):
        db = await asyncio.to_thread(self.db)
        rest = await asyncio.to_thread(self.rest)
        observation = {"label": label, "observed_at": now().isoformat(), "db": db, "rest": rest}
        self.observations.append(observation)
        self.save()
        return observation

    def worker_logs(self):
        process = subprocess.run(["docker", "compose", "-f", str(self.compose), "logs", "--no-color",
                                  "--since", self.started_at, "worker"], text=True, capture_output=True,
                                 encoding="utf-8", timeout=20)
        assert process.returncode == 0, "Worker log read failed"
        lines = [line for line in process.stdout.splitlines() if "operations.remind_daily_submissions" in line]
        (self.output / "worker-reminder-ticks.log").write_text("\n".join(lines)+"\n", encoding="utf-8")
        return len(lines)

    async def run(self):
        if self.verify_existing_phase:
            return await self.run_existing_phase()
        assert now() < self.deadline, "The before phase must be observed before its real deadline"
        self.baseline = await self.observe("before_submission")
        self.validate_db(self.baseline["db"], False)
        assert not self.baseline["db"]["submissions"], "One of the reserved units is already submitted"
        for actor, rows in self.baseline["rest"].items():
            assert len(rows) == (1 if actor in self.expected_user_ids else 0)
        self.result["before_phase_verified"] = True
        self.result["state"] = "connecting"
        self.save()
        captures = [asyncio.create_task(self.capture(actor)) for actor in self.actors]
        try:
            await asyncio.wait_for(asyncio.gather(*(event.wait() for event in self.connected.values())), timeout=30)
            print("BASELINE PASS: four unique before reminders; six frontend WebSockets connected", flush=True)
            if self.submit_a:
                response = await asyncio.to_thread(self.api.request, "a_chief", "POST", "/api/operations/daily-submissions/",
                                                    data={"division_id": 38, "business_date": self.day})
                assert response.status == 201, f"Unit A submit returned {response.status}"
                assert response.payload["submitted_by"] == "58" and response.payload["division_id"] == 38
                self.result["unit_a_submission"] = response.payload
                after = await self.observe("after_unit_a_submission")
                self.validate_db(after["db"], False)
                assert len(after["db"]["submissions"]) == 1
                assert after["db"]["submissions"][0]["division_id"] == 38
                assert after["db"]["submissions"][0]["submitted_by"] == "58"
                print(f"SUBMIT A PASS: unit38 chief58 submission_id={response.payload['id']}; unit41 remains missing", flush=True)
            self.result["state"] = "waiting_for_real_deadline"
            self.save()
            count = 0
            while now() < self.end:
                await asyncio.sleep(min(30, max(0, (self.end-now()).total_seconds())))
                count += 1
                if count % 2:
                    continue
                observation = await self.observe("scheduled_poll")
                n = len(observation["db"]["notifications"])
                print(f"POLL at={observation['observed_at']} reminders={n} websocket_packets={len(self.events)}", flush=True)
            final = await self.observe("after_deadline_and_repeated_ticks")
            self.validate_db(final["db"], True)
            for actor, rows in final["rest"].items():
                expected_count = 2 if actor.startswith("b_") else 1 if actor.startswith("a_") else 0
                assert len(rows) == expected_count, f"Wrong final REST count for {actor}"
            phase_events = [event for event in self.events
                            if event["packet"].get("type") == "SUBMISSION_LAGGING"
                            and event["packet"].get("payload", {}).get("business_date") == self.day
                            and event["packet"]["payload"].get("payload", {}).get("phase") in PHASES]
            assert Counter(event["actor"] for event in phase_events) == Counter({"b_chief": 1, "b_deputy": 1}), "Wrong WebSocket recipients or duplicate delivery"
            ids = {row["recipient"]: row["id"] for row in final["db"]["notifications"] if row["payload"]["phase"] == "overdue"}
            for event in phase_events:
                packet = event["packet"]["payload"]
                actor_id = self.expected_user_ids[event["actor"]]
                assert packet["recipient"] == actor_id and packet["id"] == ids[actor_id]
                assert packet["payload"]["phase"] == "overdue" and packet["payload"]["laggard_division_ids"] == [41]
                assert datetime.fromisoformat(event["received_at"]) >= self.deadline
            stable = [row for row in self.observations if datetime.fromisoformat(row["observed_at"]) >= self.deadline
                      and len(row["db"]["notifications"]) == 6]
            assert len(stable) >= 3, "Fewer than three post-deadline stable observations"
            self.result.update(state="passed", finished_at=now().isoformat(), overdue_phase_verified=True,
                               websocket_delivery_verified=True, stable_post_deadline_observations=len(stable),
                               worker_log_line_count=self.worker_logs())
            self.save()
            print("FINAL PASS: only unit B chief/deputy overdue; no duplicates, A/admin/unrelated packets absent", flush=True)
        finally:
            for task in captures:
                task.cancel()
            await asyncio.gather(*captures, return_exceptions=True)

    async def run_existing_phase(self):
        """Read-only verification after the real phase and a transport repair."""
        assert not self.submit_a and now() >= self.deadline
        self.baseline = await self.observe("post_fix_phase_baseline")
        self.validate_db(self.baseline["db"], True)
        assert len(self.baseline["db"]["submissions"]) == 1
        assert self.baseline["db"]["submissions"][0]["division_id"] == 38
        captures = [asyncio.create_task(self.capture(actor)) for actor in self.actors]
        try:
            await asyncio.wait_for(asyncio.gather(*(event.wait() for event in self.connected.values())), timeout=30)
            connected_at = now()
            self.result["state"] = "observing_post_fix_connections"
            self.save()
            print("POST-FIX BASELINE PASS: six phase rows and six frontend sockets connected", flush=True)
            while now() < self.end:
                await asyncio.sleep(min(30, max(0, (self.end-now()).total_seconds())))
                observation = await self.observe("post_fix_stability_poll")
                self.validate_db(observation["db"], True)
                assert observation["db"]["notifications"] == self.baseline["db"]["notifications"]
                print(f"POST-FIX POLL at={observation['observed_at']} phase_rows=6 connections={len(self.connections)}", flush=True)
            assert (now()-connected_at).total_seconds() >= 300
            assert len(self.connections) == 6 and all(row["state"] == "connected" for row in self.connections), "Post-fix socket disconnected"
            assert not any(event["packet"].get("type") == "SUBMISSION_LAGGING"
                           and event["packet"].get("payload", {}).get("payload", {}).get("phase") in PHASES
                           for event in self.events), "Duplicate phase push after repair"
            self.result.update(state="passed", finished_at=now().isoformat(),
                               post_fix_stable_seconds=round((now()-connected_at).total_seconds(), 1),
                               phase_deduplication_verified=True, worker_log_line_count=self.worker_logs())
            self.save()
            print("POST-FIX FINAL PASS: six sockets stable beyond5minutes; six phase rows unchanged; no duplicate pushes", flush=True)
        finally:
            for task in captures:
                task.cancel()
            await asyncio.gather(*captures, return_exceptions=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--credentials", required=True, type=Path)
    parser.add_argument("--browser-env", required=True, type=Path)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--compose", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--submit-a", action="store_true")
    parser.add_argument("--verify-existing-phase", action="store_true", help="Read-only 5-minute socket/deduplication proof after the real overdue phase")
    audit = ReminderAudit(parser.parse_args())
    try:
        asyncio.run(audit.run())
    except Exception as error:
        audit.result.update(state="failed", error_type=type(error).__name__, error=str(error))
        audit.save()
        print(f"FAIL {type(error).__name__}: {error}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
