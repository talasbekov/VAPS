"""Маршрут согласования в настройках, очередь и реквизиты подписи (Plane №429).

`[СОГ-05]`: маршрут задаётся в настройках, не на объекте; `acc_dir_head_d2` —
согласует, «если в маршруте». `[СОГ-10]`: в подписи ФИО, должность, логин,
время сервера, номер и хэш версии, IP — в аудите и в подвале PDF.

Пробы стерегут:
1. маршрут из настроек копируется объекту при завершении расстановки, и
   правка настройки уже идущее согласование не трогает;
2. подписывают по очереди: второй до первого — 422; чужая учётка на строке
   с логином — 403; своя — подпись с реквизитами и строка аудита;
3. в PDF после подписи есть подвал «Согласовано: …, версия N».
"""
import base64
import io

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from organization_management.apps.operations.audit_service import (
    SECURITY_EVENT_APPROVAL_SIGNED,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    make_employee,
    make_object,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db

ROUTE = "/api/ops/approval-route/"
URL = "/api/ops/security-events/"
RENDER = "/api/ops/event-documents/render/"


def text_of(pdf_bytes):
    from pypdf import PdfReader

    return "".join(
        (page.extract_text() or "") for page in PdfReader(io.BytesIO(pdf_bytes)).pages
    )


@pytest.fixture
def admin_api():
    api, _ = client_for("route-admin", "ROUTE_ADMIN", perms=("*",))
    return api


@pytest.fixture
def signers():
    """Две учётки-подписанта из НАСТОЯЩЕГО каталога (`HEAD_OPS_UNIT`)."""
    call_command("seed_operations")
    first, first_user = client_for("dept-head", "HEAD_OPS_UNIT")
    second, second_user = client_for("dir-head", "HEAD_OPS_UNIT")
    employee = make_employee(last_name="Начальников", first_name="Данияр")
    employee.user = first_user
    employee.save(update_fields=["user"])
    return first, second


def _set_route(admin_api, steps):  # noqa: F811
    resp = admin_api.put(ROUTE, {"steps": steps}, format="json")
    assert resp.status_code == 200, resp.content
    return resp.json()["results"]


def test_the_route_is_copied_from_settings_and_frozen_on_the_object(
    admin_api, signers, manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    # Объект уже на «Согласовании» с пустым маршрутом — заполняется при отправке.
    _set_route(admin_api, [
        {"roleLabel": "Начальник 2-го департамента", "unit": "Второй департамент", "username": "dept-head"},
        {"roleLabel": "Заместитель руководителя организации"},
    ])
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    assert sent.status_code == 200, sent.content
    row = next(v for v in sent.json()["visitObjects"] if v["id"] == str(first.pk))
    route = row["approvalRoute"]
    assert [item["position"] for item in route] == [
        "Начальник 2-го департамента", "Заместитель руководителя организации",
    ]
    assert route[0]["username"] == "dept-head"
    assert route[0]["name"] == "Начальников Данияр"
    assert all(item["status"] == "PENDING" for item in route)

    # Правка настройки не переписывает идущее согласование.
    _set_route(admin_api, [{"roleLabel": "Кто-то другой"}])
    fresh = manager.get(base).json()
    row = next(v for v in fresh["visitObjects"] if v["id"] == str(first.pk))
    assert [item["position"] for item in row["approvalRoute"]][0] == "Начальник 2-го департамента"


def test_unknown_login_is_rejected(admin_api):
    resp = admin_api.put(ROUTE, {"steps": [{"roleLabel": "Штаб", "username": "nobody-here"}]}, format="json")
    assert resp.status_code == 400, resp.content


def test_signing_goes_in_order_by_the_bound_account_and_leaves_requisites(
    admin_api, signers, manager, two_objects_on_approval  # noqa: F811
):
    first_signer, second_signer = signers
    base, event_id, first, _second, _ = two_objects_on_approval
    _set_route(admin_api, [
        {"roleLabel": "Начальник 2-го департамента", "username": "dept-head"},
        {"roleLabel": "Начальник управления", "username": "dir-head"},
    ])
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    route = next(v for v in sent.json()["visitObjects"] if v["id"] == str(first.pk))["approvalRoute"]
    step1, step2 = route[0]["id"], route[1]["id"]

    # Второй раньше первого — очередь не дошла.
    early = second_signer.post(
        f"{base}approval/route/{step2}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)}, format="json",
    )
    assert early.status_code == 422, early.content
    assert early.json()["error_code"] == "APPROVAL_OUT_OF_ORDER"

    # Чужая учётка на строке первого — не её строка.
    wrong = second_signer.post(
        f"{base}approval/route/{step1}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)}, format="json",
    )
    assert wrong.status_code == 403, wrong.content

    signed = first_signer.post(
        f"{base}approval/route/{step1}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)},
        format="json", REMOTE_ADDR="10.7.7.7",
    )
    assert signed.status_code == 200, signed.content
    item = next(v for v in signed.json()["visitObjects"] if v["id"] == str(first.pk))["approvalRoute"][0]
    assert item["status"] == "APPROVED"
    signature = item["signature"]
    assert signature["fullName"] == "Начальников Данияр"
    assert signature["position"] == "Начальник 2-го департамента"
    assert signature["login"] == "dept-head"
    assert signature["ip"] == "10.7.7.7"
    assert signature["versionNumber"] >= 1
    assert len(signature["versionHash"]) == 16
    assert signature["signedAt"]
    trace = OpsAuditLog.objects.filter(action=SECURITY_EVENT_APPROVAL_SIGNED)
    assert trace.count() == 1
    assert trace.first().new_value["login"] == "dept-head"

    # Подвал PDF после подписи.
    code = manager.get(base).json()["code"]
    pdf = manager.get(RENDER, {"kind": "placement", "event": code, "ext": "pdf", "visitObject": str(first.pk)})
    assert pdf.status_code == 200, pdf.content
    text = "".join(text_of(base64.b64decode(pdf.json()["contentBase64"])).split())
    assert "Согласовано:НачальниковДанияр,Начальник2-годепартамента" in text
    assert "версия" in text

    # Второй подписывает своей учёткой — этап закрывается сам (СОГ-09).
    done = second_signer.post(
        f"{base}approval/route/{step2}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)}, format="json",
    )
    assert done.status_code == 200, done.content
    assert next(v for v in done.json()["visitObjects"] if v["id"] == str(first.pk))["approvalStatus"] == "APPROVED"


def test_admin_signs_any_line_without_identity_check(admin_api, signers, manager, two_objects_on_approval):  # noqa: F811
    base, _event_id, first, _second, _ = two_objects_on_approval
    _set_route(admin_api, [{"roleLabel": "Начальник", "username": "dept-head"}])
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    step = next(v for v in sent.json()["visitObjects"] if v["id"] == str(first.pk))["approvalRoute"][0]["id"]
    resp = admin_api.post(
        f"{base}approval/route/{step}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)}, format="json",
    )
    assert resp.status_code == 200, resp.content


def test_signature_ip_ignores_forged_x_forwarded_for(
    admin_api, signers, manager, two_objects_on_approval  # noqa: F811
):
    """IP подписи не берётся из заголовка запроса (Plane №699).

    🔴 ПОДПИСЫВАЮЩИЙ НЕ ДИКТУЕТ IP, ЗАПИСАННЫЙ ПРОТИВ ЕГО ЖЕ ПОДПИСИ.
    `X-Forwarded-For` присылает клиент, и до этой пробы он побеждал
    `REMOTE_ADDR` безусловно: значение уходило в реквизиты подписи и в
    неизменяемую строку аудита `SECURITY_EVENT_APPROVAL_SIGNED`. Подписант
    одной строкой в запросе назначал себе любой адрес — а именно этот адрес
    и служит доказательством, откуда подписали.

    Стенд и тесты идут БЕЗ доверенного прокси (`TRUSTED_PROXY_IPS` пуст),
    поэтому заголовок здесь не значит ничего и ответ один — `REMOTE_ADDR`.
    """
    first_signer, _second_signer = signers
    base, _event_id, first, _second, _ = two_objects_on_approval
    _set_route(admin_api, [
        {"roleLabel": "Начальник 2-го департамента", "username": "dept-head"},
    ])
    sent = manager.post(f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json")
    step = next(v for v in sent.json()["visitObjects"] if v["id"] == str(first.pk))["approvalRoute"][0]["id"]

    signed = first_signer.post(
        f"{base}approval/route/{step}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)},
        format="json",
        REMOTE_ADDR="10.7.7.7",
        HTTP_X_FORWARDED_FOR="203.0.113.9, 198.51.100.4",
    )
    assert signed.status_code == 200, signed.content

    signature = next(
        v for v in signed.json()["visitObjects"] if v["id"] == str(first.pk)
    )["approvalRoute"][0]["signature"]
    assert signature["ip"] == "10.7.7.7", (
        "IP подписи взят из присланного заголовка — подписант подделал "
        f"собственный реквизит: {signature['ip']}"
    )

    # Аудит неизменяем: подделка, попавшая туда, остаётся навсегда.
    trace = OpsAuditLog.objects.filter(action=SECURITY_EVENT_APPROVAL_SIGNED)
    assert trace.count() == 1
    assert trace.first().new_value["ip"] == "10.7.7.7"
