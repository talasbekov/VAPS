"""Validated personnel facts. Unknown values stay unknown; no derived assessments."""
from math import isfinite
import re

INVENTORY_CATEGORIES = frozenset(("weapon", "magazine", "grenade", "other"))
SKILLS = ("shooting", "hand_to_hand", "physical_fitness")
HEALTH_FIELDS = ("condition", "chronic_conditions", "restrictions")
PROFILE_FIELDS = frozenset(("inventory", "skills", "health", "height_cm", "weight_kg"))
MAX_SAFE_INTEGER = 9007199254740991
UNSAFE_TEXT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _object(value, allowed, field):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f"{field}: некорректный состав полей.")
    return value


def _text(value, field, *, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > 2000 or UNSAFE_TEXT.search(value) or (required and not value.strip()):
        raise ValueError(f"{field}: укажите текст до 2000 символов.")
    return value


def normalize_profile(value):
    """Strict JSON numbers, additive nullable fields, no coercion or fake defaults."""
    data = _object(value, PROFILE_FIELDS, "profile")
    inventory = data.get("inventory")
    if inventory is not None:
        if not isinstance(inventory, list) or len(inventory) > 100:
            raise ValueError("inventory: допустимо не более 100 позиций.")
        inventory = list(inventory)
        for index, item in enumerate(inventory):
            _object(item, ("category", "name", "quantity"), f"inventory.{index}")
            if not isinstance(item.get("category"), str) or item["category"] not in INVENTORY_CATEGORIES:
                raise ValueError(f"inventory.{index}.category: неизвестная категория.")
            _text(item.get("name"), f"inventory.{index}.name", required=True)
            quantity = item.get("quantity")
            if type(quantity) is not int or not 0 <= quantity <= MAX_SAFE_INTEGER:
                raise ValueError(f"inventory.{index}.quantity: укажите целое число от 0.")
            inventory[index] = dict(item)
    skills = _object(data.get("skills") or {}, SKILLS, "skills")
    # False, [], and empty strings must not be interpreted as an unknown object.
    if data.get("skills") is not None and not isinstance(data["skills"], dict):
        raise ValueError("skills: ожидается объект.")
    for key in SKILLS:
        score = skills.get(key)
        if score is not None and (type(score) is not int or not 1 <= score <= 5):
            raise ValueError(f"skills.{key}: укажите целое число от 1 до 5 или null.")
    health = _object(data.get("health") or {}, HEALTH_FIELDS, "health")
    if data.get("health") is not None and not isinstance(data["health"], dict):
        raise ValueError("health: ожидается объект.")
    result = {
        "inventory": inventory,
        "skills": {key: skills.get(key) for key in SKILLS},
        "health": {key: _text(health.get(key), f"health.{key}") for key in HEALTH_FIELDS},
    }
    for key in ("height_cm", "weight_kg"):
        number = data.get(key)
        if number is not None:
            try:
                valid = type(number) in (int, float) and isfinite(number) and number > 0
            except OverflowError:
                valid = False
            if not valid:
                raise ValueError(f"{key}: укажите положительное число или null.")
        result[key] = number
    return result


def profile_payload(profile=None):
    if profile is None:
        return {**normalize_profile({}), "updated_at": None}
    return {**normalize_profile(profile.data), "updated_at": profile.updated_at.isoformat()}
