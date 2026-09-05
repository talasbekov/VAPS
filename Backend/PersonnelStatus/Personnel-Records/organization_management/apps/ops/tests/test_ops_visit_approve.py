"""Утверждение визита иностранного ОЛ (`[ГВО-07]`, `[ГВО-09]`, Plane №436).

«Обязательные поля помечены; „Утвердить“ недоступна, пока они не заполнены;
утверждает штаб». Пробы стерегут: сводка отдаёт прогресс и список
недостающих; утверждение с пустыми обязательными — 422 со списком; поле,
помеченное «уточняется», обязательным больше не держит; после утверждения
статус APPROVED, повтор — 422; старший ГВО без `gvo.manage` утвердить не
может (403), у внутреннего ОМ утверждать нечего (422).
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_gvo_api import (
    GVO_URL,
    _employee,
    make_event,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def staff():
    call_command("seed_operations")
    api, _ = client_for("d2-staff", "HEAD_OPS_UNIT")
    return api


def test_summary_reports_required_progress_and_approve_refuses_until_filled(staff):
    make_event("ОМ-Т-41")
    row = staff.get(f"{GVO_URL}ОМ-Т-41/").json()
    assert row["requiredTotal"] == 5
    assert "Страна" in row["missingRequired"]
    assert row["requiredFilled"] == row["requiredTotal"] - len(row["missingRequired"])

    refused = staff.post(f"{GVO_URL}ОМ-Т-41/approve/", {}, format="json")
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_REQUIRED_MISSING"
    assert "Страна" in refused.json()["details"]["missing"]

    # Заполняем страну, остальное — «уточняется»: этого достаточно.
    patched = staff.patch(
        f"{GVO_URL}ОМ-Т-41/",
        {
            "section": "head",
            "values": {"country": "Черногория"},
            "unspecified": ["persons", "arrival.date", "departure.date", "responsible"],
        },
        format="json",
    )
    assert patched.status_code == 200, patched.content
    assert staff.get(f"{GVO_URL}ОМ-Т-41/").json()["missingRequired"] == []

    approved = staff.post(f"{GVO_URL}ОМ-Т-41/approve/", {}, format="json")
    assert approved.status_code == 200, approved.content
    assert approved.json()["visit"]["status"] == "APPROVED"
    assert approved.json()["visit"]["approvedAt"] is not None

    again = staff.post(f"{GVO_URL}ОМ-Т-41/approve/", {}, format="json")
    assert again.status_code == 422
    assert again.json()["error_code"] == "VISIT_ALREADY_APPROVED"


def test_the_gvo_senior_fills_but_does_not_approve():
    chief = _employee()
    event = make_event("ОМ-Т-42")
    event.chief_employee_id = chief.pk
    event.save(update_fields=["chief_employee_id"])
    api, user = client_for("gvo-senior", "VIEWER", ["event.view"])
    chief.user = user
    chief.save(update_fields=["user"])

    ok = api.patch(
        f"{GVO_URL}ОМ-Т-42/",
        {"section": "head", "values": {"country": "Черногория"}},
        format="json",
    )
    assert ok.status_code == 200, ok.content
    denied = api.post(f"{GVO_URL}ОМ-Т-42/approve/", {}, format="json")
    assert denied.status_code == 403, denied.content


def test_an_internal_event_has_nothing_to_approve(staff):
    event = make_event("ОМ-Т-43")
    event.kind = "INTERNAL"
    event.save(update_fields=["kind"])
    resp = staff.post(f"{GVO_URL}ОМ-Т-43/approve/", {}, format="json")
    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "VISIT_FOREIGN_ONLY"


# ── Флаг «уточняется» и документ (Plane №688) ───────────────────────────────


def test_flagged_fields_print_the_word_in_the_document(staff):
    """Помеченное «уточняется» печатается СЛОВОМ, а не пустотой.

    До правки помощник `field()` был применён только к шести ключам раздела
    «Организация», а «Прибытие», «Убытие» и «Место проживания» собирались
    склейкой В ОБХОД него: помеченные поля уходили в документ пустыми, и
    читатель не отличал «неизвестно» от «не заполнили» — ровно то различие,
    ради которого флаг и заведён.

    Красная проверка — вернуть склейку без `joined()`: три значения ниже
    станут пустыми строками.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-51")
    # Дата прибытия/убытия приходит из бюллетеня, поэтому её надо ОЧИСТИТЬ:
    # проверяется печать ПУСТОГО помеченного поля, а не заполненного.
    staff.patch(
        f"{GVO_URL}ОМ-Т-51/",
        {
            "section": "arrival",
            "values": {
                "arrival": {"date": "", "time": ""},
                "departure": {"date": "", "time": ""},
                "stay": {"place": "", "room": ""},
            },
            "unspecified": ["arrival.date", "departure.date", "stay.place"],
        },
        format="json",
    )
    values = documents_summary.document_values(event)

    assert values["arrival_1"] == "уточняется"
    assert values["departure_1"] == "уточняется"
    assert values["accommodation_1"] == "уточняется"


def test_a_filled_field_prints_its_value_even_when_flagged(staff):
    """Флаг НЕ подменяет данные: заполненное печатается как есть.

    Мутация «печатать „уточняется“ всегда, когда стоит флаг» краснит здесь:
    человек мог пометить поле, а потом заполнить его — и документ обязан
    показать факт, а не прежнюю пометку.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-52")
    staff.patch(
        f"{GVO_URL}ОМ-Т-52/",
        {
            "section": "org",
            "values": {"stay": {"place": "отель Hilton Astana", "room": "№ 1827"}},
            "unspecified": ["stay.place"],
        },
        format="json",
    )

    values = documents_summary.document_values(event)

    assert values["accommodation_1"] == "отель Hilton Astana № 1827"
