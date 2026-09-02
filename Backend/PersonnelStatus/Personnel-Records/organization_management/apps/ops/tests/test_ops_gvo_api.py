"""API ГВО: каталог охраняемых лиц и патчи сводок (спека 2026-08-20).

Контракт повторяет мок фронта 1:1:
- GET /api/ops/protected-persons/ → {"results": [...]} (id — строкой:
  ID-конвенция «бэк int, наружу строка», чтобы типы entities не менялись);
- GET /api/ops/gvo-summaries/ → {"results": [{omCode, patch, updatedAt}]};
- PATCH /api/ops/gvo-summaries/{omCode}/ — merge по ключам верхнего уровня;
- POST /api/ops/gvo-summaries/{omCode}/reset/ — сброс к базе из бюллетеня.

Права — существующие плоские коды: чтение event.view, правка event.manage.
Гейт fail-closed: нужна и персона С правом, и персона БЕЗ него — иначе
закрытое состояние недостижимо и тест вакуумен.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import (
    OpsGvoSummaryPatch,
    OpsProtectedPerson,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

PERSONS_URL = "/api/ops/protected-persons/"
GVO_URL = "/api/ops/gvo-summaries/"

pytestmark = pytest.mark.django_db


def viewer(name="ops-gvo-viewer"):
    # Каталог охраняемых лиц с 28.08.2026 под `catalog.view` (Plane №267);
    # `event.view` остаётся — истории мероприятий лица нужен реестр.
    api, _ = client_for(name, "VIEWER", ["event.view", "catalog.view"])
    return api


def manager(name="ops-gvo-manager"):
    """Персона, которая ПРАВИТ сводку: с «Реестр ОМ-35.6» это своё право
    `gvo.manage`, а не общее `event.manage` — сводку заполняет старший ГВО, а
    не всякий, кто ведёт мероприятие."""
    api, user = client_for(name, "MANAGER", ["event.view", "gvo.manage"])
    return api, user


def event_manager(name="ops-gvo-event-manager"):
    """Ведущий мероприятие БЕЗ права правки сводки — персона, на которой видно,
    что новый гейт работает: у неё есть `event.manage`, и раньше этого хватало."""
    api, user = client_for(name, "MANAGER", ["event.view", "event.manage", "event.create", "event.bulletin"])
    return api, user


def nobody(name="ops-gvo-nobody"):
    api, _ = client_for(name)
    return api


def make_event(code="ОМ-Т-9"):
    return OpsSecurityEvent.objects.create(
        code=code,
        title="Визит",
        object_name="Объект",
        business_date="2026-08-21",
        stage=OpsSecurityEvent.Stage.BULLETIN,
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Тест",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


# ── Каталог лиц ──────────────────────────────────────────────────────────


def test_persons_list_active_only_ordered_ids_are_strings():
    OpsProtectedPerson.objects.bulk_create(
        [
            OpsProtectedPerson(name="Бекетов", category="OURS"),
            OpsProtectedPerson(name="Алиев", category="FOREIGN"),
            OpsProtectedPerson(name="Скрытый", category="OURS", is_active=False),
        ]
    )
    r = viewer().get(PERSONS_URL)
    assert r.status_code == 200
    rows = r.json()["results"]
    assert [p["name"] for p in rows] == ["Алиев", "Бекетов"]
    assert all(isinstance(p["id"], str) for p in rows)
    assert set(rows[0]) == {"id", "name", "callsign", "category", "bio"}


def test_persons_denied_without_permission():
    assert nobody().get(PERSONS_URL).status_code == 403


def test_persons_denied_anonymous():
    assert APIClient().get(PERSONS_URL).status_code == 403


# ── Сводки ГВО: list / patch / reset ─────────────────────────────────────


def test_gvo_list_returns_patches_with_om_code():
    ev = make_event("ОМ-Т-10")
    OpsGvoSummaryPatch.objects.create(event=ev, patch={"country": "Черногория"})
    r = viewer("gvo-list-viewer").get(GVO_URL)
    assert r.status_code == 200
    rows = r.json()["results"]
    assert [row["omCode"] for row in rows] == ["ОМ-Т-10"]
    assert rows[0]["patch"] == {"country": "Черногория"}
    assert "updatedAt" in rows[0]


def test_gvo_patch_merges_top_level_keys():
    ev = make_event("ОМ-Т-11")
    OpsGvoSummaryPatch.objects.create(
        event=ev, patch={"country": "X", "weapons": "нет"}
    )
    api, _ = manager("gvo-patcher")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-11/",
        {"section": "head", "values": {"country": "Y"}},
        format="json",
    )
    assert r.status_code == 200
    # Присланный ключ заменён, отсутствующий — не тронут.
    assert r.json()["patch"] == {"country": "Y", "weapons": "нет"}
    ev.refresh_from_db()
    assert ev.gvo_patch.patch == {"country": "Y", "weapons": "нет"}  # из БД


def test_gvo_patch_unknown_key_is_400():
    make_event("ОМ-Т-12")
    api, _ = manager("gvo-bad-patcher")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-12/",
        {"section": "head", "values": {"weird": 1}},
        format="json",
    )
    assert r.status_code == 400
    assert OpsGvoSummaryPatch.objects.count() == 0  # мусор не сохранён


def test_gvo_patch_unknown_om_code_is_404():
    api, _ = manager("gvo-lost-patcher")
    assert (
        api.patch(
            f"{GVO_URL}НЕТ-ТАКОГО/",
            {"section": "head", "values": {"country": "Y"}},
            format="json",
        )
    ).status_code == 404


def test_gvo_patch_denied_for_viewer():
    make_event("ОМ-Т-13")
    r = viewer("gvo-view-only").patch(
        f"{GVO_URL}ОМ-Т-13/",
        {"section": "head", "values": {"country": "Y"}},
        format="json",
    )
    assert r.status_code == 403


def test_gvo_reset_removes_only_section_keys():
    ev = make_event("ОМ-Т-14")
    OpsGvoSummaryPatch.objects.create(
        event=ev, patch={"country": "X", "weapons": "нет"}
    )
    assert (
        viewer("gvo-reset-viewer").post(
            f"{GVO_URL}ОМ-Т-14/reset/", {"section": "head"}, format="json"
        )
    ).status_code == 403
    api, _ = manager("gvo-resetter")
    r = api.post(f"{GVO_URL}ОМ-Т-14/reset/", {"section": "head"}, format="json")
    assert r.status_code == 200
    ev.refresh_from_db()
    # Снят только ключ раздела head (country); чужой ключ остался.
    assert ev.gvo_patch.patch == {"weapons": "нет"}


def test_gvo_reset_of_last_section_deletes_record():
    ev = make_event("ОМ-Т-16")
    OpsGvoSummaryPatch.objects.create(event=ev, patch={"country": "X"})
    api, _ = manager("gvo-last-resetter")
    r = api.post(f"{GVO_URL}ОМ-Т-16/reset/", {"section": "head"}, format="json")
    assert r.status_code == 200
    assert r.json()["patch"] == {}
    assert not OpsGvoSummaryPatch.objects.filter(event=ev).exists()


def test_gvo_patch_writes_new_audit_row():
    from organization_management.apps.operations.models_audit import OpsAuditLog

    make_event("ОМ-Т-15")
    before_pks = set(OpsAuditLog.objects.values_list("pk", flat=True))
    api, _ = manager("gvo-audited")
    assert (
        api.patch(
            f"{GVO_URL}ОМ-Т-15/",
            {"section": "head", "values": {"country": "Z"}},
            format="json",
        )
    ).status_code == 200
    new_rows = OpsAuditLog.objects.exclude(pk__in=before_pks)
    # Новый pk, не счётчик: строка именно ОБ ЭТОЙ правке.
    assert new_rows.filter(action="GVO_SUMMARY_PATCHED").count() == 1


def test_gvo_patch_rejects_retired_visits_section():
    """Раздел «Объекты посещения» патчем больше НЕ правится («Реестр ОМ-35.1»).

    Объекты посещения живут таблицей мероприятия; пока патч принимал ключ
    `visits`, у одного вопроса было два ответа, и они расходились молча.
    Отказ здесь громкий нарочно: молчаливое сохранение похоронило бы правку в
    списке, который никто не читает.
    """
    make_event("ОМ-Т-17")
    api, _ = manager("gvo-visits-retired")
    r = api.patch(
        f"{GVO_URL}ОМ-Т-17/",
        {"section": "visits", "values": {"visits": []}},
        format="json",
    )
    assert r.status_code == 400
    assert "visits" in str(r.json())
    r = api.post(f"{GVO_URL}ОМ-Т-17/reset/", {"section": "visits"}, format="json")
    assert r.status_code == 400


# ── Право правки сводки: старший ГВО и админ (Plane «Реестр ОМ-35.6») ────────


def _employee(last_name="Булатаев", first_name="Асхат"):
    from organization_management.apps.dictionaries.models import Rank
    from organization_management.apps.employees.models import Employee

    iin = str(970000000000 + Employee.objects.count())
    rank = Rank.objects.get_or_create(
        name="Подполковник", defaults={"level": 2, "code": "LTCOL"}
    )[0]
    return Employee.objects.create(
        personnel_number=f"G-{iin[-4:]}",
        last_name=last_name,
        first_name=first_name,
        birth_date="1985-01-01",
        gender="M",
        iin=iin,
        rank=rank,
        hire_date="2010-01-01",
        employment_status="working",
    )


def test_event_manage_alone_no_longer_edits_the_summary():
    """Ведущий мероприятие сводку НЕ правит: у неё своё право.

    Это и есть смысл задачи: раньше хватало `event.manage`. Персона взята с
    правом ведения ОМ нарочно — на персоне вообще без прав гейт был бы зелен и
    до правки.
    """
    make_event("ОМ-Т-20")
    api, _ = event_manager("gvo-only-event-manage")

    r = api.patch(
        f"{GVO_URL}ОМ-Т-20/",
        {"section": "head", "values": {"country": "Черногория"}},
        format="json",
    )
    assert r.status_code == 403
    r = api.post(f"{GVO_URL}ОМ-Т-20/reset/", {"section": "head"}, format="json")
    assert r.status_code == 403
    # ЧТЕНИЕ при этом остаётся: сводку смотрят и те, кто её не заполняет.
    assert api.get(GVO_URL).status_code == 200


def test_event_chief_edits_own_summary_without_gvo_manage():
    """Старший ГВО правит сводку СВОЕГО ОМ по роли в данных, а не по коду права.

    Проба держит обе половины: своё мероприятие правится, ЧУЖОЕ — нет. Без
    второй половины «право» означало бы «я где-то старший — правлю везде».
    """
    chief = _employee()
    mine = make_event("ОМ-Т-21")
    mine.chief_employee_id = chief.pk
    mine.chief_name = "Булатаев А."
    mine.save(update_fields=["chief_employee_id", "chief_name"])
    make_event("ОМ-Т-22")  # чужое: старшего нет

    # Права правки сводки у него НЕТ — только чтение реестра.
    api, user = client_for("gvo-chief", "VIEWER", ["event.view"])
    chief.user = user
    chief.save(update_fields=["user"])

    r = api.patch(
        f"{GVO_URL}ОМ-Т-21/",
        {"section": "head", "values": {"country": "Черногория"}},
        format="json",
    )
    assert r.status_code == 200
    assert r.json()["patch"]["country"] == "Черногория"

    # Чужое мероприятие — 403: старшинство не переносится на соседнее ОМ.
    r = api.patch(
        f"{GVO_URL}ОМ-Т-22/",
        {"section": "head", "values": {"country": "Черногория"}},
        format="json",
    )
    assert r.status_code == 403

    # И сброс своего раздела ему тоже открыт: «добавлять, редактировать,
    # удалять всё» — требование заказчика дословно.
    r = api.post(f"{GVO_URL}ОМ-Т-21/reset/", {"section": "head"}, format="json")
    assert r.status_code == 200


def test_unlinked_user_is_not_a_chief():
    """Учётка без кадровой привязки старшим не считается.

    `Employee.user` — единственное место, где связь существует; сопоставление
    по ФИО пустило бы тёзку в чужую сводку.
    """
    chief = _employee(last_name="Тлесов", first_name="Ерлан")
    event = make_event("ОМ-Т-23")
    event.chief_employee_id = chief.pk
    event.save(update_fields=["chief_employee_id"])

    api, _ = client_for("gvo-namesake", "VIEWER", ["event.view"])
    r = api.patch(
        f"{GVO_URL}ОМ-Т-23/",
        {"section": "head", "values": {"country": "Черногория"}},
        format="json",
    )
    assert r.status_code == 403



# ── Собранная сводка (Plane №166) ────────────────────────────────────────
#
# `list` отдаёт ПАТЧИ, `retrieve` — СОБРАННУЮ сводку. Разные вещи под одним
# адресом: патч нужен реестру (отличить «Заполнена» от «Черновика»), сводка —
# экрану, который её показывает.


def test_gvo_retrieve_assembles_the_summary_on_the_server():
    """Ручка отдаёт СОБРАННУЮ сводку, а не патч.

    До №166 базу считал браузер, а сервер хранил только правки. Значит
    содержимое экрана диктовал клиент, и две сборки уже разошлись на форме
    даты. Проба стережёт, что сборка пришла С СЕРВЕРА: в ответе есть поля,
    которых в патче нет вовсе.
    """
    event = make_event(code="ОМ-СБ-1")
    event.protected_person_name = "Иван Петров"
    event.owner_name = "Абенов"
    event.save(update_fields=["protected_person_name", "owner_name"])

    response = viewer("ops-gvo-sum-1").get(f"{GVO_URL}ОМ-СБ-1/")

    assert response.status_code == 200
    body = response.json()
    # Строка сводки, а не голая сводка: экрану нужен ещё и признак
    # «Заполнена», и считать его на клиенте значило бы снова завести правило
    # в двух местах.
    assert body["omCode"] == "ОМ-СБ-1"
    assert body["filled"] is False
    body = body["summary"]
    assert body["persons"][0]["name"] == "Иван Петров"
    assert body["responsible"]["name"] == "Абенов"
    # Деловая дата ОМ — в прибытии и убытии, В ТОЙ ЖЕ ФОРМЕ, что на экране:
    # суффикс «г.» — свойство документа, а не сводки.
    assert body["arrival"]["date"] == "21.08.2026"


def test_gvo_retrieve_merges_the_saved_patch():
    """Сохранённые правки уже слиты в ответ.

    Иначе экрану пришлось бы сливать их самому — то есть правило слияния жило
    бы в двух местах ровно так же, как жила сборка.
    """
    event = make_event(code="ОМ-СБ-2")
    OpsGvoSummaryPatch.objects.create(
        event=event, patch={"country": "Вымышляндия", "arrival": {"time": "12:00ч."}}
    )

    row = viewer("ops-gvo-sum-2").get(f"{GVO_URL}ОМ-СБ-2/").json()

    assert row["filled"] is True
    body = row["summary"]
    assert body["country"] == "Вымышляндия"
    assert body["arrival"]["time"] == "12:00ч."
    # Глубокое слияние: правка времени не стёрла дату соседним ключом.
    assert body["arrival"]["date"] == "21.08.2026"


def test_gvo_retrieve_of_unknown_om_code_is_404():
    """Мероприятия нет — внятный отказ, а не пустая сводка.

    Пустая сводка на несуществующий код читалась бы как «мероприятие есть, но
    ничего не заполнено», и опечатка в коде выглядела бы как рабочий экран.
    """
    response = viewer("ops-gvo-sum-3").get(f"{GVO_URL}ОМ-НЕТ-ТАКОГО/")

    assert response.status_code == 404


def test_gvo_retrieve_is_open_to_a_viewer_and_closed_to_nobody():
    """Читают сводку и те, кто её не правит; посторонний не читает.

    Гейт fail-closed: без персоны БЕЗ права закрытое состояние недостижимо и
    проба вакуумна.
    """
    make_event(code="ОМ-СБ-4")

    assert viewer("ops-gvo-sum-4").get(f"{GVO_URL}ОМ-СБ-4/").status_code == 200
    assert nobody("ops-gvo-sum-5").get(f"{GVO_URL}ОМ-СБ-4/").status_code == 403


def test_gvo_assembled_has_a_row_for_every_event_not_only_for_patched_ones():
    """Строка есть у КАЖДОГО мероприятия, а не только у правленых.

    У мероприятия без ручных правок сводка не пустая — она выведена из
    бюллетеня. Реестр, получивший строки только по правленым, показал бы
    остальные пустыми, хотя данные у них есть.
    """
    make_event(code="ОМ-СБ-6")
    patched = make_event(code="ОМ-СБ-7")
    OpsGvoSummaryPatch.objects.create(event=patched, patch={"country": "Вымышляндия"})

    rows = viewer("ops-gvo-sum-6").get(f"{GVO_URL}assembled/").json()["results"]

    by_code = {row["omCode"]: row for row in rows}
    assert {"ОМ-СБ-6", "ОМ-СБ-7"} <= set(by_code)
    # «Заполнена» против «Черновика» — по наличию ручных правок.
    assert by_code["ОМ-СБ-6"]["filled"] is False
    assert by_code["ОМ-СБ-7"]["filled"] is True
    assert by_code["ОМ-СБ-7"]["summary"]["country"] == "Вымышляндия"
    # У черновика сводка ВЫВЕДЕНА, а не пуста: дата на месте.
    assert by_code["ОМ-СБ-6"]["summary"]["arrival"]["date"] == "21.08.2026"


def test_gvo_assembled_does_not_query_the_database_once_per_event():
    """Сорок мероприятий — не сорок запросов за патчами.

    Сборка в цикле через `summary_for_event` ходила бы в базу на каждое ОМ, и
    реестр дорожал бы линейно от числа мероприятий — незаметно, пока их
    десяток.
    """
    from django.test.utils import CaptureQueriesContext
    from django.db import connection

    for number in range(6):
        make_event(code=f"ОМ-СБ-N{number}")

    api = viewer("ops-gvo-sum-7")
    with CaptureQueriesContext(connection) as queries:
        api.get(f"{GVO_URL}assembled/")
    heavy = len(queries)

    for number in range(6, 12):
        make_event(code=f"ОМ-СБ-N{number}")
    with CaptureQueriesContext(connection) as queries:
        api.get(f"{GVO_URL}assembled/")

    assert len(queries) == heavy, (
        "число запросов выросло вместе с числом мероприятий — сборка ходит в "
        "базу в цикле"
    )


def test_gvo_assembled_is_closed_to_nobody():
    """Тот же гейт, что у чтения сводки: `event.view` и не меньше."""
    make_event(code="ОМ-СБ-8")

    assert nobody("ops-gvo-sum-8").get(f"{GVO_URL}assembled/").status_code == 403
