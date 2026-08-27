"""Архивные справочники: спрятаны везде и никем не читаются (Plane №200).

Архивирование — это обещание из двух половин, и проверять надо обе:

1. СПРЯТАНЫ. Ни в Django Admin, ни в API архивного справочника нет; живые
   (`Position`, `Rank`) на месте — иначе «спрятали всё» прошло бы за успех.
2. НИКЕМ НЕ ЧИТАЮТСЯ. Право архивировать держится ровно на том, что на модель
   никто не ссылается. Появившийся завтра внешний ключ означает, что решение
   устарело, — и проба обязана сказать это, а не молчать.

Отдельно стережётся сам список: имя, которого нет среди моделей приложения
(опечатка, переименование), сделало бы архивирование бесшумно недействующим —
модель показывалась бы дальше, а список выглядел бы заполненным.
"""
import pytest
from django.apps import apps
from django.contrib import admin

from organization_management.apps.dictionaries.archived import (
    ARCHIVED_DICTIONARIES,
    LIVE_DICTIONARIES,
)


def dictionaries_models():
    return {model.__name__: model for model in apps.get_app_config("dictionaries").get_models()}


def test_every_archived_name_is_a_real_model():
    unknown = sorted(set(ARCHIVED_DICTIONARIES) - set(dictionaries_models()))
    assert unknown == [], f"в списке архивных есть несуществующие модели: {unknown}"


def test_the_list_covers_the_whole_app():
    """Каждый справочник либо живой, либо архивный — третьего не дано.

    Новая модель, не попавшая ни в один список, покажется в Admin по
    авторегистрации и молча станет исключением из решения.
    """
    known = set(ARCHIVED_DICTIONARIES) | set(LIVE_DICTIONARIES)
    assert sorted(set(dictionaries_models()) - known) == []


def test_archived_dictionaries_are_hidden_from_admin():
    models = dictionaries_models()

    for name in ARCHIVED_DICTIONARIES:
        assert models[name] not in admin.site._registry, f"{name} всё ещё показывается в Admin"

    for name in LIVE_DICTIONARIES:
        assert models[name] in admin.site._registry, f"{name} живой, но пропал из Admin"


def test_every_archived_dictionary_carries_a_reason():
    empty = sorted(name for name, reason in ARCHIVED_DICTIONARIES.items() if not reason.strip())
    assert empty == [], f"архив без причины — это просто пропажа: {empty}"


def test_nothing_in_the_project_points_at_an_archived_dictionary():
    archived = {dictionaries_models()[name] for name in ARCHIVED_DICTIONARIES}
    offenders = []
    for model in apps.get_models():
        for field in model._meta.get_fields():
            related = getattr(field, "related_model", None)
            if getattr(field, "concrete", False) and related in archived:
                offenders.append(f"{model.__name__}.{field.name} → {related.__name__}")
    assert offenders == [], (
        "на архивный справочник появилась ссылка — решение архивировать больше "
        f"не верно: {offenders}"
    )


def test_api_does_not_serve_archived_dictionaries():
    """Ни один сериализатор приложения не отдаёт архивную модель."""
    from organization_management.apps.dictionaries.api import serializers

    archived = set(ARCHIVED_DICTIONARIES)
    served = {
        getattr(getattr(obj, "Meta", None), "model", None)
        for obj in vars(serializers).values()
        if isinstance(obj, type)
    }
    leaked = sorted(model.__name__ for model in served if model is not None and model.__name__ in archived)
    assert leaked == [], f"архивный справочник уходит в API: {leaked}"
