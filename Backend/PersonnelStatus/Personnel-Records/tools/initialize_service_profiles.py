#!/usr/bin/env python3
"""Explicit initial values for all employee profiles; dry-run unless --apply.

Run inside the configured backend: python tools/initialize_service_profiles.py
--actor-id ID [--apply] [--receipt NEW_FILE.json] [--app-root /app].
The configured DJANGO_SETTINGS_MODULE is required. Keep the same batch ID on
every retry and installation. A completed batch is never applied again, even
after a person manually clears a field. A new batch ID is a distinct operation.
No database settings, credentials, employee names or health data are exported.
"""
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import sys

OPERATION = "employee_service_profiles_initialized"
DEFAULT_BATCH_ID = "service-profiles-initial-20261020-v1"
ORIGIN = "массовое начальное заполнение"
SKILL_DEFAULTS = {"shooting": 5, "hand_to_hand": 5, "physical_fitness": 5}
MEASUREMENT_DEFAULTS = {"height_cm": 180, "weight_kg": 75}
REQUIRED_PERMISSIONS = {"personnel.view", "orgstructure.manage", "admin.roles"}


def initialize(*, actor_id, apply=False, batch_id=DEFAULT_BATCH_ID):
    """Validate everything before writing; revision audit and receipt are atomic."""
    from django.contrib.auth import get_user_model
    from django.contrib.contenttypes.models import ContentType
    from django.db import connection, transaction
    from organization_management.apps.audit.domain.models import AuditLog
    from organization_management.apps.employees.models import Employee, EmployeeServiceProfile
    from organization_management.apps.employees.service_profile import normalize_profile
    from organization_management.apps.operations.services import LegacyRoleSync, PermissionService

    if not isinstance(batch_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", batch_id):
        raise ValueError("Invalid batch ID.")
    if not str(actor_id).isdigit() or int(actor_id) <= 0:
        raise PermissionError("Active actor with global personnel permissions required.")
    if type(apply) is not bool:
        raise ValueError("Invalid apply flag.")
    with transaction.atomic():
        actor = get_user_model().objects.filter(pk=actor_id, is_active=True).first()
        permissions = (
            PermissionService.unscoped_permissions(LegacyRoleSync.actor_id_for_user(actor))
            if actor else set()
        )
        if not actor or not ("*" in permissions or REQUIRED_PERMISSIONS <= permissions):
            raise PermissionError("Active actor with global personnel permissions required.")
        if apply:
            # One lock for all initialization batches. The employee locks below
            # also serialize this command with the existing profile edit API.
            lock_id = int.from_bytes(hashlib.sha256(OPERATION.encode()).digest()[:8], "big", signed=True)
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])
        receipt = AuditLog.objects.filter(
            payload__operation=OPERATION, payload__batch_id=batch_id,
            payload__record_type="batch_receipt",
        ).order_by("pk").first()
        if receipt:
            return {
                **receipt.payload["counts"], "batch_id": batch_id, "origin": ORIGIN,
                "mode": "apply" if apply else "dry-run", "already_applied": True,
                "profiles_created": 0, "profiles_updated": 0, "fields_filled": 0,
            }
        # Employee has no soft-delete marker. Inactivity, fired status and archive
        # date are not deletion: include every row that still exists.
        employees = Employee.objects.order_by("pk")
        if apply:
            employees = employees.select_for_update()
        employee_ids = list(employees.values_list("pk", flat=True))
        profiles = {
            profile.employee_id: profile
            for profile in EmployeeServiceProfile.objects.filter(employee_id__in=employee_ids)
        }
        counts = {"employees": len(employee_ids), "profiles_created": 0, "profiles_updated": 0,
                  "fields_filled": 0}
        changes = []
        for employee_id in employee_ids:
            profile = profiles.get(employee_id)
            data = deepcopy(profile.data) if profile else {}
            try:
                normalize_profile(data)
            except (ValueError, TypeError, OverflowError):
                raise ValueError("Invalid stored profile; no profiles were initialized.") from None
            filled = []
            skills = deepcopy(data.get("skills") or {})
            for key, value in SKILL_DEFAULTS.items():
                if skills.get(key) is None:
                    skills[key] = value
                    filled.append("skills." + key)
            if any(field.startswith("skills.") for field in filled):
                data["skills"] = skills
            for key, value in MEASUREMENT_DEFAULTS.items():
                if data.get(key) is None:
                    data[key] = value
                    filled.append(key)
            if filled:
                # Only five approved values change. Preserve inventory/health,
                # including missing versus explicit null, exactly as stored.
                normalize_profile(data)
                changes.append((employee_id, profile, data, filled))
                counts["profiles_updated" if profile else "profiles_created"] += 1
                counts["fields_filled"] += len(filled)
        result = {**counts, "batch_id": batch_id, "origin": ORIGIN,
                  "mode": "apply" if apply else "dry-run", "already_applied": False}
        if not apply:
            return result
        content_type = ContentType.objects.get_for_model(EmployeeServiceProfile)
        for employee_id, profile, data, filled in changes:
            before = profile.revision if profile else 0
            if profile is None:
                profile = EmployeeServiceProfile(employee_id=employee_id)
            profile.data = data
            profile.revision = before + 1
            profile.save()
            AuditLog.objects.create(
                user=actor, action_type="UPDATE" if before else "CREATE",
                content_type=content_type, object_id=profile.pk,
                payload={"operation": OPERATION, "record_type": "profile_revision",
                         "batch_id": batch_id, "origin": ORIGIN, "filled_fields": filled,
                         "revision_before": before, "revision_after": profile.revision},
            )
        # This durable marker is created even for an empty or fully populated
        # population; an external receipt file is not the idempotency authority.
        AuditLog.objects.create(
            user=actor, action_type="UPDATE", content_type=content_type,
            payload={"operation": OPERATION, "record_type": "batch_receipt",
                     "batch_id": batch_id, "origin": ORIGIN, "counts": counts,
                     "initial_values": {"skills": SKILL_DEFAULTS, **MEASUREMENT_DEFAULTS}},
        )
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor-id", required=True, type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch-id", default=DEFAULT_BATCH_ID)
    parser.add_argument("--app-root", type=Path, help="Backend root containing organization_management; required if copied outside it")
    parser.add_argument("--receipt", type=Path, help="New aggregate JSON receipt file; never overwritten")
    args = parser.parse_args(argv)
    stream = None
    try:
        root = (args.app_root or Path(__file__).resolve().parents[1]).resolve()
        if not (root / "organization_management" / "__init__.py").is_file():
            raise ValueError("Application root is missing.")
        sys.path.insert(0, str(root))
        if args.receipt:
            # Refuse an existing destination before any DB writes.
            stream = args.receipt.open("x", encoding="utf-8")
        import django
        from django.apps import apps
        if not apps.ready:
            if not os.environ.get("DJANGO_SETTINGS_MODULE"):
                raise ValueError("DJANGO_SETTINGS_MODULE is required.")
            django.setup()
        result = initialize(actor_id=args.actor_id, apply=args.apply, batch_id=args.batch_id)
        encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        print(encoded, end="")
        return 0
    except Exception:
        # DB/validation exceptions may contain stored personnel values. Do not
        # echo them or a traceback. A failed file write can follow DB commit;
        # retry the same batch to retrieve its durable completion status.
        print("Initialization failed. No personnel data printed. Retry the same batch ID after checking configuration and audit receipt.", file=sys.stderr)
        return 1
    finally:
        if stream:
            stream.close()


if __name__ == "__main__":
    sys.exit(main())
