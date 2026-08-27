"""Admin разложен по категориям, и ни одна модель не потеряна (Plane №210).

Пробы стерегут три обещания:

1. ВЕРХНИЙ УРОВЕНЬ — КАТЕГОРИИ, а не приложения; порядок объявленный, а не
   алфавитный (сверху то, к чему ходят чаще).
2. НИ ОДНА МОДЕЛЬ НЕ ПОТЕРЯНА И НЕ УДВОЕНА. Раскладка — это перекладывание
   ссылок; модель, выпавшая из списка, исчезает с экрана бесшумно, и заметить
   это можно только счётом.
3. СТРАНИЦА ОТДЕЛЬНОГО ПРИЛОЖЕНИЯ ОСТАЛАСЬ ШТАТНОЙ: по этим ссылкам Admin
   ходит сам, и подмена группировки там ломает переходы.

Отдельно сторожится сам реестр: категория, написанная с опечаткой, создала бы
на экране восьмую категорию-призрак с одной моделью.
"""
import pytest
from django.contrib import admin
from django.test import RequestFactory
from django.contrib.auth import get_user_model

from organization_management.admin_categories import (
    APP_CATEGORY,
    CATEGORIES,
    MODEL_CATEGORY,
    OTHER_CATEGORY,
    category_of,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def request_of_superuser():
    user = get_user_model().objects.create_superuser(username="admin-categories")
    request = RequestFactory().get("/admin/")
    request.user = user
    return request


def test_the_top_level_is_categories_in_the_declared_order(request_of_superuser):
    names = [group["name"] for group in admin.site.get_app_list(request_of_superuser)]

    assert names, "индекс Admin пуст"
    declared = [name for name in list(CATEGORIES) + [OTHER_CATEGORY] if name in names]
    assert names == declared, f"порядок категорий не совпадает с объявленным: {names}"


def test_no_model_is_lost_or_duplicated(request_of_superuser):
    listed = [
        model["object_name"]
        for group in admin.site.get_app_list(request_of_superuser)
        for model in group["models"]
    ]
    registered = len(admin.site._registry)

    assert len(listed) == registered, (
        f"в категориях {len(listed)} моделей, а зарегистрировано {registered} — "
        f"часть моделей исчезла с экрана или показана дважды"
    )


def test_the_dictionaries_land_in_the_dictionaries_category(request_of_superuser):
    groups = {group["name"]: group for group in admin.site.get_app_list(request_of_superuser)}

    assert "Справочники" in groups
    names = {model["object_name"] for model in groups["Справочники"]["models"]}
    assert {"Position", "Rank"} <= names, sorted(names)


def test_an_unknown_app_falls_into_other():
    assert category_of("заведомо-нет-такого", "Whatever") == OTHER_CATEGORY


def test_every_rule_names_a_declared_category():
    known = set(CATEGORIES) | {OTHER_CATEGORY}
    unknown = sorted(
        {name for name in APP_CATEGORY.values() if name not in known}
        | {name for name in MODEL_CATEGORY.values() if name not in known}
    )
    assert unknown == [], f"категория с опечаткой создаст призрак на экране: {unknown}"


def test_the_app_page_stays_standard(client):
    user = get_user_model().objects.create_superuser(username="admin-app-page")
    client.force_login(user)

    response = client.get("/admin/operations/")

    assert response.status_code == 200
    assert response.context["app_list"][0]["app_label"] == "operations"


def test_the_index_page_opens_and_shows_the_categories(client):
    user = get_user_model().objects.create_superuser(username="admin-index")
    client.force_login(user)

    response = client.get("/admin/")

    assert response.status_code == 200
    body = response.content.decode()
    for name in ("Справочники", "Охранные мероприятия", "Структура и штат"):
        assert name in body, f"категории «{name}» нет на экране Admin"


def test_nothing_is_left_in_other(request_of_superuser):
    """«Прочее» — канарейка, а не свалка (Plane №211).

    Каждая модель разложена сознательно, поэтому непустое «Прочее» означает
    ровно одно: появилась модель, которой никто не назначил место. Пока список
    пуст, категория на экран не выводится вовсе.
    """
    other = [
        model["object_name"]
        for group in admin.site.get_app_list(request_of_superuser)
        if group["name"] == OTHER_CATEGORY
        for model in group["models"]
    ]
    assert other == [], f"модели без категории: {other}"


def test_no_category_holds_more_than_a_third_of_everything(request_of_superuser):
    """Категория, вобравшая всё, — тот же общий список под другим заголовком.

    До дробления раздел ОМ давал 67 моделей из 93 в одной категории; после —
    ни одна не держит больше трети.
    """
    groups = admin.site.get_app_list(request_of_superuser)
    total = sum(len(group["models"]) for group in groups)
    biggest = max(groups, key=lambda group: len(group["models"]))

    assert len(biggest["models"]) <= total / 3, (
        f"«{biggest['name']}» держит {len(biggest['models'])} из {total} — "
        f"это общий список, а не категория"
    )


@pytest.mark.parametrize(
    "app_label",
    sorted(
        {
            model._meta.app_label
            for model in admin.site._registry
            if model.__module__.startswith("organization_management")
        }
    ),
)
def test_our_models_are_named_in_russian(app_label):
    """Подпись модели — это то, что заказчик видит в списке разделов.

    `ops employee statuss` и `secondment requests` он читать не обязан;
    сторонние модели (auth, celery) сюда не входят — они переводятся не нами.
    """
    from django.apps import apps as django_apps

    english = []
    for model in django_apps.get_app_config(app_label).get_models():
        label = str(model._meta.verbose_name)
        if not any("а" <= letter.lower() <= "я" or letter == "ё" for letter in label):
            english.append(f"{model.__name__} → {label}")

    assert english == [], f"подписи не по-русски: {english}"
