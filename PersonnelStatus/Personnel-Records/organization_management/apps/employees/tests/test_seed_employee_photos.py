"""Аватарки: раздача по кругу, уменьшение, границы, повтор, снос (Plane №205).

Пробы стерегут:

1. КАЖДОМУ СВОЁ ФОТО и файлов хватает всем, хотя людей больше, чем снимков:
   раздача идёт по кругу, и «кончились файлы» не должно оставлять хвост людей
   без картинки.
2. УМЕНЬШЕНИЕ. Исходники — фотографии по полмегабайта; в списке они живут в
   квадрате около сотни пикселей. Проба смотрит на РАЗМЕР сохранённого файла и
   на его стороны, а не на факт «поле не пустое».
3. ПОВТОР НЕ ТРЁТ ЧУЖОЕ: заменённую руками фотографию сид не перезаписывает,
   пока не сказано `--force`.
4. ГРАНИЦА: старым сотрудникам стенда фотографии не ставятся.
"""
import io

import pytest
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.core.management.base import CommandError
from PIL import Image

from organization_management.apps.employees.models import Employee

pytestmark = pytest.mark.django_db

PREFIX = "SD"


@pytest.fixture
def photos(tmp_path):
    """Три снимка 1200×900 — заведомо больше аватарки и заведомо меньше числа людей."""
    for index in range(3):
        image = Image.new("RGB", (1200, 900), (index * 60, 120, 200))
        image.save(tmp_path / f"{index}.png")
    return tmp_path


@pytest.fixture
def people():
    call_command("seed_org_structure")
    call_command("seed_positions_ranks")
    call_command("seed_staffing")
    call_command("seed_employees")


def seeded():
    return Employee.objects.filter(personnel_number__startswith=PREFIX)


def test_everyone_gets_a_photo_even_when_files_run_out(photos, people):
    call_command("seed_employee_photos", "--source", str(photos))

    assert seeded().filter(photo="").count() == 0
    assert seeded().count() == 426, "людей меньше, чем слотов — раздавали не всем"


def test_photo_is_shrunk_to_an_avatar(photos, people):
    call_command("seed_employee_photos", "--source", str(photos))

    employee = seeded().order_by("personnel_number").first()
    with Image.open(io.BytesIO(employee.photo.read())) as saved:
        assert max(saved.size) <= 512, f"сохранено {saved.size}: это фотография, а не аватарка"
    assert employee.photo.size < 200 * 1024
    assert employee.personnel_number in employee.photo.name
    assert employee.photo.name.endswith(".jpg")


def test_second_run_keeps_a_hand_replaced_photo(photos, people):
    call_command("seed_employee_photos", "--source", str(photos))
    employee = seeded().order_by("personnel_number").first()
    before = employee.photo.name

    call_command("seed_employee_photos", "--source", str(photos))

    employee.refresh_from_db()
    assert employee.photo.name == before


def test_force_hands_them_out_again(photos, people):
    call_command("seed_employee_photos", "--source", str(photos))
    employee = seeded().order_by("personnel_number").first()
    before = employee.photo.name

    call_command("seed_employee_photos", "--source", str(photos), "--force")

    employee.refresh_from_db()
    assert employee.photo.name != before, "--force обязан выдать файл заново"
    assert not default_storage.exists(before), "прежний файл обязан быть снят, иначе media растёт слоями"


def test_alien_employees_are_left_without_photos(photos, people):
    alien = Employee.objects.create(
        personnel_number="100001", last_name="Абенов", first_name="Санжар"
    )

    call_command("seed_employee_photos", "--source", str(photos))

    alien.refresh_from_db()
    assert not alien.photo


def test_empty_source_is_reported(people, tmp_path):
    with pytest.raises(CommandError) as error:
        call_command("seed_employee_photos", "--source", str(tmp_path))

    assert "нет снимков" in str(error.value)


def test_wipe_removes_photos(photos, people):
    call_command("seed_employee_photos", "--source", str(photos))

    call_command("seed_employee_photos", "--wipe")

    assert seeded().exclude(photo="").count() == 0
