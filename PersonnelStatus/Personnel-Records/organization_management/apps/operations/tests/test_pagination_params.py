"""limit/offset у списков раздела ОМ исполняются, а не только описаны.

Вьюхи раздела — plain ViewSet: пагинацию они делают руками
(DefaultPagination() внутри list), а pagination_class на классе объявлен
исключительно ради схемы. Из-за этой развилки схема и поведение способны
разойтись молча: атрибут можно снять, не сломав ни одного теста, и клиент
из schema.yaml перестанет знать про листание, которое сервер по-прежнему
исполняет. Тесты ниже закрепляют вторую половину контракта — что параметры
действительно работают.

Список statuses уже покрыт test_status_list_api.test_pagination_envelope.
"""
from datetime import timedelta

import pytest

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.services import RoleAdminService

from .test_bulk_status_api import client_for, make_employee
from .test_rbac_admin_api import TEMP_DUTY_URL
from .test_rbac_admin_api import client_for as admin_client_for
from .test_secondment_api import get as get_secondments
from .test_secondment_api import home, host, seed_pair, types  # noqa: F401


@pytest.mark.django_db
def test_temporary_duty_honours_limit_and_offset():
    api, _ = admin_client_for("page-td", "ADMIN", ["*"])
    now = Clock.now()
    for offset in (1, 2, 3):
        RoleAdminService.grant_temporary_duty(
            user_id="42",
            duty_role_code="HQ_DUTY",
            starts_at=now - timedelta(hours=offset),
            ends_at=now + timedelta(hours=1),
            created_by="test",
        )
    # Без параметров страница отдаёт всё — иначе усечение ниже было бы
    # неотличимо от того, что строк просто мало.
    full = api.get(TEMP_DUTY_URL).json()
    assert full["count"] == 3
    assert len(full["results"]) == 3

    page = api.get(TEMP_DUTY_URL, {"limit": 1}).json()
    assert page["count"] == 3
    assert len(page["results"]) == 1
    assert page["next"] is not None

    nxt = api.get(TEMP_DUTY_URL, {"limit": 1, "offset": 1}).json()
    assert nxt["results"][0]["id"] != page["results"][0]["id"]


@pytest.mark.django_db
def test_secondments_honour_limit_and_offset(types, home, host):  # noqa: F811
    api, _ = client_for("page-sec", "ADMIN", ["*"])
    for _ in range(3):
        seed_pair(make_employee(home), host, admin=api)

    full = get_secondments(api).data
    assert full["count"] == 3
    assert len(full["results"]) == 3

    page = get_secondments(api, limit=1).data
    assert page["count"] == 3
    assert len(page["results"]) == 1
    assert page["next"] is not None

    nxt = get_secondments(api, limit=1, offset=1).data
    assert nxt["results"][0]["id"] != page["results"][0]["id"]
