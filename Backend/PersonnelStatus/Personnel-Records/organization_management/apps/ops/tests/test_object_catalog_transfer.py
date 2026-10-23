"""Portable catalog transfer: no personnel, safe retries and explicit identities."""
import copy
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_object import (
    OpsObjectSector, OpsSecurityObject, OpsSecurityPost,
)
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import passport

pytestmark = pytest.mark.django_db
SCRIPT = Path(__file__).resolve().parents[4] / "tools" / "object_catalog_transfer.py"


@pytest.fixture
def transfer():
    assert SCRIPT.is_file(), "Portable object catalog transfer CLI is missing"
    spec = importlib.util.spec_from_file_location("object_catalog_transfer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def actor():
    return client_for(
        "catalog-transfer-test", "CATALOG_TRANSFER_TEST",
        perms=("object.view", "object.manage"),
    )[1]


@pytest.fixture
def department():
    return Division.objects.create(
        name="SYNTHETIC Department 6", code="TEST-TRANSFER-DEPT",
        division_type=Division.DivisionType.DEPARTMENT,
    )


def make_object(name="SYNTHETIC Site", code="TEST-SOURCE"):
    obj = OpsSecurityObject.objects.create(
        name=name, code=code, object_type="SYNTHETIC Type", region="TEST",
        address="SYNTHETIC Address", ownership="GUARDED",
        object_state="ACTIVE", passport_state="RED",
    )
    sector = OpsObjectSector.objects.create(
        security_object=obj, name="SYNTHETIC Sector", position=1,
    )
    for position in (1, 2):
        OpsSecurityPost.objects.create(
            sector=sector, name=f"SYNTHETIC Post {position}",
            task="SYNTHETIC Task", requirements="", position=position,
        )
    return obj


def bundle_from_source(transfer, actor):
    obj = make_object()
    result = transfer.export_bundle(
        str(obj.pk), actor_id=str(actor.pk), source_namespace=str(uuid4()),
        export_id=str(uuid4()),
    )
    obj.delete()
    return result


def run_import(transfer, bundle, actor, department, **kwargs):
    return transfer.import_bundle(
        bundle, actor_id=str(actor.pk), department_id=str(department.pk),
        expected_department_name=department.name, **kwargs,
    )


def counts():
    return tuple(model.objects.count() for model in (
        OpsSecurityObject, OpsObjectSector, OpsSecurityPost, OpsAuditLog,
    ))


def test_export_contains_only_current_catalog_and_content_digest(transfer, actor):
    obj = make_object()
    bundle = transfer.export_bundle(
        str(obj.pk), actor_id=str(actor.pk), source_namespace=str(uuid4()),
        export_id=str(uuid4()),
    )
    assert bundle["format"] == "smart-object-transfer/v1"
    assert bundle["source"]["objectId"] == str(obj.pk)
    assert len(bundle["sectors"][0]["posts"]) == 2
    assert set(bundle) == {
        "format", "exportId", "source", "object", "sectors", "bundleSha256",
    }
    assert set(bundle["object"]) == {
        "name", "objectType", "region", "address", "ownership", "objectState",
    }
    assert not {"employees", "passportVersions", "photoUrl", "updatedAt"} & bundle.keys()
    assert transfer.validate_bundle(bundle) == bundle


def test_default_dry_run_changes_nothing_including_audit(transfer, actor, department):
    bundle = bundle_from_source(transfer, actor)
    before = counts()
    receipt = run_import(transfer, bundle, actor, department)
    assert counts() == before
    assert receipt["applied"] is False
    assert receipt["target"]["objectId"] is None
    assert receipt["target"]["departmentId"] == str(department.pk)
    assert len(receipt["posts"]) == 2
    assert all(post["id"] is None for post in receipt["posts"].values())


def test_apply_then_retry_recovers_mapping_and_preserves_normal_ui_edits(
    transfer, actor, department,
):
    bundle = bundle_from_source(transfer, actor)
    first = run_import(transfer, bundle, actor, department, apply=True)
    target = OpsSecurityObject.objects.get(pk=first["target"]["objectId"])
    assert str(target.pk) != bundle["source"]["objectId"]
    assert set(first["posts"]) == {
        post["id"] for sector in bundle["sectors"] for post in sector["posts"]
    }
    assert set(entry["id"] for entry in first["posts"].values()).isdisjoint(first["posts"])
    edited = passport.snapshot_sectors(target)
    edited[0]["posts"][0]["name"] = "SYNTHETIC Manual correction"
    passport.update_passport(target, edited)
    before = counts()
    second = run_import(transfer, bundle, actor, department, apply=True)
    assert second["reused"] is True
    assert second["posts"] == first["posts"]
    assert second["target"] == first["target"]
    assert counts() == before
    assert OpsSecurityPost.objects.filter(name="SYNTHETIC Manual correction").exists()
    log = OpsAuditLog.objects.get(action="SECURITY_OBJECT_CATALOG_IMPORTED")
    assert log.new_value["receipt"]["posts"] == first["posts"]
    assert "SYNTHETIC Task" not in json.dumps(log.new_value)


def test_lost_mapped_post_is_conflict_not_recreated(transfer, actor, department):
    bundle = bundle_from_source(transfer, actor)
    receipt = run_import(transfer, bundle, actor, department, apply=True)
    OpsSecurityPost.objects.filter(pk=next(iter(receipt["posts"].values()))["id"]).delete()
    before = counts()
    with pytest.raises(transfer.TransferError, match="MAPPING_DAMAGED"):
        run_import(transfer, bundle, actor, department, apply=True)
    assert counts() == before


@pytest.mark.parametrize("change", ["digest", "duplicate", "unknown"])
def test_invalid_package_fails_before_writes(transfer, actor, department, change):
    bundle = bundle_from_source(transfer, actor)
    if change == "digest":
        bundle["object"]["name"] = "SYNTHETIC Tampering"
    elif change == "duplicate":
        bundle["sectors"][0]["posts"][1]["id"] = bundle["sectors"][0]["posts"][0]["id"]
        bundle["bundleSha256"] = transfer.bundle_digest(bundle)
    else:
        bundle["employees"] = []
        bundle["bundleSha256"] = transfer.bundle_digest(bundle)
    before = counts()
    with pytest.raises(transfer.TransferError):
        run_import(transfer, bundle, actor, department, apply=True)
    assert counts() == before


def test_department_identity_and_type_are_verified(transfer, actor, department):
    bundle = bundle_from_source(transfer, actor)
    before = counts()
    with pytest.raises(transfer.TransferError, match="DEPARTMENT_MISMATCH"):
        transfer.import_bundle(
            bundle, actor_id=str(actor.pk), department_id=str(department.pk),
            expected_department_name="SYNTHETIC Different department", apply=True,
        )
    department.division_type = Division.DivisionType.DIRECTORATE
    department.save()
    with pytest.raises(transfer.TransferError, match="DEPARTMENT_MISMATCH"):
        run_import(transfer, bundle, actor, department, apply=True)
    assert counts() == before


@pytest.mark.parametrize("scope", ["reader", "department-only", "inactive"])
def test_import_requires_active_actor_and_global_catalog_manage(
    transfer, actor, department, scope,
):
    bundle = bundle_from_source(transfer, actor)
    _, limited = client_for(
        "catalog-limited", "CATALOG_LIMITED",
        perms=("object.view",) if scope == "reader" else ("object.manage", "object.view"),
        scope_division_id=department.pk if scope == "department-only" else None,
    )
    if scope == "inactive":
        limited.is_active = False
        limited.save()
    before = counts()
    with pytest.raises(transfer.TransferError, match="ACCESS_DENIED"):
        run_import(transfer, bundle, limited, department, apply=True)
    assert counts() == before


def test_name_collision_does_not_guess_target(transfer, actor, department):
    bundle = bundle_from_source(transfer, actor)
    make_object(code="TEST-TARGET")
    before = counts()
    with pytest.raises(transfer.TransferError, match="OBJECT_COLLISION"):
        run_import(transfer, bundle, actor, department, apply=True)
    assert counts() == before


def test_explicit_mapping_preserves_unrelated_rows_and_adds_only_missing(
    transfer, actor, department,
):
    bundle = bundle_from_source(transfer, actor)
    target = make_object(code="TEST-TARGET")
    sector = target.sectors.get()
    first, second = list(sector.posts.all())
    second.delete()
    unrelated = OpsObjectSector.objects.create(
        security_object=target, name="SYNTHETIC Existing unrelated", position=9,
    )
    source_sector = bundle["sectors"][0]
    mapping = {
        "sectors": {source_sector["id"]: {"id": str(sector.pk)}},
        "posts": {
            source_sector["posts"][0]["id"]: {"id": str(first.pk)},
            source_sector["posts"][1]["id"]: {"id": None},
        },
    }
    receipt = run_import(
        transfer, bundle, actor, department, apply=True,
        target_object_id=str(target.pk), mapping=mapping,
    )
    assert receipt["posts"][source_sector["posts"][0]["id"]]["id"] == str(first.pk)
    assert OpsObjectSector.objects.filter(pk=unrelated.pk).exists()
    assert target.sectors.count() == 2
    assert sector.posts.count() == 2
    repeated = run_import(
        transfer, bundle, actor, department, apply=True,
        target_object_id=str(target.pk), mapping=mapping,
    )
    assert repeated["reused"] is True
    assert repeated["posts"] == receipt["posts"]


def test_mapping_cannot_claim_foreign_or_conflicting_post(transfer, actor, department):
    bundle = bundle_from_source(transfer, actor)
    target = make_object(code="TEST-TARGET")
    foreign = make_object(name="SYNTHETIC Foreign", code="TEST-FOREIGN")
    source_sector = bundle["sectors"][0]
    mapping = {
        "sectors": {source_sector["id"]: {"id": str(target.sectors.get().pk)}},
        "posts": {
            post["id"]: {"id": str(foreign.sectors.get().posts.all()[index].pk)}
            for index, post in enumerate(source_sector["posts"])
        },
    }
    before = counts()
    with pytest.raises(transfer.TransferError, match="MAPPING_CONFLICT"):
        run_import(
            transfer, bundle, actor, department, apply=True,
            target_object_id=str(target.pk), mapping=mapping,
        )
    assert counts() == before


def test_changed_export_cannot_overwrite_previously_imported_source(
    transfer, actor, department,
):
    bundle = bundle_from_source(transfer, actor)
    run_import(transfer, bundle, actor, department, apply=True)
    other = copy.deepcopy(bundle)
    other["exportId"] = str(uuid4())
    other["bundleSha256"] = transfer.bundle_digest(other)
    before = counts()
    with pytest.raises(transfer.TransferError, match="SOURCE_ALREADY_IMPORTED"):
        run_import(transfer, other, actor, department, apply=True)
    assert counts() == before


def test_audit_failure_rolls_back_all_catalog_insertions(transfer, actor, department, monkeypatch):
    bundle = bundle_from_source(transfer, actor)
    before = counts()

    def unavailable_audit(**kwargs):
        raise RuntimeError("SYNTHETIC audit unavailable")

    monkeypatch.setattr(OpsAuditLog.objects, "create", unavailable_audit)
    with pytest.raises(RuntimeError, match="SYNTHETIC audit unavailable"):
        run_import(transfer, bundle, actor, department, apply=True)
    assert counts() == before


def test_cli_default_writes_only_dry_run_receipt(
    transfer, actor, department, tmp_path, capsys,
):
    bundle = bundle_from_source(transfer, actor)
    source = tmp_path / "catalog.json"
    output = tmp_path / "receipt.json"
    source.write_text(json.dumps(bundle), encoding="utf-8")
    before = counts()
    assert transfer.main([
        "import", "--input", str(source), "--actor-id", str(actor.pk),
        "--target-department-id", str(department.pk),
        "--expected-department-name", department.name, "--receipt", str(output),
    ]) == 0
    assert counts() == before
    assert json.loads(output.read_text(encoding="utf-8"))["applied"] is False
    printed = capsys.readouterr().out
    assert "SYNTHETIC" not in printed
    assert json.loads(printed)["applied"] is False
