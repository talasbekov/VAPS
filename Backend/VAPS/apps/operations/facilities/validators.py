"""Manual validator for ``Post.requirements`` (donor DB-OPS-006 schema).

No jsonschema dependency in the project — the schema is small and closed
(additionalProperties: false), so it is enforced by hand. ``schema_version``
is required and pinned to 1; the donor's column default ``'{}'`` violates its
own schema — the service default is ``{"schema_version": 1}`` instead (Д3).

Beware ``isinstance(True, int) is True`` — bool is guarded explicitly on
every integer field.
"""

from apps.core.exceptions import DomainError

_ALLOWED_KEYS = {
    "schema_version",
    "min_height_cm",
    "gender",
    "min_rank_index",
    "max_rank_index",
    "required_position_codes",
    "allow_overqualification",
}


def _invalid(message, **extra):
    return DomainError(
        "VALIDATION_ERROR",
        400,
        detail={"fields": ["requirements"], **extra},
        message=message,
    )


def _check_int(value, key, minimum, maximum=None):
    if not isinstance(value, int) or isinstance(value, bool):
        raise _invalid(f"requirements.{key} должен быть целым числом.")
    if value < minimum or (maximum is not None and value > maximum):
        limits = f"≥{minimum}" if maximum is None else f"{minimum}..{maximum}"
        raise _invalid(f"requirements.{key} вне диапазона {limits}.")


def validate_requirements(value) -> dict:
    if not isinstance(value, dict):
        raise _invalid("requirements должен быть объектом (dict).")
    unknown = sorted(str(k) for k in set(value) - _ALLOWED_KEYS)
    if unknown:
        raise _invalid(
            "Неизвестные ключи requirements.", unknown_keys=unknown
        )
    schema_version = value.get("schema_version")
    if schema_version is None:
        raise _invalid("requirements.schema_version обязателен.")
    if not isinstance(schema_version, int) or isinstance(schema_version, bool):
        raise _invalid("requirements.schema_version должен быть целым числом.")
    if schema_version != 1:
        raise _invalid("Поддерживается только requirements.schema_version=1.")

    if (height := value.get("min_height_cm")) is not None:
        _check_int(height, "min_height_cm", 120, 230)

    if "gender" in value and value["gender"] is not None:
        if value["gender"] not in ("M", "F"):
            raise _invalid("requirements.gender ∈ {M, F, null}.")

    min_rank = value.get("min_rank_index")
    max_rank = value.get("max_rank_index")
    if min_rank is not None:
        _check_int(min_rank, "min_rank_index", 0)
    if max_rank is not None:
        _check_int(max_rank, "max_rank_index", 0)
    if min_rank is not None and max_rank is not None and min_rank > max_rank:
        raise _invalid("requirements: min_rank_index > max_rank_index.")

    if (codes := value.get("required_position_codes")) is not None:
        if not isinstance(codes, list):
            raise _invalid("requirements.required_position_codes — список строк.")
        if any(not isinstance(c, str) or not c.strip() for c in codes):
            raise _invalid(
                "requirements.required_position_codes — только непустые строки."
            )
        if len(set(codes)) != len(codes):
            raise _invalid(
                "requirements.required_position_codes — без дубликатов."
            )

    # Explicit null means "not set" — same contract as gender/min_height_cm
    # (a null/absent asymmetry between optional keys would be arbitrary).
    if (flag := value.get("allow_overqualification")) is not None:
        if not isinstance(flag, bool):
            raise _invalid("requirements.allow_overqualification — булево.")

    return value
