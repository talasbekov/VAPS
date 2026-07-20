"""Model/constraint tests for duty types (14.4, AC 1-2).

Red probes are transactional and assert the constraint NAME (a renamed
constraint silently downgrades the race backstop to a 500). Both sides of
every CHECK are probed — the 14.1 «обе границы» lesson.
"""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import DutyType, PostType
from apps.operations.facilities.services import create_facility

pytestmark = pytest.mark.django_db

ACTOR = "user-14"


@pytest.fixture
def facility():
    return create_facility(
        actor=ACTOR, code="OBJ-1", name="Резиденция", address="а"
    )


@pytest.fixture
def post_type():
    return PostType.objects.create(code="DT-FIXED", name="Стационарный")


def _duty_type(facility, **overrides):
    fields = {"facility": facility, "code": "DAY", "name": "Суточное"}
    fields.update(overrides)
    return DutyType.objects.create(**fields)


def test_defaults(facility):
    duty_type = _duty_type(facility)
    assert duty_type.description == ""
    assert duty_type.default_post_type is None
    assert duty_type.default_duration_minutes is None
    assert duty_type.rest_after_minutes == 1440
    assert duty_type.before_duty_minutes == 0
    assert duty_type.requires_reconnaissance is False
    assert duty_type.is_active is True


@pytest.mark.parametrize(
    ("field", "value", "constraint"),
    [
        ("code", "   ", "chk_duty_type_code_not_blank"),
        ("name", " \t ", "chk_duty_type_name_not_blank"),
        ("default_duration_minutes", 0, "chk_duty_type_duration_min"),
        ("default_duration_minutes", -5, "chk_duty_type_duration_min"),
        ("rest_after_minutes", -1, "chk_duty_type_rest_after_min"),
        ("before_duty_minutes", -1, "chk_duty_type_before_duty_min"),
    ],
)
def test_check_red_probes(facility, field, value, constraint):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _duty_type(facility, **{field: value})
    assert constraint in str(excinfo.value)


def test_check_green_boundaries(facility):
    # Обе границы: минимальные легальные значения проходят. rest_after=0 —
    # легальная конфигурация (Д6: вид без обязательного отдыха).
    duty_type = _duty_type(
        facility,
        default_duration_minutes=1,
        rest_after_minutes=0,
        before_duty_minutes=0,
    )
    assert duty_type.default_duration_minutes == 1
    assert duty_type.rest_after_minutes == 0


def test_duration_null_is_legal(facility):
    # NULL-ветка conditional-CHECK: duration необязателен.
    assert _duty_type(facility).default_duration_minutes is None


@pytest.mark.parametrize("dup", ["DAY", "day", "Day"])
def test_unique_code_per_facility_case_insensitive(facility, dup):
    _duty_type(facility)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _duty_type(facility, code=dup, name="Дубль")
    assert "uq_duty_type_facility_code" in str(excinfo.value)


def test_deactivated_row_frees_code(facility):
    # Partial-уник: soft-delete не скваттит идентификатор (канон 14.2).
    first = _duty_type(facility, is_active=False)
    fresh = _duty_type(facility)
    assert fresh.pk != first.pk


def test_same_code_on_other_facility_is_legal(facility):
    other = create_facility(
        actor=ACTOR, code="OBJ-2", name="Другой", address="б"
    )
    _duty_type(facility)
    assert _duty_type(other).facility_id == other.pk


def test_facility_cascade_deletes_duty_types(facility):
    _duty_type(facility)
    facility.delete()
    assert not DutyType.objects.exists()


def test_post_type_delete_sets_default_null(facility, post_type):
    # Д2: SET_NULL — подсказка, не контракт; вид дежурства живёт без неё.
    duty_type = _duty_type(facility, default_post_type=post_type)
    post_type.delete()
    duty_type.refresh_from_db()
    assert duty_type.default_post_type is None
    assert duty_type.is_active is True


def test_ordering_code_then_id(facility):
    # Поведенческая проба tie-breaker'а ВАКУУМНА (heap-порядок ties совпадает
    # с pk-порядком — ревью 14.4 доказало пробой ordering=["code"]), поэтому
    # состав ordering пинуется буквально (канон of=-пина).
    assert list(DutyType._meta.ordering) == ["code", "id"]
    b = _duty_type(facility, code="B", name="б")
    a2 = _duty_type(facility, code="A", name="а2")
    a1 = _duty_type(facility, code="A", name="а1", is_active=False)
    assert list(DutyType.objects.all()) == sorted(
        [b, a2, a1], key=lambda d: (d.code, d.pk)
    )
