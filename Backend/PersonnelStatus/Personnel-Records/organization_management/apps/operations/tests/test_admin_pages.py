"""Каждая страница Admin ОТКРЫВАЕТСЯ — по всем приложениям, не только ОМ.

Регистрация модели и работающая страница — РАЗНЫЕ вещи, и разница видна только
запросом. `admin.site._registry` наполняется при импорте, а падает страница уже
в базе: сортировка по колонке, которой нет в БД, `list_filter` по полю,
которое Admin фильтровать не умеет, обращение к отсутствующему related_name
в `list_select_related`. Гвард `test_admin_registry.py` рядом утверждает, что
модель ЧИСЛИТСЯ в Admin; этот — что по ней можно кликнуть.

Смысл появился 27.08.2026 вместе с решением №182: 90 моделей зарегистрированы
АВТОМАТОМ, по типам полей, а не руками — значит ни одну из них человек глазами
не открывал, и проверить их может только прогон.

Файл лежит в `operations`, хотя проверяет все приложения, СОЗНАТЕЛЬНО: раздел
ОМ владеет решением №182, и его тесты гоняются в гейте всегда. В отдельном
project-level каталоге проверка рисковала бы не запуститься вовсе.
"""
import pytest
from django.contrib import admin
from django.contrib.auth.models import User
from django.urls import reverse

pytestmark = pytest.mark.django_db

# Модели проектных приложений: чужие (`auth`, `contenttypes`, сторонние) не
# наши, и их страницы чинить не нам.
REGISTERED = sorted(
    (
        model
        for model in admin.site._registry
        if model.__module__.startswith("organization_management.")
    ),
    key=lambda m: (m._meta.app_label, m.__name__),
)

IDS = [f"{m._meta.app_label}.{m.__name__}" for m in REGISTERED]


def test_there_is_something_to_open():
    """Опора: пустой реестр сделал бы проверки ниже вечнозелёными."""
    assert len(REGISTERED) >= 80


@pytest.fixture
def admin_client_local(client):
    User.objects.create_superuser("admin-pages", "a@example.com", "x")
    client.login(username="admin-pages", password="x")
    return client


@pytest.mark.parametrize("model", REGISTERED, ids=IDS)
def test_the_changelist_opens(admin_client_local, model):
    """Список — первое, что откроет человек, пришедший проверять руками."""
    meta = model._meta
    url = reverse(f"admin:{meta.app_label}_{meta.model_name}_changelist")

    response = admin_client_local.get(url)

    assert response.status_code == 200, f"{meta.label}: список отвечает {response.status_code}"


@pytest.mark.parametrize("model", REGISTERED, ids=IDS)
def test_the_search_of_the_changelist_answers(admin_client_local, model):
    """Поиск отдельным запросом: именно он падает на нетекстовой колонке.

    Пустой список моделей поиска делает запрос безобидным, поэтому проверка
    идёт по КАЖДОЙ модели — она стережёт не наличие поиска, а то, что
    имеющийся не отвечает ProgrammingError.
    """
    meta = model._meta
    url = reverse(f"admin:{meta.app_label}_{meta.model_name}_changelist")

    response = admin_client_local.get(url, {"q": "проверка-поиска"})

    assert response.status_code == 200, f"{meta.label}: поиск отвечает {response.status_code}"


@pytest.mark.parametrize("model", REGISTERED, ids=IDS)
def test_the_add_form_opens(admin_client_local, model):
    """Форма заведения — то, ради чего решение №182 и принималось.

    403 здесь законен и ожидаем: у синглтона настроек добавление закрыто
    гейтом, и это не поломка, а правило. Не законен 500.
    """
    meta = model._meta
    url = reverse(f"admin:{meta.app_label}_{meta.model_name}_add")

    response = admin_client_local.get(url)

    assert response.status_code in (200, 403), (
        f"{meta.label}: форма заведения отвечает {response.status_code}"
    )
