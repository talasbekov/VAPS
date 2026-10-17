"""Private per-event GeoJSON. No geographic data is sent to an external service."""
import json
import math
import os
from pathlib import Path
import tempfile
from contextlib import contextmanager

from django.conf import settings
from django.db import DatabaseError, transaction
from django.utils import timezone

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops import security_events as events


def point(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"latitude", "longitude"}:
        raise events._validation({"location": "Укажите широту и долготу."})
    for key, limit in (("latitude", 90), ("longitude", 180)):
        number = value[key]
        if isinstance(number, bool) or not isinstance(number, (float, int)) or not math.isfinite(number) or abs(number) > limit:
            raise events._validation({"location": "Координаты выходят за допустимые границы."})
    return {key: round(float(value[key]), 6) for key in ("latitude", "longitude")}


def _path(event):
    return Path(settings.OPS_PRIVATE_STORAGE_ROOT) / "maps" / f"{event.pk}.geojson"


def _unavailable():
    return DomainError("PLACEMENT_MAP_UNAVAILABLE", 503, message="Координаты карты недоступны. Повторите загрузку или обратитесь к администратору.")


def _read(event):
    path = _path(event)
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return {"objects": {}, "posts": {}}
    except OSError as exc:
        raise _unavailable() from exc
    try:
        data = json.loads(raw)
        owner = data["properties"]
        if data["type"] != "FeatureCollection" or owner["version"] != 1 or owner["eventId"] != str(event.pk) or owner["createdAt"] != event.created_at.isoformat():
            raise ValueError("Map identity mismatch")
        recovery = None
        commit_id = owner.get("commitAuditId")
        if commit_id is not None:
            if isinstance(commit_id, bool) or not isinstance(commit_id, int) or commit_id < 1:
                raise ValueError("Invalid commit marker")
            if not OpsAuditLog.objects.filter(pk=commit_id, action=audit_service.SECURITY_EVENT_MAP_LOCATION_UPDATED, entity_id=str(event.pk)).exists():
                # OS lock release can precede PostgreSQL finishing a killed
                # writer's COMMIT. Recheck only after its row lock is settled.
                # NOWAIT preserves the normal DB -> file lock order.
                with transaction.atomic():
                    try:
                        OpsSecurityEvent.objects.select_for_update(nowait=True).get(pk=event.pk)
                    except (DatabaseError, OpsSecurityEvent.DoesNotExist) as exc:
                        raise _unavailable() from exc
                    settled = OpsAuditLog.objects.filter(pk=commit_id, action=audit_service.SECURITY_EVENT_MAP_LOCATION_UPDATED, entity_id=str(event.pk)).exists()
                if settled:
                    return _read(event)
                # A terminated writer can leave replaced bytes after SQL rolls
                # back. The previous revision is validated before restoration.
                recovery = path.with_suffix('.previous.geojson').read_bytes()
                data = json.loads(recovery)
                owner = data["properties"]
                if data["type"] != "FeatureCollection" or owner["version"] != 1 or owner["eventId"] != str(event.pk) or owner["createdAt"] != event.created_at.isoformat():
                    raise ValueError("Invalid previous map")
                previous_commit = owner.get("commitAuditId")
                if previous_commit is not None and not OpsAuditLog.objects.filter(pk=previous_commit, action=audit_service.SECURITY_EVENT_MAP_LOCATION_UPDATED, entity_id=str(event.pk)).exists():
                    raise ValueError("Previous revision is not committed")
        result = {"objects": {}, "posts": {}}
        for feature in data["features"]:
            if feature["type"] != "Feature":
                raise ValueError("Invalid feature")
            props, geometry = feature["properties"], feature["geometry"]
            location = None
            if geometry is not None:
                if geometry["type"] != "Point" or len(geometry["coordinates"]) != 2:
                    raise ValueError("Invalid point")
                longitude, latitude = geometry["coordinates"]
                location = point({"latitude": latitude, "longitude": longitude})
            target_id = str(props["targetId"])
            if props["targetType"] == "object" and location is not None:
                result["objects"][target_id] = location
            elif props["targetType"] == "post" and isinstance(props["outdoor"], bool):
                result["posts"][target_id] = {"location": location, "outdoor": props["outdoor"]}
            else:
                raise ValueError("Invalid target")
        if recovery is not None:
            _atomic_write(path, recovery)
        return result
    except (KeyError, TypeError, ValueError, OSError, DomainError) as exc:
        raise _unavailable() from exc


@contextmanager
def _file_lock(event):
    """Held through SQL commit/rollback; readers never see an uncommitted file."""
    path = _path(event)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path.with_suffix('.lock'), os.O_CREAT | os.O_RDWR, 0o600)
    except OSError as exc:
        raise _unavailable() from exc
    with os.fdopen(descriptor, 'r+b') as stream:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b'0'); stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            except OSError as exc:
                raise _unavailable() from exc
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            except OSError as exc:
                raise _unavailable() from exc
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def read(event, visit=None, *, locked=False):
    if not locked:
        try:
            _path(event).stat()
        except FileNotFoundError:
            return {"objects": {}, "posts": {}}
        except OSError as exc:
            raise _unavailable() from exc
        with _file_lock(event):
            return read(event, visit, locked=True)
    data = _read(event)
    visits = {str(visit.pk)} if visit is not None else {str(v.pk) for v in event.visit_objects.all()}
    posts = events.visit_object_posts(event, visit) if visit is not None else (event.recon_sector_posts or [])
    post_ids = {str(p.get("id")) for p in posts}
    return {"objects": {key: value for key, value in data["objects"].items() if key in visits},
            "posts": {key: value for key, value in data["posts"].items() if key in post_ids}}


def _encode(event, data, commit_id=None):
    features = []
    for kind, values in (("object", data["objects"]), ("post", data["posts"])):
        for target_id, value in sorted(values.items()):
            location = value if kind == "object" else value["location"]
            props = {"targetType": kind, "targetId": target_id}
            if kind == "post":
                props["outdoor"] = value["outdoor"]
            geometry = None if location is None else {"type": "Point", "coordinates": [location["longitude"], location["latitude"]]}
            features.append({"type": "Feature", "properties": props, "geometry": geometry})
    return json.dumps({"type": "FeatureCollection", "properties": {"version": 1, "eventId": str(event.pk), "createdAt": event.created_at.isoformat(), "updatedAt": timezone.now().isoformat(), "commitAuditId": commit_id}, "features": features}, ensure_ascii=False).encode("utf-8")


def _atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temp_name = stream.name
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def update(event_id, payload, *, actor, deputy=None):
    if not isinstance(payload, dict) or payload.get("targetType") not in {"object", "post"} or not payload.get("targetId") or "location" not in payload:
        raise events._validation({"targetId": "Выберите объект или наружный пост."})
    location = point(payload["location"])
    kind, target_id = payload["targetType"], str(payload["targetId"])
    if kind == "post" and not isinstance(payload.get("outdoor"), bool):
        raise events._validation({"outdoor": "Укажите, является ли пост наружным."})
    previous = None
    path = None
    changed = False
    lease = None
    leased = False
    try:
        with transaction.atomic():
            event = events.lock_event(event_id)
            lease = _file_lock(event)
            lease.__enter__()
            leased = True
            if kind == "object":
                visit = events.pick_visit_object(event, target_id, no_objects="Нет объектов посещения.", ambiguous="Выберите объект.")
            else:
                if not any(str(p.get("id")) == target_id for p in (event.recon_sector_posts or [])):
                    raise events._not_found("Пост не найден в этом мероприятии.", target_id)
                visit = events._visit_of_post(event, target_id)
            if visit is not None:
                events._require_visit_stage(visit, {"PLACEMENT", "APPROVAL"}, "Координаты можно менять на этапе «Расстановка» или в возвращённом черновике этого объекта.")
                if events.placement_frozen(visit):
                    events._refuse_frozen_placement(visit, what="Координаты расстановки")
            else:
                events._require_stage(event, "PLACEMENT", "Координаты можно менять на этапе «Расстановка».")
            data = read(event, locked=True)
            values = data["objects" if kind == "object" else "posts"]
            old_value = values.get(target_id)
            if location is None and (kind == "object" or not payload["outdoor"]):
                values.pop(target_id, None)
            else:
                values[target_id] = location if kind == "object" else {"location": location, "outdoor": payload["outdoor"]}
            path = _path(event)
            previous = path.read_bytes() if path.exists() else None
            entry = audit_service.record(actor=actor, action=audit_service.SECURITY_EVENT_MAP_LOCATION_UPDATED, entity_type=audit_service.ENTITY_SECURITY_EVENT, entity_id=event.pk, old_value={"targetType": kind, "targetId": target_id, "value": old_value}, new_value={"targetType": kind, "targetId": target_id, "value": values.get(target_id)})
            events._record_deputy_placement(event, deputy, {"operation": "map-location", "targetType": kind, "targetId": target_id})
            _atomic_write(path.with_suffix('.previous.geojson'), previous or _encode(event, {"objects": {}, "posts": {}}))
            _atomic_write(path, _encode(event, data, entry.pk))
            changed = True
            event.save(update_fields=["updated_at"])
        return data
    except Exception:
        if changed:
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                _atomic_write(path, previous)
        raise
    finally:
        if leased:
            lease.__exit__(None, None, None)
