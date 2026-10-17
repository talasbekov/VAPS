"""Жизненный цикл должностей и званий (UC-REF-001, подпроект 2)."""
import pytest

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

POSITIONS = "/api/dictionaries/positions/"
RANKS = "/api/dictionaries/ranks/"


@pytest.fixture
def api():
    client, _ = client_for("staff-lifecycle", "STAFF_LIFECYCLE", ["dictionary.view", "dictionary_value.manage"])
    return client


def position(code="P1", **extra):
    return Position.objects.create(name=code, code=code, level=10, **extra)


def staff_unit_for(pos):
    """Одна штатная единица на должность.

    `StaffUnit` требует `index` (номер слота, без умолчания); `division`
    и `position` нулевые, но штатная единица без подразделения бессмысленна.
    Код и имя подразделения уникальны (`code` unique, имя уникально в
    пределах родителя), поэтому берутся от должности.
    """
    division = Division.objects.create(
        name=f"Проба {pos.code}", code=f"DIV-{pos.code}",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    return StaffUnit.objects.create(division=division, position=pos, index=1)


def test_rows_expose_lifecycle_fields_and_usage(api):
    pos = position("EXPOSED")
    staff_unit_for(pos)
    response = api.get(f"{POSITIONS}{pos.pk}/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["is_active"] is True
    assert body["inactive_since"] is None
    assert body["supersedes"] is None
    assert body["superseded_by"] is None
    assert body["usage"]["status"] == "TRACKED"
    assert body["usage"]["totalCount"] == 1
    assert body["usage"]["references"][0]["sourceLabel"] == "Штатное расписание"


def test_remove_deletes_unused_and_deactivates_used(api):
    unused = position("UNUSED")
    used = position("USED")
    staff_unit_for(used)
    assert api.delete(f"{POSITIONS}{unused.pk}/").status_code == 204
    assert not Position.objects.filter(pk=unused.pk).exists()
    response = api.delete(f"{POSITIONS}{used.pk}/")
    assert response.status_code == 200, response.content
    assert response.json()["result"] == "deactivated"
    used.refresh_from_db()
    assert used.is_active is False
    assert used.inactive_since == Clock.today_local()


def test_set_active_and_supersede(api, monkeypatch):
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))
    old = position("OLDPOS")
    off = api.post(f"{POSITIONS}{old.pk}/set-active/", {"is_active": False}, format="json")
    assert off.status_code == 200 and off.json()["inactive_since"] == Clock.today_local().isoformat()
    on = api.post(f"{POSITIONS}{old.pk}/set-active/", {"is_active": True}, format="json")
    assert on.status_code == 200 and on.json()["inactive_since"] is None

    replaced = api.post(
        f"{POSITIONS}{old.pk}/supersede/",
        {"name": "Старший инспектор", "name_kk": "Аға инспектор", "code": "NEWPOS", "level": 9},
        format="json",
    )
    assert replaced.status_code == 201, replaced.content
    body = replaced.json()
    assert body["supersedes"] == old.pk
    old.refresh_from_db()
    assert old.is_active is False and old.superseded_by.get().code == "NEWPOS"
    assert api.get(f"{POSITIONS}{old.pk}/").json()["superseded_by"] == body["id"]
    again = api.post(f"{POSITIONS}{old.pk}/set-active/", {"is_active": True}, format="json")
    assert again.status_code == 409 and again.json()["error_code"] == "DICTIONARY_ENTRY_SUPERSEDED"
    entities = {item["entity_type"] for item in recorded}
    assert audit_service.ENTITY_POSITION in entities
    assert audit_service.DICTIONARY_ENTRY_SUPERSEDED in {item["action"] for item in recorded}


def test_rank_lifecycle_mirrors_position(api):
    rank = Rank.objects.create(name="Капитан", code="CPT", level=5)
    replaced = api.post(f"{RANKS}{rank.pk}/supersede/", {"name": "Капитан (нов.)", "code": "CPT2", "level": 5}, format="json")
    assert replaced.status_code == 201, replaced.content
    rank.refresh_from_db()
    assert rank.is_active is False
    gone = api.delete(f"{RANKS}{rank.pk}/")
    assert gone.status_code == 409


def test_create_and_update_are_audited(api, monkeypatch):
    recorded = []
    monkeypatch.setattr(audit_service, "record", lambda **kwargs: recorded.append(kwargs))
    created = api.post(POSITIONS, {"name": "Аудит", "code": "AUD", "level": 50}, format="json")
    assert created.status_code == 201, created.content
    patched = api.patch(f"{POSITIONS}{created.json()['id']}/", {"name": "Аудит-2"}, format="json")
    assert patched.status_code == 200, patched.content
    actions = [item["action"] for item in recorded]
    assert audit_service.DICTIONARY_ENTRY_CREATED in actions
    assert audit_service.DICTIONARY_ENTRY_UPDATED in actions


def test_supersede_validates_successor_like_creation(api):
    taken = position("TAKEN")
    old = position("TOREPLACE")
    duplicate = api.post(f"{POSITIONS}{old.pk}/supersede/",
                         {"name": "Дубль", "code": taken.code, "level": 1}, format="json")
    assert duplicate.status_code == 400, duplicate.content
    assert "code" in duplicate.json()
    no_level = api.post(f"{POSITIONS}{old.pk}/supersede/",
                        {"name": "Без уровня", "code": "NOLEVEL"}, format="json")
    assert no_level.status_code == 400 and "level" in no_level.json()
    old.refresh_from_db()
    assert old.is_active is True


def test_staff_unit_payload_keeps_lean_position_without_usage(api):
    """Вложенная должность не тянет связи: `usage` стоит трёх запросов на
    строку, а штатное расписание сериализует сотни строк за раз."""
    unit = staff_unit_for(position("NESTED"))
    from organization_management.apps.staff_unit.serializers import StaffUnitSerializer
    # `to_representation` кладёт вложенную должность в ключ `position`.
    nested = StaffUnitSerializer(unit).data["position"]
    assert "usage" not in nested
    assert nested["is_active"] is True


def test_supersede_inherits_kazakh_caption_unless_cleared(api):
    """Неназванная казахская подпись наследуется, пустая — очищает (как в ОМ)."""
    old = position("KKOLD", name_kk="Ескі лауазым")
    heir = api.post(f"{POSITIONS}{old.pk}/supersede/",
                    {"name": "Новая", "code": "KKNEW", "level": 3}, format="json")
    assert heir.status_code == 201, heir.content
    assert heir.json()["name_kk"] == "Ескі лауазым"

    second = position("KKOLD2", name_kk="Тағы бір")
    cleared = api.post(f"{POSITIONS}{second.pk}/supersede/",
                       {"name": "Новая-2", "code": "KKNEW2", "level": 3, "name_kk": ""},
                       format="json")
    assert cleared.status_code == 201, cleared.content
    assert cleared.json()["name_kk"] == ""


def test_supersede_of_inactive_row_is_rejected(api):
    pos = position("FROZEN")
    assert api.post(f"{POSITIONS}{pos.pk}/set-active/", {"is_active": False},
                    format="json").status_code == 200
    refused = api.post(f"{POSITIONS}{pos.pk}/supersede/",
                       {"name": "Поздно", "code": "FROZEN2", "level": 1}, format="json")
    assert refused.status_code == 409, refused.content
    assert refused.json()["error_code"] == "DICTIONARY_ENTRY_INACTIVE"


def test_own_inactive_position_stays_valid_for_its_staff_unit(api):
    """Закрыт НОВЫЙ выбор, а не правка существующей записи (спец §6)."""
    pos = position("KEEPME")
    unit = staff_unit_for(pos)
    Position.objects.filter(pk=pos.pk).update(is_active=False, inactive_since=Clock.today_local())
    from organization_management.apps.staff_unit.serializers import StaffUnitSerializer

    payload = {"division": unit.division_id, "position": pos.pk, "index": unit.index}
    keeping = StaffUnitSerializer(instance=unit, data=payload)
    assert keeping.is_valid(), keeping.errors

    fresh = StaffUnitSerializer(data=payload)
    assert not fresh.is_valid()
    assert "position" in fresh.errors


def test_own_inactive_rank_stays_valid_for_its_employee(api):
    rank = Rank.objects.create(name="Прапорщик", code="WO", level=7)
    employee = Employee.objects.create(personnel_number="LC-1", last_name="Пробов",
                                       first_name="Пётр", rank=rank)
    Rank.objects.filter(pk=rank.pk).update(is_active=False)
    from organization_management.apps.employees.api.serializers import EmployeeSerializer

    assert EmployeeSerializer(instance=employee).fields["rank"].queryset.filter(pk=rank.pk).exists()
    assert not EmployeeSerializer().fields["rank"].queryset.filter(pk=rank.pk).exists()


def test_successor_is_read_from_prefetch(api, django_assert_num_queries):
    """`superseded_by` в списке не стоит запроса на строку."""
    old = position("PREOLD")
    assert api.post(f"{POSITIONS}{old.pk}/supersede/",
                    {"name": "Преемник", "code": "PRENEW", "level": 2},
                    format="json").status_code == 201
    from organization_management.apps.dictionaries.api.serializers import PositionSerializer
    from organization_management.apps.dictionaries.api.views import PositionViewSet

    assert PositionViewSet.queryset._prefetch_related_lookups == ("superseded_by",)
    rows = list(PositionViewSet.queryset.all())
    serializer = PositionSerializer()
    with django_assert_num_queries(0):
        found = [serializer.get_superseded_by(row) for row in rows]
    assert any(value is not None for value in found)


def test_inactive_position_is_not_selectable_for_new_staff_unit(api):
    inactive = position("INACTIVE", is_active=False)
    from organization_management.apps.staff_unit.serializers import StaffUnitSerializer
    assert not StaffUnitSerializer().fields["position"].queryset.filter(pk=inactive.pk).exists()


def test_inactive_rank_is_not_selectable_for_employee(api):
    inactive = Rank.objects.create(name="Отставной", code="RETIRED", level=99, is_active=False)
    from organization_management.apps.employees.api.serializers import EmployeeSerializer
    assert not EmployeeSerializer().fields["rank"].queryset.filter(pk=inactive.pk).exists()


def test_mutations_require_value_permission():
    api, _ = client_for("staff-manage-only", "STAFF_MANAGE_ONLY", ["dictionary.view", "dictionary.manage"])
    pos = position("NOPERM")
    assert api.post(f"{POSITIONS}{pos.pk}/set-active/", {"is_active": False}, format="json").status_code == 403
    assert api.post(f"{POSITIONS}{pos.pk}/supersede/", {"name": "x", "code": "NOPERM2", "level": 1}, format="json").status_code == 403
