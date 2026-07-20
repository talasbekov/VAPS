"""Unit tests for the DB-OPS-006 requirements validator (14.2, AC-4).

Pure-Python validation (no jsonschema dependency): every schema field gets a
negative probe plus the positive case; additionalProperties are banned;
bool-vs-int coercion (isinstance(True, int)) is guarded explicitly.
"""

import pytest

from apps.core.exceptions import DomainError
from apps.operations.facilities.validators import validate_requirements


def _valid(**overrides):
    value = {"schema_version": 1}
    value.update(overrides)
    return value


def _expect_invalid(value):
    with pytest.raises(DomainError) as excinfo:
        validate_requirements(value)
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.http_status == 400
    return excinfo.value


def test_minimal_valid_passes():
    assert validate_requirements({"schema_version": 1}) == {"schema_version": 1}


def test_full_valid_passes():
    value = _valid(
        min_height_cm=175,
        gender="M",
        min_rank_index=2,
        max_rank_index=5,
        required_position_codes=["SNIPER", "DRIVER"],
        allow_overqualification=True,
    )
    assert validate_requirements(value) == value


@pytest.mark.parametrize("value", [None, [], "x", 1])
def test_non_dict_rejected(value):
    _expect_invalid(value)


def test_empty_dict_rejected_schema_version_required():
    # The donor's DEFAULT '{}' violates its own schema (required
    # schema_version) — the service closes that hole (Д3).
    _expect_invalid({})


@pytest.mark.parametrize("version", [0, 2, "1", None, True])
def test_bad_schema_version_rejected(version):
    _expect_invalid({"schema_version": version})


def test_unknown_key_rejected():
    err = _expect_invalid(_valid(min_weight_kg=80))
    assert "min_weight_kg" in str(err.detail)


@pytest.mark.parametrize("height", [119, 231, "175", 175.5, True])
def test_bad_min_height_rejected(height):
    _expect_invalid(_valid(min_height_cm=height))


@pytest.mark.parametrize("height", [120, 230, None])
def test_boundary_min_height_accepted(height):
    validate_requirements(_valid(min_height_cm=height))


@pytest.mark.parametrize("gender", ["", "m", "X", 1])
def test_bad_gender_rejected(gender):
    # "" is NOT null — the enum is exactly {M, F, null}.
    _expect_invalid(_valid(gender=gender))


@pytest.mark.parametrize("gender", ["M", "F", None])
def test_gender_enum_accepted(gender):
    validate_requirements(_valid(gender=gender))


@pytest.mark.parametrize("idx", [-1, "2", 2.5, True])
def test_bad_rank_index_rejected(idx):
    _expect_invalid(_valid(min_rank_index=idx))
    _expect_invalid(_valid(max_rank_index=idx))


def test_rank_window_min_gt_max_rejected():
    _expect_invalid(_valid(min_rank_index=5, max_rank_index=2))


def test_rank_window_equal_accepted():
    validate_requirements(_valid(min_rank_index=3, max_rank_index=3))


@pytest.mark.parametrize(
    "codes", ["SNIPER", [1], [""], ["A", "A"], [None]]
)
def test_bad_position_codes_rejected(codes):
    _expect_invalid(_valid(required_position_codes=codes))


def test_position_codes_unique_list_accepted():
    validate_requirements(_valid(required_position_codes=[]))
    validate_requirements(_valid(required_position_codes=["A", "B"]))


@pytest.mark.parametrize("flag", ["yes", 1])
def test_bad_overqualification_rejected(flag):
    _expect_invalid(_valid(allow_overqualification=flag))


def test_null_overqualification_means_not_set():
    # Same null contract as gender/min_height_cm — no arbitrary asymmetry
    # between optional keys.
    validate_requirements(_valid(allow_overqualification=None))
