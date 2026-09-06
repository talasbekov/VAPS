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
from organization_management.apps.operations.services import RoleAdminService

pytestmark = pytest.mark.django_db


@pytest.fixture
def staff():
    """Штаб — это профиль ПЛЮС роль-добавка `OPS_STAFF_COMMAND` (Plane №601).

    С решения заказчика 06.09.2026 право `gvo.manage` («штаб правит и
    утверждает сводку визита», `[ГВО-09]`) живёт не в профиле
    `HEAD_OPS_UNIT`, а в отдельной роли: профиль носят ОБЕ персоны второго
    департамента, а это право область гранта не спрашивает — начальник
    управления утверждал бы сводки по всей организации. Фикстура повторяет
    матрицу персон (`seed_access_matrix`, `dept_head_d2`), а не собирает
    удобный набор прав.
    """
    call_command("seed_operations")
    api, user = client_for("d2-staff", "HEAD_OPS_UNIT")
    RoleAdminService.assign_role(
        str(user.pk), "OPS_STAFF_COMMAND", None, actor="test"
    )
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

    # Пин правлен ОСОЗНАННО (Plane №518): у шаблона «Место проживания» и
    # «Номер проживания» — две разные строки, и номер печатается во второй.
    # Прежняя склейка «место номер» в одном месте была следствием того, что
    # `accommodation_2` не заполнялся вовсе; теперь номер печатался бы дважды.
    assert values["accommodation_1"] == "отель Hilton Astana"
    assert values["accommodation_2"] == "№ 1827"


# ── Места шаблона, которые не заполнялись вовсе (Plane №518) ───────────────


def test_route_flight_duration_and_room_reach_the_document(staff):
    """Маршрут, рейс, время в полёте и номер проживания печатаются.

    🔴 Plane №518. У шаблона под них СВОИ места — `arrival_2/3/4`,
    `departure_2/3/4`, `accommodation_2`, — но `document_values` их не
    заполнял ни разу: `fill_all_keys` честно ставил туда пустоту. Оператор
    набирал маршрут и рейс, а документ уходил с пустой графой.

    Мутация, которую стережёт проба: убрать цикл заполнения `arrival_2/3/4`
    и строку `accommodation_2` — значения станут пустыми строками.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-53")
    staff.patch(
        f"{GVO_URL}ОМ-Т-53/",
        {
            "section": "arrival",
            "values": {
                "arrival": {
                    "date": "18.06.2026",
                    "time": "19:55 ч.",
                    "route": "гг. Подгорица — Астана",
                    "flight": "а/к «Air Astana» KC 638",
                    "dur": "время в полёте 5:40 часа",
                },
            },
        },
        format="json",
    )
    staff.patch(
        f"{GVO_URL}ОМ-Т-53/",
        {
            "section": "org",
            "values": {"stay": {"place": "отель Hilton Astana", "room": "№ 1827"}},
        },
        format="json",
    )

    values = documents_summary.document_values(event)

    assert values["arrival_2"] == "гг. Подгорица — Астана"
    assert values["arrival_3"] == "а/к «Air Astana» KC 638"
    assert values["arrival_4"] == "время в полёте 5:40 часа"
    assert values["accommodation_2"] == "№ 1827"


def test_the_word_reaches_the_slots_that_used_to_stay_empty(staff):
    """И галочка «уточняется» на них наконец действует (Plane №518).

    Карточка называется именно этим: галочка нарисована у КАЖДОГО текстового
    поля, а слово печаталось у шести. Пустая графа читается как «забыли
    заполнить» — а это другое.

    Мутация: заполнять новые места сырым значением в обход `field()` —
    вместо слова снова окажется пустота.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-54")
    staff.patch(
        f"{GVO_URL}ОМ-Т-54/",
        {
            "section": "departure",
            "values": {"departure": {"route": "", "flight": "", "dur": ""}},
            "unspecified": ["departure.route", "departure.flight", "stay.room"],
        },
        format="json",
    )

    values = documents_summary.document_values(event)

    assert values["departure_2"] == "уточняется"
    assert values["departure_3"] == "уточняется"
    assert values["accommodation_2"] == "уточняется"
    # Непомеченное и незаполненное остаётся пустым — слово не выдумывается.
    assert values["departure_4"] == ""


def test_the_time_carries_its_own_flag_next_to_a_filled_date(staff):
    """«Дата есть, времени пока нет» печатается словом (Plane №518).

    Экран рисует галочку «уточняется» у «Времени прибытия» наравне с датой, а
    склейка спрашивала флаг ТОЛЬКО у главного ключа `arrival.date`. Галочка у
    времени стояла и не делала ничего.

    Мутация: вернуть склейке один флаг на главный ключ — вместо
    «18.06.2026 уточняется» останется голая дата.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-55")
    staff.patch(
        f"{GVO_URL}ОМ-Т-55/",
        {
            "section": "arrival",
            "values": {"arrival": {"date": "18.06.2026", "time": ""}},
            "unspecified": ["arrival.time"],
        },
        format="json",
    )

    values = documents_summary.document_values(event)

    assert values["arrival_1"] == "18.06.2026 г. уточняется"


def test_both_flags_on_one_field_print_the_word_once(staff):
    """Обе галочки на одном поле — ОДНО «уточняется», а не два (Plane №904).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Флаг спрашивается у каждой части склейки (№518), а
    строка у поля документа одна. Оператор, которому не сообщили ни даты, ни
    времени, ставит обе галочки — экран рисует их рядом, — и место `arrival_1`
    собиралось как «уточняется уточняется». Это не экзотика, а обычное
    состояние заявки: «прилёт согласован, дату и время сообщат позже» —
    ровно тот сценарий, ради которого заводилась №518. Документ при этом
    уходит на подпись и рассылку, и удвоенное слово в подписываемой бумаге
    читается как опечатка, а не как сведение.

    Существующие пробы этого не ловили по построению: `:137` помечает только
    дату, `:261` — только время, и обе строки склейки ни разу не оказывались
    «уточняется» ОДНОВРЕМЕННО.

    КРАСНАЯ ПРОБА: убери в `joined()` ветку «все части — UNSPECIFIED» — в
    обоих полях снова окажется слово, напечатанное дважды.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-56")
    staff.patch(
        f"{GVO_URL}ОМ-Т-56/",
        {
            "section": "arrival",
            "values": {
                "arrival": {"date": "", "time": ""},
                "departure": {"date": "", "time": ""},
            },
            "unspecified": [
                "arrival.date",
                "arrival.time",
                "departure.date",
                "departure.time",
            ],
        },
        format="json",
    )

    values = documents_summary.document_values(event)

    assert values["arrival_1"] == "уточняется", values["arrival_1"]
    assert values["departure_1"] == "уточняется", values["departure_1"]


def test_a_flagged_time_next_to_a_flagged_date_does_not_swallow_the_date(staff):
    """Смешанный случай не схлопывается: дата остаётся на месте (Plane №904).

    Обратная сторона правки выше. Ветка «все части неизвестны» обязана быть
    именно такой: сработай она на ЛЮБОМ совпадении, «18.06.2026 уточняется»
    превратилось бы в одно слово, и документ потерял бы дату, которую человек
    сообщил. Без этой пробы починка №904 чинила бы одно и ломала соседнее.
    """
    from organization_management.apps.ops import documents_summary

    event = make_event("ОМ-Т-57")
    staff.patch(
        f"{GVO_URL}ОМ-Т-57/",
        {
            "section": "arrival",
            "values": {"arrival": {"date": "18.06.2026", "time": ""}},
            "unspecified": ["arrival.time"],
        },
        format="json",
    )

    values = documents_summary.document_values(event)

    assert values["arrival_1"] == "18.06.2026 г. уточняется"


# ── Правка утверждённого визита (Plane №685) ────────────────────────────────


def _approve(staff, code):
    """Довести визит до утверждения: страна плюс «уточняется» на остальное."""
    staff.patch(
        f"{GVO_URL}{code}/",
        {
            "section": "head",
            "values": {"country": "Черногория"},
            "unspecified": ["persons", "arrival.date", "departure.date", "responsible"],
        },
        format="json",
    )
    approved = staff.post(f"{GVO_URL}{code}/approve/", {}, format="json")
    assert approved.status_code == 200, approved.content
    return approved.json()


def test_editing_an_approved_visit_takes_the_approval_off(staff):
    """Правка утверждённого визита снимает утверждение, а не молчит.

    Это обещал сам отказ повторного утверждения — «Визит уже утверждён —
    правки заведут новую версию», — но код обещания не выполнял: статус
    поднимался только DRAFT→READY. Шапка и реестр показывали «Утверждён» с
    ПРЕЖНЕЙ отметкой времени рядом с другим содержимым, а выхода не было
    вовсе: переутвердить мешал VISIT_ALREADY_APPROVED.

    Красная проверка — убрать ветку `if visit.status == "APPROVED"` в
    `apply_patch`: статус останется APPROVED, а `approvedAt` — прежним.
    """
    make_event("ОМ-Т-61")
    before = _approve(staff, "ОМ-Т-61")
    assert before["visit"]["status"] == "APPROVED"

    staff.patch(
        f"{GVO_URL}ОМ-Т-61/",
        {"section": "head", "values": {"country": "Сербия"}},
        format="json",
    )

    row = staff.get(f"{GVO_URL}ОМ-Т-61/").json()
    assert row["visit"]["status"] == "READY", "утверждение пережило правку состава"
    assert row["visit"]["approvedAt"] is None, (
        "отметка утверждения осталась при снятом статусе — час утверждения "
        "версии, которой больше нет"
    )
    assert row["summary"]["country"] == "Сербия"


def test_a_revoked_visit_can_be_approved_again(staff):
    """Из «правка сняла утверждение» есть выход — переутвердить.

    Без этой пробы починка №685 могла бы запереть визит в другом углу: снять
    утверждение и не дать поставить заново.
    """
    make_event("ОМ-Т-62")
    _approve(staff, "ОМ-Т-62")
    staff.patch(
        f"{GVO_URL}ОМ-Т-62/",
        {"section": "head", "values": {"country": "Сербия"}},
        format="json",
    )

    again = staff.post(f"{GVO_URL}ОМ-Т-62/approve/", {}, format="json")

    assert again.status_code == 200, again.content
    assert again.json()["visit"]["status"] == "APPROVED"
    assert again.json()["visit"]["approvedAt"] is not None


def test_the_revocation_is_named_in_the_journal(staff):
    """Визит, вчера утверждённый, а сегодня «Заполнен», обязан объясняться.

    Молчаливое снятие статуса — то же, за что заведена №356 про уборку: минус
    один факт и ни одного ответа на «кто».
    """
    from organization_management.apps.operations.models_audit import OpsAuditLog

    make_event("ОМ-Т-63")
    _approve(staff, "ОМ-Т-63")
    staff.patch(
        f"{GVO_URL}ОМ-Т-63/",
        {"section": "head", "values": {"country": "Сербия"}},
        format="json",
    )

    entry = OpsAuditLog.objects.filter(action="GVO_VISIT_APPROVAL_REVOKED").get()
    assert entry.new_value["omCode"] == "ОМ-Т-63"


# ── «Вернуть исходные» (Plane №689) ─────────────────────────────────────────


def test_every_allowed_patch_key_belongs_to_some_section(staff):
    """Разрешённый к записи ключ обязан сниматься «Вернуть исходные».

    Ключ, который писать можно, а снять нельзя, остаётся в сводке НАВСЕГДА —
    так и вышло со ссылками на справочники (`*EmployeeIds`): их добавили в
    разрешённые, а по разделам не разложили. Проба стережёт не список, а
    соответствие двух списков: следующая секция, добавленная в один и
    забытая в другом, покраснеет здесь.
    """
    from organization_management.apps.ops.gvo import (
        ALLOWED_PATCH_KEYS,
        SECTION_PATCH_KEYS,
    )

    covered = {key for keys in SECTION_PATCH_KEYS.values() for key in keys}

    assert sorted(set(ALLOWED_PATCH_KEYS) - covered) == []


def test_reset_clears_the_flags_and_the_reference_ids_of_its_section(staff):
    """Сброс раздела снимает и данные, и пометки «уточняется», и ссылки.

    До правки документ продолжал печатать «уточняется» у поля, возвращённого
    к исходному, а идентификаторы снятых встречающих оставались в сводке
    навсегда: `meetEmployeeIds` не было ни в одном разделе.

    Красная проверка — вернуть `SECTION_PATCH_KEYS["arrival"]` без
    `meetEmployeeIds` либо убрать фильтр `visit.unspecified` в `reset_patch`.
    """
    from organization_management.apps.operations.models_gvo import OpsForeignVisit

    event = make_event("ОМ-Т-64")
    staff.patch(
        f"{GVO_URL}ОМ-Т-64/",
        {
            "section": "arrival",
            "values": {
                "arrival": {"date": "", "time": "19:55 ч."},
                "meet": ["Иванов"],
                "meetEmployeeIds": ["17"],
            },
            "unspecified": ["arrival.date", "radio"],
        },
        format="json",
    )

    reset = staff.post(f"{GVO_URL}ОМ-Т-64/reset/", {"section": "arrival"}, format="json")
    assert reset.status_code == 200, reset.content

    visit = OpsForeignVisit.objects.get(event=event)
    assert "meetEmployeeIds" not in visit.data, "ссылки на снятых встречающих остались"
    assert "meet" not in visit.data
    assert "arrival.date" not in visit.unspecified, (
        "пометка пережила поле, которое поясняла"
    )
    # Чужой раздел сброс не трогает: «Вернуть исходные» — про ОДНУ секцию.
    assert "radio" in visit.unspecified
