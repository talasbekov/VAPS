from io import StringIO
from pathlib import Path

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from PIL import Image

from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_roster_xlsx import (
    sample,
    workbook,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def photo_roster(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path / "media"
    folder = tmp_path / "photos"
    folder.mkdir()
    Image.new("RGB", (30, 40), "red").save(folder / "000000000042.jpg")
    return workbook(tmp_path, [sample()]), folder, settings.MEDIA_ROOT


def run(path, folder, **options):
    out = StringIO()
    call_command(
        "import_staffing_xlsx", str(path), photos_dir=str(folder), stdout=out, **options
    )
    return out.getvalue()


def test_preview_and_file_check_do_not_write_photos(
    photo_roster, django_assert_num_queries
):
    path, folder, media = photo_roster
    with django_assert_num_queries(0):
        run(path, folder, check_file=True)
    run(path, folder)
    assert not Employee.objects.exists()
    assert not media.exists()


def test_photo_is_linked_by_iin_and_repeat_does_not_create_files(photo_roster):
    path, folder, media = photo_roster
    run(path, folder, apply=True)
    e = Employee.objects.get(external_id="42")
    before = (e.pk, e.photo.name, e.updated_at, sorted(media.rglob("*")))
    assert e.photo.read() == (folder / "000000000042.jpg").read_bytes()
    assert "000000000042" not in e.photo.name
    run(path, folder, apply=True)
    e.refresh_from_db()
    assert (e.pk, e.photo.name, e.updated_at, sorted(media.rglob("*"))) == before
    assert StaffUnit.objects.get(external_id="100").employee_id == e.pk


def test_new_photo_replaces_link_and_preserves_old_file(photo_roster):
    path, folder, _media = photo_roster
    run(path, folder, apply=True)
    e = Employee.objects.get(external_id="42")
    old = Path(e.photo.path)
    old_bytes = old.read_bytes()
    Image.new("RGB", (20, 20), "blue").save(folder / "000000000042.jpg")
    run(path, folder, apply=True)
    e.refresh_from_db()
    assert Path(e.photo.path) != old
    assert old.read_bytes() == old_bytes
    assert e.photo.read() == (folder / "000000000042.jpg").read_bytes()
    assert Employee.objects.count() == 1


def test_missing_photo_preserves_current_photo(photo_roster):
    path, folder, _media = photo_roster
    run(path, folder, apply=True)
    name = Employee.objects.get(external_id="42").photo.name
    (folder / "000000000042.jpg").unlink()
    run(path, folder, apply=True)
    assert Employee.objects.get(external_id="42").photo.name == name


@pytest.mark.parametrize("bad", ["duplicate", "corrupt", "symlink", "wrong_format"])
def test_invalid_matching_photo_rejects_all_writes(photo_roster, bad):
    path, folder, media = photo_roster
    photo = folder / "000000000042.jpg"
    if bad == "duplicate":
        Image.new("RGB", (10, 10)).save(folder / "000000000042.PNG")
    elif bad == "symlink":
        outside = folder.parent / "outside.jpg"
        photo.rename(outside)
        photo.symlink_to(outside)
    elif bad == "wrong_format":
        Image.new("RGB", (10, 10)).save(photo, format="GIF")
    else:
        photo.write_bytes(b"not an image")
    with pytest.raises(CommandError, match="[Фф]ото"):
        run(path, folder, apply=True)
    assert not Employee.objects.exists()
    assert not media.exists()


def test_unlisted_photo_is_not_attached(photo_roster):
    path, folder, _media = photo_roster
    extra = Employee.objects.create(personnel_number="not-listed", iin="000000000043")
    Image.new("RGB", (20, 20)).save(folder / "000000000043.jpg")
    run(path, folder, apply=True)
    extra.refresh_from_db()
    assert not extra.photo


def test_short_iin_is_not_padded_for_photo_lookup(photo_roster):
    path, folder, media = photo_roster
    path = workbook(path.parent, [sample(iin="42")])
    run(path, folder, apply=True, skip_invalid_iin=True)
    assert not Employee.objects.get(external_id="42").photo
    assert not media.exists()


def test_database_failure_rolls_back_photo_and_employee(photo_roster, monkeypatch):
    path, folder, media = photo_roster

    def fail(*args, **kwargs):
        raise ValidationError("synthetic failure after employee")

    monkeypatch.setattr(StaffUnit, "full_clean", fail)
    with pytest.raises(CommandError):
        run(path, folder, apply=True)
    assert not Employee.objects.exists()
    assert not [p for p in media.rglob("*") if p.is_file()]


def test_storage_failure_cleans_previous_new_photo(photo_roster, monkeypatch):
    path, folder, media = photo_roster
    path = workbook(path.parent, [sample(), sample("43", "101", "000000000043")])
    Image.new("RGB", (20, 20)).save(folder / "000000000043.png")
    storage = Employee._meta.get_field("photo").storage
    original = storage.save
    calls = 0

    def fail_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("synthetic media failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(storage, "save", fail_second)
    with pytest.raises(CommandError):
        run(path, folder, apply=True)
    assert not Employee.objects.exists()
    assert not [p for p in media.rglob("*") if p.is_file()]


def test_changed_source_after_plan_cancels_import(photo_roster, monkeypatch):
    from organization_management.apps.staff_unit import roster_import

    path, folder, media = photo_roster
    original = roster_import.prepare_import

    def prepare_then_change(*args, **kwargs):
        plan = original(*args, **kwargs)
        Image.new("RGB", (15, 15), "green").save(folder / "000000000042.jpg")
        return plan

    monkeypatch.setattr(roster_import, "prepare_import", prepare_then_change)
    with pytest.raises(CommandError):
        run(path, folder, apply=True)
    assert not Employee.objects.exists()
    assert not [p for p in media.rglob("*") if p.is_file()]


def test_partial_storage_write_does_not_leave_orphan(photo_roster, monkeypatch):
    path, folder, media = photo_roster
    storage = Employee._meta.get_field("photo").storage

    def write_then_fail(name, content, **kwargs):
        target = Path(storage.path(name))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.read(12))
        raise OSError("synthetic disk full after creation")

    monkeypatch.setattr(storage, "save", write_then_fail)
    with pytest.raises(CommandError):
        run(path, folder, apply=True)
    assert not Employee.objects.exists()
    assert not [p for p in media.rglob("*") if p.is_file()]
