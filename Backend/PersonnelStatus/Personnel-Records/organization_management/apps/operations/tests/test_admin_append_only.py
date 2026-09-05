"""Append-only реестр сбора сил в админке — только на чтение (Plane №671).

🔴 ЧТО БЫЛО НЕ ТАК. Четыре модели реестра (`[МД-06]`, №425) регистрируются
`register_remaining('operations')` обычным сгенерированным `ModelAdmin`: ни
`readonly_fields`, ни запрета на добавление и удаление. А коммит 82831a5e
намеренно вывел их в меню админки — то есть открыл на правку ровно то, ради
чего реестр и делался: «история, которой у JSON нет».

Две разные беды в одном месте:

* администратор жмёт «Сохранить» — `ModelForm.save()` зовёт `instance.save()`
  БЕЗ `update_fields`, `_AppendOnly.save` поднимает `AppendOnlyError` (голый
  `RuntimeError`, не `ValidationError`), его никто не ловит → HTTP 500 вместо
  сообщения;
* добавление и удаление не прикрыты вовсе: реестр молча переписывается и
  стирается мимо всех правил append-only.

ПОЧЕМУ ТОЛЬКО ЧТЕНИЕ, А НЕ «ПОЧИНИТЬ СОХРАНЕНИЕ». Строка реестра не правится
по определению: довыделение, новый срок, новый ответ департамента — НОВАЯ
строка с большим `sequence`. Форма, которая «сохраняет» такую строку, обязана
была бы завести новую — то есть делать не то, что написано на кнопке. Единое
изменяемое поле (`removed_at` у состава) меняет сервис, и его смысл —
«исключён из состава», а не «поправлен».
"""
import pytest
from django.contrib import admin
from django.contrib.auth.models import User
from django.urls import reverse

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_forces import (
    AppendOnlyError,
    OpsDepartmentRequest,
    OpsForceRequest,
    OpsForceRequestMember,
    OpsUnitRequest,
)
from organization_management.apps.operations.tests.test_status_participation_event_names import (  # noqa: E501
    make_event,
)

pytestmark = pytest.mark.django_db

LEDGER_MODELS = [
    OpsForceRequest,
    OpsDepartmentRequest,
    OpsUnitRequest,
    OpsForceRequestMember,
]
IDS = [model.__name__ for model in LEDGER_MODELS]


@pytest.fixture
def admin_client_local(client):
    User.objects.create_superuser("admin-append-only", "a@example.com", "x")
    client.login(username="admin-append-only", password="x")
    return client


@pytest.fixture
def department_request():
    """Одна живая строка реестра — чтобы страницу правки было чем открыть."""
    event = make_event("ОМ-2026-70", "Реестр сбора сил")
    department = Division.objects.create(name="Департамент 1")
    return OpsDepartmentRequest.objects.create(
        event=event,
        department=department,
        department_key="dep-1",
        allocation_key="alloc-1",
        requested_count=6,
        status="REQUESTED",
        sequence=1,
    )


def url_for(model, view, *args):
    meta = model._meta
    return reverse(f"admin:{meta.app_label}_{meta.model_name}_{view}", args=args)


@pytest.mark.parametrize("model", LEDGER_MODELS, ids=IDS)
def test_the_ledger_admin_forbids_add_change_and_delete(model):
    """Все три права закрыты — у каждой из четырёх моделей реестра."""
    model_admin = admin.site._registry[model]

    assert model_admin.has_add_permission(None) is False
    assert model_admin.has_change_permission(None) is False
    assert model_admin.has_delete_permission(None) is False


@pytest.mark.parametrize("model", LEDGER_MODELS, ids=IDS)
def test_every_field_of_the_ledger_is_read_only(model):
    """Ни одного правимого поля: список смотрят, а не редактируют."""
    model_admin = admin.site._registry[model]
    editable = {
        field.name
        for field in model._meta.get_fields()
        if getattr(field, "editable", False) and field.concrete
    }

    assert editable <= set(model_admin.readonly_fields), (
        f"{model.__name__}: правимыми остались "
        f"{sorted(editable - set(model_admin.readonly_fields))}"
    )


def test_the_change_page_opens_and_shows_the_row(
    admin_client_local, department_request
):
    """Страница строки ОТКРЫВАЕТСЯ — запрет правки не должен её прятать.

    Реестр выведен в меню админки затем, чтобы историю можно было посмотреть
    (коммит 82831a5e). Закрыть страницу целиком значило бы отменить это
    решение вместо того, чтобы починить дефект.
    """
    response = admin_client_local.get(
        url_for(OpsDepartmentRequest, "change", department_request.pk)
    )

    assert response.status_code == 200
    assert b"alloc-1" in response.content


def test_saving_the_row_is_refused_instead_of_five_hundred(
    admin_client_local, department_request
):
    """Та самая пятисотка: POST на правку — отказ, а не падение."""
    response = admin_client_local.post(
        url_for(OpsDepartmentRequest, "change", department_request.pk),
        {"requested_count": 99, "status": "REQUESTED", "sequence": 1},
    )

    assert response.status_code == 403, (
        f"сохранение append-only строки ответило {response.status_code}"
    )
    department_request.refresh_from_db()
    assert department_request.requested_count == 6


def test_deleting_the_row_is_refused(admin_client_local, department_request):
    """История, которой у JSON нет, не стирается из админки."""
    response = admin_client_local.post(
        url_for(OpsDepartmentRequest, "delete", department_request.pk),
        {"post": "yes"},
    )

    assert response.status_code == 403
    assert OpsDepartmentRequest.objects.filter(pk=department_request.pk).exists()


def test_the_add_form_is_refused(admin_client_local):
    """Строки реестра заводит проекция, а не человек руками."""
    response = admin_client_local.get(url_for(OpsDepartmentRequest, "add"))

    assert response.status_code == 403


def test_the_model_still_refuses_a_plain_save(department_request):
    """Опора под всем выше: запрет живёт В МОДЕЛИ, админка лишь не спорит с ним.

    Сними кто-нибудь `readonly_fields` — правка всё равно не пройдёт, но уже
    пятисоткой. Эта проба держит то, что запрет не переехал в админку.
    """
    department_request.requested_count = 99

    with pytest.raises(AppendOnlyError):
        department_request.save()
