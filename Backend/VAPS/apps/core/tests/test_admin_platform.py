"""Smoke-тесты admin-платформы (Story 2.10).

Поднятие `django.contrib.admin` + зависимостей: страница логина рендерится,
суперюзер доходит до admin-index. Граница 2.10↔2.11: НИ одна модель не
зарегистрирована (регистрация справочников — стори 2.11).
"""
import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import Client
from django.urls import reverse

from apps.core.models import Division, DivisionType, Employee, Position, Rank
from apps.operations.rbac.models import Role
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.submissions.models import SubmissionControlSettings

pytestmark = pytest.mark.django_db

# Справочники/настройки, допустимые в Admin (ARCH#L467) + contrib Group.
CATALOG_MODELS = {Position, Rank, DivisionType, StatusType, SubmissionControlSettings}
ALLOWED_IN_ADMIN = {Group} | CATALOG_MODELS


def test_admin_login_page_renders():
    # AC-1: платформа поднята — TEMPLATES-бэкенд + staticfiles-теги резолвятся.
    resp = Client().get("/admin/login/")
    assert resp.status_code == 200


def test_superuser_reaches_admin_index():
    # AC-2: суперюзер (create_superuser, 2.8) входит и видит admin-index.
    superuser = get_user_model().objects.create_superuser(
        username="admin", password="pw"
    )
    client = Client()
    client.force_login(superuser)
    resp = client.get("/admin/")
    assert resp.status_code == 200


def test_superuser_logs_in_via_form():
    # AC-2 (усиление): реальный логин формой с CSRF — доказывает связку
    # session + ModelBackend + CsrfViewMiddleware, а не только force_login.
    get_user_model().objects.create_superuser(username="admin", password="pw")
    client = Client(enforce_csrf_checks=True)
    token = client.get("/admin/login/").cookies["csrftoken"].value
    resp = client.post(
        "/admin/login/",
        {
            "username": "admin",
            "password": "pw",
            "csrfmiddlewaretoken": token,
            "next": "/admin/",
        },
    )
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/admin/"


def test_admin_registry_is_exactly_catalogs():
    # Страж реестра (AC-2, инверсия теста 2.10): зарегистрированы РОВНО
    # справочники + contrib Group. `==` ловит и пере-регистрацию (бизнес-
    # модель просочилась → красный), и недо-регистрацию (забыли справочник).
    # autodiscover форсируем — под pytest он мог не вызваться → ложно-зелёный.
    admin.autodiscover()
    assert set(admin.site._registry) == ALLOWED_IN_ADMIN, sorted(
        f"{m._meta.app_label}.{m.__name__}" for m in admin.site._registry
    )


def test_business_models_not_registered_in_admin():
    # AC-3: явный негатив для репрезентативных бизнес-моделей (запись мимо
    # сервиса = мимо аудита/прав; ARCH#L467). Полное покрытие даёт `==` выше.
    admin.autodiscover()
    for model in (Employee, Division, EmployeeStatus, Role, get_user_model()):
        assert model not in admin.site._registry, model


def test_catalog_changelists_render():
    # AC-1: каждый справочник имеет editable-changelist для суперюзера.
    admin.autodiscover()
    superuser = get_user_model().objects.create_superuser(
        username="admin", password="pw"
    )
    client = Client()
    client.force_login(superuser)
    for model in CATALOG_MODELS:
        url = reverse(
            f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist"
        )
        assert client.get(url).status_code == 200, url


def test_submission_settings_singleton_admin_gates():
    # Singleton-гейты + edit-форма (AC-1 для настроек): change-view посеянной
    # строки (migration 0001) рендерится → editable; add/delete запрещены
    # (has_add_permission/has_delete_permission).
    superuser = get_user_model().objects.create_superuser(
        username="admin", password="pw"
    )
    client = Client()
    client.force_login(superuser)
    opts = SubmissionControlSettings._meta
    row = SubmissionControlSettings.objects.get()  # singleton, seeded
    base = f"admin:{opts.app_label}_{opts.model_name}"
    assert client.get(reverse(f"{base}_change", args=[row.pk])).status_code == 200
    assert client.get(reverse(f"{base}_add")).status_code == 403
    assert client.get(reverse(f"{base}_delete", args=[row.pk])).status_code == 403
