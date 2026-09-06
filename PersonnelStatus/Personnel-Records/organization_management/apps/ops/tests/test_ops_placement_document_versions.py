"""Версии документа «Расстановка сил» и заморозка (`[СОГ-04]`, Plane №398).

Спецификация: «После согласования версия замораживается: правка невозможна;
любое изменение (замена человека и т.п.) = новая версия → повторное
согласование. Все версии хранятся, видны в „Истории версий“; отменённые
помечены».

Пробы стерегут:

1. завершение расстановки заводит версию 1 «Черновик» СТРОКОЙ истории;
2. первая отправка НЕ меняет номер — черновик становится «На согласовании»
   (`[СОГ-01]`); номер растёт только повторной отправкой после возврата
   (`[ВОЗ-06]`), и прежняя версия помечается отменённой;
3. согласование и возврат ставят статус ТЕКУЩЕЙ версии;
4. заморозка: пока объект не на «Расстановке», назначение, снятие и смена
   старшего сектора отбиваются — иначе подписанный состав менялся бы молча;
5. история отдаётся контрактом целиком, включая отменённые.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsPlacementDocumentVersion,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    chief_for,  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def staffed_event(manager):  # noqa: F811
    """ОМ на «Расстановке» с одним постом и ОДНИМ занятым местом на нём.

    Расстановка НЕ завершена — пробы завершают её сами, чтобы видеть, что
    именно завёл переход.
    """
    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба версий документа",
            "objectId": str(obj.pk),
            "businessDate": "2026-12-31",
            "kind": "INTERNAL",
            "chiefEmployeeId": str(chief_for(manager).pk),
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "state": "NORMAL"} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    posts = manager.get(base).json()["reconSectorPosts"]
    for post in posts:
        for _ in range(post["need"]):
            resp = manager.post(
                f"{base}placement/assign/",
                {"postId": post["id"], "employeeId": str(make_employee().pk)},
                format="json",
            )
            assert resp.status_code == 200, resp.content
    return base, event_id, posts


def _versions(event_id):
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    return list(visit.document_versions.order_by("number"))


def _send_and_return(manager, approver, base):  # noqa: F811
    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]
    # Возврат подписанта — ДЕЙСТВИЕ (`[СОГ-08]`, №399): объект уже на
    # «Расстановке», отдельного `approval/return/` не нужно.
    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "переделать"},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "PLACEMENT"


# ── Заведение и рост номера ─────────────────────────────────────────────────


def test_completing_placement_opens_version_one_as_a_draft(manager, staffed_event):  # noqa: F811
    base, event_id, _ = staffed_event

    resp = manager.post(f"{base}placement/complete/")

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [(1, "DRAFT")]
    assert rows[0].signature != "", "снимок состава пуст — подписывать нечего"
    assert rows[0].snapshot.get("assignments"), "снимок без назначений"
    visit_row = resp.json()["visitObjects"][0]
    assert visit_row["documentStatus"] == "DRAFT"
    assert visit_row["documentVersions"][0]["number"] == 1


def test_the_first_sending_keeps_the_number_and_submits_the_draft(
    manager, staffed_event  # noqa: F811
):
    """`[СОГ-01]`: Черновик → На согласовании — ТА ЖЕ версия. Номер растёт
    только повторной отправкой после возврата (`[ВОЗ-06]`)."""
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )

    resp = manager.post(f"{base}approval/send/")

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [(1, "SUBMITTED")]
    assert rows[0].sent_at is not None
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    assert visit.document_version == 1, "первая отправка накрутила номер"


def test_resending_after_a_return_opens_the_next_version(
    manager, approver, staffed_event  # noqa: F811
):
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    _send_and_return(manager, approver, base)
    manager.post(f"{base}placement/complete/")

    resp = manager.post(f"{base}approval/send/")

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [
        (1, "RETURNED"),
        (2, "SUBMITTED"),
    ]
    # Отменённая помечена, статус её не стёрт — история честная.
    assert rows[0].superseded_at is not None
    assert rows[1].superseded_at is None
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    assert visit.document_version == 2


def test_approving_marks_the_current_version(manager, approver, staffed_event):  # noqa: F811
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )
    manager.post(f"{base}approval/send/")
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]

    # Последняя подпись завершает согласование сама (`[СОГ-09]`, №399).
    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    rows = _versions(event_id)
    assert [(r.number, r.status) for r in rows] == [(1, "APPROVED")]
    assert rows[0].decided_at is not None
    assert resp.json()["visitObjects"][0]["documentStatus"] == "APPROVED"


# ── Заморозка ───────────────────────────────────────────────────────────────


def test_a_submitted_placement_cannot_be_changed(manager, staffed_event):  # noqa: F811
    """ОТПРАВЛЕННЫЙ документ менять нельзя: под ним подписываются.

    🔴 ПРОБА ПЕРЕВЁРНУТА В ПЕРВОЙ ПОЛОВИНЕ ОСОЗНАННО (Plane №533). Здесь
    заморозка проверялась СРАЗУ после `placement/complete/`, то есть когда
    документ ещё ЧЕРНОВИК и никому не отправлен. Это и был дефект: оператор не
    мог поправить собственную расстановку, а единственный путь разморозки
    требовал, чтобы согласующий вернул документ, которого он не получал.
    Спецификация `[СОГ-04]` говорит о ДОКУМЕНТЕ, а не об этапе: черновик
    правится, отправленный и согласованный — нет.

    Поэтому проба теперь проверяет ОБЕ границы: до отправки правка проходит,
    после отправки — отбивается. Одной второй половины мало: мутация
    «замораживать всегда» оставила бы её зелёной.
    """
    base, event_id, posts = staffed_event
    manager.post(f"{base}placement/complete/")

    # Предпосылка пробы названа ЯВНО: объект уже на «Согласовании», а документ
    # ещё черновик — именно это сочетание и запирало оператора.
    shown = manager.get(base).json()["visitObjects"][0]
    assert shown["documentStatus"] == "DRAFT", shown
    assert shown["stage"] == "APPROVAL", shown

    # Документ — черновик: правка своей же расстановки идёт.
    draft_edit = manager.post(
        f"{base}placement/assign/",
        {
            "postId": posts[0]["id"],
            "employeeId": str(make_employee().pk),
            "override": True,
            "override_reason": "усиление поста на время проверки",
        },
        format="json",
    )
    assert draft_edit.status_code == 200, draft_edit.content

    manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    )
    sent = manager.post(f"{base}approval/send/")
    assert sent.status_code == 200, sent.content
    assignment = manager.get(base).json()["placementAssignments"][0]

    assign = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[0]["id"], "employeeId": str(make_employee().pk)},
        format="json",
    )
    unassign = manager.delete(f"{base}placement/{assignment['id']}/")
    senior = manager.post(
        f"{base}placement/{assignment['id']}/senior/",
        {"senior": True},
        format="json",
    )

    for resp in (assign, unassign, senior):
        assert resp.status_code == 422, resp.content
        assert resp.json()["error_code"] == "PLACEMENT_FROZEN"


def test_a_returned_placement_is_editable_again(manager, approver, staffed_event):  # noqa: F811
    """Возврат размораживает: объект снова на «Расстановке», правка = будущая
    новая версия (`[СОГ-04]`)."""
    base, event_id, posts = staffed_event
    manager.post(f"{base}placement/complete/")
    _send_and_return(manager, approver, base)

    # Пост расписан фикстурой полностью, и добавка сверх расчёта — усиление
    # (Plane №414). Пробу интересует РАЗМОРОЗКА правки после возврата, а не
    # правило усиления, поэтому обоснование даётся сразу: иначе проба
    # проверяла бы 409 вместо того, ради чего написана.
    resp = manager.post(
        f"{base}placement/assign/",
        {
            "postId": posts[0]["id"],
            "employeeId": str(make_employee().pk),
            "override": True,
            "override_reason": "Усиление поста: проба правит расстановку после возврата",
        },
        format="json",
    )

    assert resp.status_code == 200, resp.content


def test_the_history_is_served_whole_including_superseded(
    manager, approver, staffed_event  # noqa: F811
):
    base, event_id, _ = staffed_event
    manager.post(f"{base}placement/complete/")
    _send_and_return(manager, approver, base)
    manager.post(f"{base}placement/complete/")
    manager.post(f"{base}approval/send/")

    rows = manager.get(base).json()["visitObjects"][0]["documentVersions"]

    assert [(r["number"], r["status"]) for r in rows] == [
        (1, "RETURNED"),
        (2, "SUBMITTED"),
    ]
    assert rows[0]["supersededAt"] is not None
    assert rows[1]["supersededAt"] is None


def test_the_api_and_the_service_answer_the_same_status_without_version_rows(
    manager, staffed_event  # noqa: F811
):
    """Объект БЕЗ строк версий: API отвечает то же, что сервис (Plane №864).

    ЧТО СТЕРЕГУТ ЭТИ ДВЕ ПРОВЕРКИ. Таблица версий появилась в №396/№411, и
    бэкфилла у неё нет намеренно — история начинается «с этого момента».
    Поэтому у объекта без строки статус ВЫВОДИТСЯ из его же полей
    (`document_status_of`). Сериализатор считал его своим способом и в этом
    состоянии отвечал `null`: карточка объекта показывала
    `documentStatus: null`, а отказ `placement/assign/` по тому же объекту в
    том же ответе — `SUBMITTED`. Два ответа на один вопрос.

    🔴 КРАСНОТА НА МУТАЦИИ: верни в `api/serializers.py::_document_status`
    собственный расчёт (`current.status if current is not None else None`) —
    первая проверка покраснеет на `None`, вторая на расхождении с сервисом.
    """
    from organization_management.apps.ops import security_events as service

    base, event_id, _ = staffed_event

    row = manager.get(base).json()["visitObjects"][0]
    visit = OpsSecurityEventVisitObject.objects.get(pk=row["id"])
    assert not visit.document_versions.exists(), "проба вакуумна: строки версий уже есть"

    assert row["documentStatus"] == "DRAFT"
    assert row["documentStatus"] == service.document_status_of(visit)


def test_the_version_diff_names_a_post_the_same_way_everywhere():
    """История версий печатает подпись поста ОБЩЕЙ функцией (Plane №875).

    ЧТО БЫЛО. `document_version_diff` собирал «сектор · пост» ТРЕТЬЕЙ копией
    склейки, и она расходилась с общей `post_label` на трёх входах из
    четырёх: у поста без номера давала «Периметр · », без сектора — « · Пост
    3», без обоих — « · », то есть разделитель без сторон. Читает эту строку
    человек — в истории версий документа (`[ВОЗ-06]`) и в деле согласования.

    🔴 ЧТО ПРОВЕРЯЕТСЯ, А ЧТО НЕТ. Проверяется ПЕЧАТЬ. Сравнение версий
    подписью не управляется — ключом там идёт идентификатор поста, — и
    отдельной пробы на «пост не потерял сам себя между версиями» здесь не
    нужно: она проверяла бы не эту правку.

    КРАСНАЯ ПРОБА: верни в `posts_of` склейку
    `f"{p.get('sector','')} · {p.get('post','')}"` — покраснеют все три
    вырожденных случая разом.
    """
    from organization_management.apps.ops import security_events as service

    previous = {"posts": [], "assignments": []}
    current = {
        "posts": [
            {"id": "p1", "sector": "Периметр", "post": "Пост 1"},
            {"id": "p2", "sector": "Периметр", "post": ""},
            {"id": "p3", "sector": "", "post": "Пост 3"},
            {"id": "p4", "sector": "", "post": ""},
        ],
        "assignments": [],
    }

    added = service.document_version_diff(previous, current)["addedPosts"]

    assert added == ["Периметр · Пост 1", "Периметр", "Пост 3", "p4"], added
    # И то же самое — общей функцией: подпись обязана быть ОДНОЙ, а не
    # «похожей».
    assert added == [
        service.post_label(post) for post in current["posts"]
    ]


# ── Кто подписан автором версии ─────────────────────────────────────────────


def test_the_version_names_the_author_by_surname_not_by_login(
    manager, staffed_event  # noqa: F811
):
    """Фамилия доезжает ОТ РУЧКИ ДО ПОЛЯ, а не только из функции (Plane №484).

    🔴 ЗАЧЕМ ЭТА ПРОБА, ЕСЛИ ЕСТЬ `test_ops_actor_display_name` (найдено ревью
    №825). Та проверяет саму функцию, а жалоба карточки была о другом: в
    «Истории версий документа» на подписываемой «Расстановке сил» стоял
    `admin` вместо фамилии. Путь от ручки до поля длинный —
    `views.complete_placement(actor=request.user)` → `_submit_document_version`
    → `created_by=actor_display_name(actor)` → сериализатор `createdBy` →
    экран `ApprovalStage`, — и до этой пробы он не был закреплён НИГДЕ:
    `created_by` встречался в пробах только как аргумент фикстуры. Мутация
    `views.py` «`actor=request.user` → `actor=None`» оставляла поле пустым, и
    не краснела ни одна проба.

    Красная на своей мутации: снять ветку `isinstance` в
    `actor_display_name` — вернётся `ev-manager`.
    """
    base, event_id, _ = staffed_event
    # Кадровая запись ЗА учёткой ведущего у фикстуры уже есть (`chief_for`
    # связала старшего объекта с её пользователем) — ей даётся говорящая
    # фамилия, чтобы разница между «Ниязов П.» и `ev-manager` читалась в
    # ассерте, а не выводилась из умолчаний фикстуры.
    author = chief_for(manager)
    author.last_name, author.first_name = "Ниязов", "Пётр"
    author.save(update_fields=["last_name", "first_name"])

    resp = manager.post(f"{base}placement/complete/")

    assert resp.status_code == 200, resp.content
    version = resp.json()["visitObjects"][0]["documentVersions"][0]
    assert version["createdBy"] == "Ниязов П.", (
        "в «кем создана версия» подписываемого документа стоит не фамилия: "
        f"{version['createdBy']!r}"
    )
    # И то же самое в хранилище, а не только в ответе ручки.
    assert _versions(event_id)[0].created_by == "Ниязов П."
