"""Кадровая подпись строки доезжает до списка своего подразделения.

Прототип печатает в строке таблицы «звание · ИИН» под именем и отдельной
колонкой «Дата найма». Всё это лежит в модели `Employee` с самого начала и
просто не клалось в ответ `_directorate_get`: фронт рисовал под именем
захардкоженную пустую строку, а колонку с датой найма пришлось снять — в неё
ехало начало ТЕКУЩЕГО СТАТУСА, отчего у всех строк стояла одна дата.

🔴 Фикстура обязана РАЗВОДИТЬ поля. Если у всех сотрудников совпадут звание,
дата найма и ИИН, ассерт «поле доехало» не отличит правильное поле от
соседнего: проба зазеленеет и на `hire_date`, и на `birth_date`. Поэтому здесь
три сотрудника с попарно разными значениями плюс один вовсе без звания и без
ИИН — на нём проверяется, что «не указано» доезжает как `None`, а не как
выдумка.

ИИН наружу уходит только хвостом. Полное значение не должно встречаться нигде
в теле ответа — ассерт идёт по ВСЕМУ JSON, а не по знакомому ключу: маска,
поставленная в одном месте и забытая в соседнем, иначе проходит незамеченной.
"""
import json
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit


@pytest.fixture
def actor(db):
    return get_user_model().objects.create_superuser(username="personnel-admin")


@pytest.fixture
def scene(db):
    root = Division.objects.create(
        name="Департамент", code="pf-root",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    division = Division.objects.create(
        name="Отдел", code="pf-div",
        division_type=Division.DivisionType.DIVISION, parent=root,
    )
    major = Rank.objects.create(name="майор", code="pf-major", level=5)
    captain = Rank.objects.create(name="капитан", code="pf-captain", level=4)

    def person(index, last_name, rank, iin, hired, born, number):
        employee = Employee.objects.create(
            personnel_number=number,
            last_name=last_name,
            first_name="Имя",
            rank=rank,
            iin=iin,
            hire_date=hired,
            birth_date=born,
        )
        StaffUnit.objects.create(division=division, index=index, employee=employee)
        return employee

    return {
        "division": division,
        # Дата найма, дата рождения и хвост ИИН у всех троих РАЗНЫЕ — иначе
        # перепутанные местами поля дали бы тот же ответ.
        "major": person(
            1, "Майоров", major, "900000000123",
            date(2015, 3, 4), date(1985, 7, 19), "pf-1",
        ),
        "captain": person(
            2, "Капитанов", captain, "900000000456",
            date(2019, 11, 25), date(1990, 2, 3), "pf-2",
        ),
        # Ни звания, ни ИИН: «не указано» — законное состояние данных.
        "bare": person(
            3, "Безранга", None, None,
            date(2023, 6, 1), date(1996, 12, 30), "pf-3",
        ),
    }


def _get(actor):
    client = APIClient()
    client.force_authenticate(user=actor)
    return client.get(reverse("staffunit-directorate-management"))


def _row(payload, employee):
    for unit in payload["staff_units"]:
        row = unit.get("employee")
        if row is not None and row["id"] == employee.id:
            return row
    raise AssertionError(f"сотрудника {employee.id} нет в ответе — проба вакуумна")


@pytest.mark.django_db
def test_rank_hire_date_and_masked_iin_reach_the_list(actor, scene):
    response = _get(actor)
    assert response.status_code == 200, response.data

    major = _row(response.data, scene["major"])
    captain = _row(response.data, scene["captain"])

    assert major["rank"] == "майор"
    assert captain["rank"] == "капитан"

    assert str(major["hire_date"]) == "2015-03-04"
    assert str(captain["hire_date"]) == "2019-11-25"

    # Гвард против «поле доехало, но не то»: дата найма и дата рождения у
    # одного и того же человека обязаны различаться.
    assert str(major["birth_date"]) == "1985-07-19"
    assert major["hire_date"] != major["birth_date"]

    assert major["personnel_number"] == "pf-1"
    assert captain["personnel_number"] == "pf-2"

    assert major["iin_masked"] == "•••••• 0123"
    assert captain["iin_masked"] == "•••••• 0456"


@pytest.mark.django_db
def test_missing_rank_and_iin_are_reported_as_absent(actor, scene):
    bare = _row(_get(actor).data, scene["bare"])

    assert bare["rank"] is None, "сотруднику без звания выдумали звание"
    assert bare["iin_masked"] is None, "сотруднику без ИИН выдумали хвост"
    # Дата найма у него есть — иначе проба выше не отличила бы «поля нет» от
    # «поле пустое у всех».
    assert str(bare["hire_date"]) == "2023-06-01"


@pytest.mark.django_db
def test_full_iin_never_leaves_the_list(actor, scene):
    """Полного ИИН нет НИГДЕ в ответе — ассерт по всему телу, не по ключу."""
    body = json.dumps(_get(actor).data, default=str, ensure_ascii=False)

    for employee in (scene["major"], scene["captain"]):
        assert employee.iin not in body, (
            f"полный ИИН {employee.iin} уехал в список"
        )

    # Обратная сторона: хвост в теле ЕСТЬ, иначе ассерт выше зеленеет и на
    # выдаче, где ИИН не упоминается вовсе.
    assert "•••••• 0123" in body, "маскированный ИИН пропал — проба вакуумна"


@pytest.mark.django_db
def test_photo_url_reaches_the_list_and_absence_is_told_as_null(actor, scene):
    """Адрес аватарки доезжает до списка, а её отсутствие — как `null`.

    🔴 Обе половины важны. Клиент, получивший путь вместо адреса, склеил бы
    его с префиксом «по соглашению» — и получил бы 404 в каждой строке при
    первой же смене хранилища. Клиент, не отличивший «фото нет» от «фото
    есть», нарисовал бы битую картинку вместо заглушки.
    """
    import io

    from django.core.files.base import ContentFile
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), (1, 2, 3)).save(buffer, format="JPEG")
    scene["major"].photo.save("pf-1.jpg", ContentFile(buffer.getvalue()), save=True)

    payload = _get(actor).data
    with_photo = _row(payload, scene["major"])
    without_photo = _row(payload, scene["bare"])

    assert with_photo["photo_url"] == scene["major"].photo.url
    assert with_photo["photo_url"].startswith("/media/"), with_photo["photo_url"]
    assert without_photo["photo_url"] is None
