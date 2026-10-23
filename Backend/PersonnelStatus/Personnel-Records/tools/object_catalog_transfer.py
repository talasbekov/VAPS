#!/usr/bin/env python3
"""Transfer only an editable object catalog; import defaults to read-only planning.

Standalone: copy this file into a compatible Django backend, then execute from
its /app directory. No migration, package installation or application restart.
The append-only domain audit is also the durable import receipt: losing a local
receipt file cannot cause a duplicate import. This is not a database restore.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from uuid import UUID, uuid4

FORMAT = "smart-object-transfer/v1"
RECEIPT_FORMAT = "smart-object-transfer-receipt/v1"
ACTION = "SECURITY_OBJECT_CATALOG_IMPORTED"
MAX_BYTES = 2 * 1024 * 1024
BAD_TEXT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class TransferError(ValueError):
    """Stable error codes only: do not echo database values or input content."""


def fail(code):
    raise TransferError(code)


def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        fail("INVALID_FIELDS")


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,18}", value):
        fail("INVALID_ID")
    if int(value) > 2**63 - 1:
        fail("INVALID_ID")
    return value


def _uuid(value):
    if not isinstance(value, str):
        fail("INVALID_UUID")
    try:
        if str(UUID(value)) != value:
            fail("INVALID_UUID")
    except ValueError:
        fail("INVALID_UUID")
    return value


def _text(value, maximum, *, required=False):
    if not isinstance(value, str) or len(value) > maximum or BAD_TEXT.search(value):
        fail("INVALID_TEXT")
    if required and (not value.strip() or value != value.strip()):
        fail("INVALID_TEXT")
    return value


def _canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")


def bundle_digest(bundle):
    return hashlib.sha256(_canonical({
        key: value for key, value in bundle.items() if key != "bundleSha256"
    })).hexdigest()


def validate_bundle(bundle):
    _keys(bundle, ("format", "exportId", "source", "object", "sectors", "bundleSha256"))
    if bundle["format"] != FORMAT:
        fail("UNSUPPORTED_FORMAT")
    _uuid(bundle["exportId"])
    _keys(bundle["source"], ("namespace", "objectId", "code"))
    _uuid(bundle["source"]["namespace"])
    _id(bundle["source"]["objectId"])
    _text(bundle["source"]["code"], 50, required=True)
    obj = bundle["object"]
    _keys(obj, ("name", "objectType", "region", "address", "ownership", "objectState"))
    for key, limit in (("name", 255), ("objectType", 100), ("region", 255), ("address", 500)):
        _text(obj[key], limit, required=key == "name")
    if obj["ownership"] not in ("OWN", "GUARDED") or obj["objectState"] not in ("ACTIVE", "ARCHIVED"):
        fail("INVALID_OBJECT_STATE")
    if not isinstance(bundle["sectors"], list) or len(bundle["sectors"]) > 100:
        fail("INVALID_SECTORS")
    sector_ids, post_ids = set(), set()
    for sector in bundle["sectors"]:
        _keys(sector, ("id", "name", "posts"))
        sid = _id(sector["id"])
        if sid in sector_ids:
            fail("DUPLICATE_SOURCE_ID")
        sector_ids.add(sid)
        _text(sector["name"], 255, required=True)
        if not isinstance(sector["posts"], list):
            fail("INVALID_POSTS")
        for post in sector["posts"]:
            _keys(post, ("id", "name", "task", "requirements"))
            pid = _id(post["id"])
            if pid in post_ids:
                fail("DUPLICATE_SOURCE_ID")
            post_ids.add(pid)
            _text(post["name"], 255, required=True)
            _text(post["task"], 1000)
            _text(post["requirements"], 1000)
    if len(post_ids) > 1000:
        fail("TOO_MANY_POSTS")
    if not isinstance(bundle["bundleSha256"], str) or bundle["bundleSha256"] != bundle_digest(bundle):
        fail("DIGEST_MISMATCH")
    if len(_canonical(bundle)) > MAX_BYTES:
        fail("PACKAGE_TOO_LARGE")
    return bundle


def _authorize(actor_id, permission, department_id=None):
    from django.contrib.auth import get_user_model
    from organization_management.apps.operations.services import PermissionService

    actor_id = _id(actor_id)
    if not get_user_model().objects.filter(pk=actor_id, is_active=True).exists():
        fail("ACCESS_DENIED")
    # The object catalog has no division FK. A scoped grant cannot authorize
    # changing a global object merely by supplying a convenient department ID.
    perms = PermissionService.unscoped_permissions(actor_id)
    if "*" not in perms and permission not in perms:
        fail("ACCESS_DENIED")
    if department_id is not None:
        scoped = PermissionService.effective_permissions(actor_id, int(department_id))
        if "*" not in scoped and permission not in scoped:
            fail("ACCESS_DENIED")
    return actor_id


def _object_fields(obj):
    return {
        "name": obj.name, "objectType": obj.object_type, "region": obj.region,
        "address": obj.address, "ownership": obj.ownership, "objectState": obj.object_state,
    }


def _readonly_snapshot(connection, already_atomic):
    if not already_atomic:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")


def export_bundle(object_id, *, actor_id, source_namespace, export_id=None):
    from django.db import connection, transaction
    from organization_management.apps.operations.models_object import OpsSecurityObject
    from organization_management.apps.ops.passport import snapshot_sectors

    object_id, source_namespace = _id(object_id), _uuid(source_namespace)
    export_id = _uuid(export_id or str(uuid4()))
    already_atomic = connection.in_atomic_block
    with transaction.atomic():
        _readonly_snapshot(connection, already_atomic)
        _authorize(actor_id, "object.view")
        obj = OpsSecurityObject.objects.filter(pk=object_id).first()
        if obj is None:
            fail("OBJECT_NOT_FOUND")
        bundle = {
            "format": FORMAT, "exportId": export_id,
            "source": {"namespace": source_namespace, "objectId": object_id, "code": obj.code},
            "object": _object_fields(obj), "sectors": snapshot_sectors(obj),
        }
        bundle["bundleSha256"] = bundle_digest(bundle)
        return validate_bundle(bundle)


def _lock(key):
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [key])


def _mapping(bundle, raw):
    expected = {
        "sectors": {sector["id"] for sector in bundle["sectors"]},
        "posts": {post["id"] for sector in bundle["sectors"] for post in sector["posts"]},
    }
    if raw is None:
        return {kind: {key: {"id": None} for key in ids} for kind, ids in expected.items()}
    _keys(raw, expected)
    for kind, keys in expected.items():
        _keys(raw[kind], keys)
        used = set()
        for value in raw[kind].values():
            _keys(value, ("id",))
            if value["id"] is not None:
                target = _id(value["id"])
                if target in used:
                    fail("MAPPING_CONFLICT")
                used.add(target)
    return copy.deepcopy(raw)


def _check_current_mapping(receipt):
    from organization_management.apps.operations.models_object import (
        OpsObjectSector, OpsSecurityObject, OpsSecurityPost,
    )
    target_id = receipt["target"]["objectId"]
    if not OpsSecurityObject.objects.filter(pk=target_id).exists():
        fail("MAPPING_DAMAGED")
    sector_ids = [entry["id"] for entry in receipt["sectors"].values()]
    post_ids = [entry["id"] for entry in receipt["posts"].values()]
    if (OpsObjectSector.objects.filter(pk__in=sector_ids, security_object_id=target_id).count() != len(sector_ids)
            or OpsSecurityPost.objects.filter(pk__in=post_ids, sector__security_object_id=target_id).count() != len(post_ids)):
        fail("MAPPING_DAMAGED")
    # Names, order, descriptions and movement between sectors of this object
    # are normal edits. A replay must never replace them with the old export.


def _receipt(bundle, department, target_id, mapping, *, applied, reused=False):
    return {
        "format": RECEIPT_FORMAT, "exportId": bundle["exportId"],
        "bundleSha256": bundle["bundleSha256"], "applied": applied, "reused": reused,
        "source": {"namespace": bundle["source"]["namespace"], "objectId": bundle["source"]["objectId"]},
        "target": {"objectId": target_id, "departmentId": str(department.pk), "departmentName": department.name},
        "sectors": copy.deepcopy(mapping["sectors"]), "posts": copy.deepcopy(mapping["posts"]),
    }


def _replay(bundle, department, target_object_id, supplied_mapping, *, apply):
    from organization_management.apps.operations.models_audit import OpsAuditLog
    from organization_management.apps.operations.models_object import OpsSecurityObject

    logs = OpsAuditLog.objects.filter(action=ACTION, entity_type="security_object")
    previous = list(logs.filter(new_value__receipt__exportId=bundle["exportId"])[:2])
    if len(previous) > 1:
        fail("IMPORT_LEDGER_CONFLICT")
    if previous:
        receipt = copy.deepcopy(previous[0].new_value["receipt"])
        if (receipt["bundleSha256"] != bundle["bundleSha256"]
                or receipt["source"] != {"namespace": bundle["source"]["namespace"], "objectId": bundle["source"]["objectId"]}
                or receipt["target"]["departmentId"] != str(department.pk)
                or (target_object_id is not None and target_object_id != receipt["target"]["objectId"])):
            fail("EXPORT_ID_COLLISION")
        if supplied_mapping is not None:
            for kind in ("sectors", "posts"):
                for source_id, supplied in supplied_mapping[kind].items():
                    # Original nulls mean "create on first import". On replay
                    # use the committed mapping, never create another row.
                    if supplied["id"] is not None and supplied != receipt[kind][source_id]:
                        fail("MAPPING_CONFLICT")
        if apply:
            list(OpsSecurityObject.objects.select_for_update().filter(pk=receipt["target"]["objectId"]))
        _check_current_mapping(receipt)
        receipt.update(applied=apply, reused=True)
        receipt["target"]["departmentName"] = department.name
        return receipt
    if logs.filter(
        new_value__receipt__source__namespace=bundle["source"]["namespace"],
        new_value__receipt__source__objectId=bundle["source"]["objectId"],
    ).exists():
        fail("SOURCE_ALREADY_IMPORTED")
    return None


def _check_existing(bundle, obj, mapping, *, apply):
    from organization_management.apps.operations.models_object import OpsObjectSector, OpsSecurityPost

    if _object_fields(obj) != bundle["object"]:
        fail("OBJECT_METADATA_CONFLICT")
    sectors = OpsObjectSector.objects.filter(security_object=obj)
    posts = OpsSecurityPost.objects.filter(sector__security_object=obj)
    if apply:
        sectors, posts = sectors.select_for_update(), posts.select_for_update()
    by_sector = {str(row.pk): row for row in sectors}
    by_post = {str(row.pk): row for row in posts}
    for source in bundle["sectors"]:
        sid = mapping["sectors"][source["id"]]["id"]
        if sid is not None:
            if sid not in by_sector or by_sector[sid].name != source["name"]:
                fail("MAPPING_CONFLICT")
        elif any(row.name.casefold() == source["name"].casefold() for row in by_sector.values()):
            fail("SECTOR_COLLISION")
        for post in source["posts"]:
            pid = mapping["posts"][post["id"]]["id"]
            if pid is not None:
                row = by_post.get(pid)
                if (row is None or sid is None or str(row.sector_id) != sid
                        or (row.name, row.task, row.requirements) != (post["name"], post["task"], post["requirements"])):
                    fail("MAPPING_CONFLICT")
            elif sid is not None and any(
                str(row.sector_id) == sid and row.name.casefold() == post["name"].casefold()
                for row in by_post.values()
            ):
                fail("POST_COLLISION")


def _apply_catalog(bundle, obj, mapping):
    from django.db.models import Max
    from organization_management.apps.operations.models_object import OpsObjectSector, OpsSecurityPost
    from organization_management.apps.ops import passport

    if obj is None:
        fields = bundle["object"]
        obj = passport.create_object(
            name=fields["name"], object_type=fields["objectType"], region=fields["region"],
            address=fields["address"], ownership=fields["ownership"],
        )
        if obj.object_state != fields["objectState"]:
            obj.object_state = fields["objectState"]
            obj.save(update_fields=["object_state", "updated_at"])
    # Direct additive insertion deliberately avoids update_passport's replacement
    # semantics. No existing catalog row or published version is deleted/changed.
    position = obj.sectors.aggregate(last=Max("position"))["last"] or 0
    for source in bundle["sectors"]:
        sid = mapping["sectors"][source["id"]]["id"]
        if sid is None:
            position += 1
            sector = OpsObjectSector.objects.create(
                security_object=obj, name=source["name"], position=position,
            )
            sid = mapping["sectors"][source["id"]]["id"] = str(sector.pk)
        else:
            sector = OpsObjectSector.objects.get(pk=sid, security_object=obj)
        post_position = sector.posts.aggregate(last=Max("position"))["last"] or 0
        for post in source["posts"]:
            if mapping["posts"][post["id"]]["id"] is None:
                post_position += 1
                created = OpsSecurityPost.objects.create(
                    sector=sector, name=post["name"], task=post["task"],
                    requirements=post["requirements"], position=post_position,
                )
                mapping["posts"][post["id"]]["id"] = str(created.pk)
    # The existing state resolver distinguishes draft data from publication.
    obj.passport_state = passport.resolve_passport_state(obj)
    obj.save(update_fields=["passport_state", "updated_at"])
    return obj


def import_bundle(bundle, *, actor_id, department_id, expected_department_name,
                  target_object_id=None, mapping=None, apply=False):
    from django.db import connection, transaction
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.operations.clock import Clock
    from organization_management.apps.operations.models_audit import OpsAuditLog
    from organization_management.apps.operations.models_object import OpsSecurityObject

    if type(apply) is not bool:
        fail("INVALID_APPLY_FLAG")
    validate_bundle(bundle)
    department_id = _id(department_id)
    _text(expected_department_name, 255, required=True)
    if target_object_id is not None:
        target_object_id = _id(target_object_id)
    if target_object_id is None and mapping is not None:
        fail("MAPPING_REQUIRES_TARGET")
    supplied_mapping = copy.deepcopy(mapping)
    planned_mapping = _mapping(bundle, mapping)
    already_atomic = connection.in_atomic_block
    with transaction.atomic():
        if not apply:
            _readonly_snapshot(connection, already_atomic)
        actor_id = _authorize(actor_id, "object.manage", department_id)
        department = Division.objects.filter(
            pk=department_id, is_active=True, archived_at__isnull=True,
            division_type=Division.DivisionType.DEPARTMENT,
        ).first()
        if department is None or department.name != expected_department_name:
            fail("DEPARTMENT_MISMATCH")
        if apply:
            _lock("catalog-import-export:" + bundle["exportId"])
            _lock("catalog-import-source:" + bundle["source"]["namespace"] + ":" + bundle["source"]["objectId"])
        reused = _replay(bundle, department, target_object_id, supplied_mapping, apply=apply)
        if reused is not None:
            return reused
        obj = None
        if target_object_id is not None:
            if mapping is None:
                fail("EXPLICIT_MAPPING_REQUIRED")
            query = OpsSecurityObject.objects
            if apply:
                query = query.select_for_update()
            obj = query.filter(pk=target_object_id).first()
            if obj is None:
                fail("OBJECT_NOT_FOUND")
            if OpsAuditLog.objects.filter(action=ACTION, entity_type="security_object", entity_id=obj.pk).exists():
                fail("TARGET_ALREADY_IMPORTED")
            _check_existing(bundle, obj, planned_mapping, apply=apply)
        else:
            if apply:
                _lock("ops_security_objects.code")
            if OpsSecurityObject.objects.filter(name__iexact=bundle["object"]["name"]).exists():
                fail("OBJECT_COLLISION")
        if apply:
            obj = _apply_catalog(bundle, obj, planned_mapping)
        receipt = _receipt(
            bundle, department, str(obj.pk) if obj is not None else None,
            planned_mapping, applied=apply,
        )
        if apply:
            # The standalone file also works on compatible older application
            # code whose audit_service ACTIONS does not yet contain this event.
            # The existing append-only model/DB trigger remain authoritative.
            OpsAuditLog.objects.create(
                actor_user_id=actor_id, action=ACTION, entity_type="security_object",
                entity_id=obj.pk, old_value=None, new_value={"receipt": receipt},
                reason="Portable object catalog import; no personnel or published history",
                created_at=Clock.now(),
            )
        return receipt


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def read_json(path):
    raw = Path(path).read_bytes()
    if len(raw) > MAX_BYTES:
        fail("PACKAGE_TOO_LARGE")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError):
        fail("INVALID_JSON")


def write_json(path, value, *, replace=False):
    path = Path(path)
    data = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if path.exists() and not replace:
        if path.read_text(encoding="utf-8") == data:
            return
        fail("OUTPUT_EXISTS")
    descriptor, temporary = tempfile.mkstemp(prefix=".catalog-transfer-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", type=Path, default=Path.cwd(),
                        help="Configured Django backend directory; default: current directory")
    sub = parser.add_subparsers(dest="mode", required=True)
    export = sub.add_parser("export")
    export.add_argument("--object-id", required=True)
    export.add_argument("--source-namespace", required=True)
    export.add_argument("--export-id")
    export.add_argument("--actor-id", required=True)
    export.add_argument("--output", type=Path, required=True)
    importing = sub.add_parser("import")
    importing.add_argument("--input", type=Path, required=True)
    importing.add_argument("--actor-id", required=True)
    importing.add_argument("--target-department-id", required=True)
    importing.add_argument("--expected-department-name", required=True)
    importing.add_argument("--target-object-id")
    importing.add_argument("--mapping", type=Path)
    importing.add_argument("--receipt", type=Path, required=True)
    importing.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        # A delivered script can live anywhere. Never assume its parent is the
        # application, or silently pick a different installation's settings.
        app_root = args.app_root.resolve()
        if not (app_root / "organization_management").is_dir():
            fail("APP_ROOT_INVALID")
        sys.path.insert(0, str(app_root))
        if not os.environ.get("DJANGO_SETTINGS_MODULE"):
            fail("DJANGO_SETTINGS_MODULE_REQUIRED")
        import django
        django.setup()
        if args.mode == "export":
            bundle = export_bundle(
                args.object_id, actor_id=args.actor_id,
                source_namespace=args.source_namespace, export_id=args.export_id,
            )
            write_json(args.output, bundle)
            result = {"exported": True, "exportId": bundle["exportId"], "bundleSha256": bundle["bundleSha256"],
                      "sectors": len(bundle["sectors"]), "posts": sum(len(s["posts"]) for s in bundle["sectors"])}
        else:
            inputs = [args.input] + ([args.mapping] if args.mapping else [])
            if args.receipt.resolve() in {path.resolve() for path in inputs}:
                fail("RECEIPT_OVERWRITES_INPUT")
            receipt = import_bundle(
                read_json(args.input), actor_id=args.actor_id,
                department_id=args.target_department_id,
                expected_department_name=args.expected_department_name,
                target_object_id=args.target_object_id,
                mapping=read_json(args.mapping) if args.mapping else None, apply=args.apply,
            )
            write_json(args.receipt, receipt, replace=True)
            result = {"applied": receipt["applied"], "reused": receipt["reused"],
                      "exportId": receipt["exportId"], "posts": len(receipt["posts"])}
        print(json.dumps(result, sort_keys=True))
        return 0
    except TransferError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
    except Exception:
        # DB and OS exception text can include connection details or row data.
        # The transaction rolls back; a committed import can recover its receipt.
        print(json.dumps({"error": "TRANSFER_FAILED"}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
