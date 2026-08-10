"""Срез J: обратная связь (§28).

Контрактные свойства:
- чужой ЧЕРНОВИК не виден никому, кроме автора, — даже обладателю права
  видеть все обращения: отправки не было;
- конфиденциальность закрывает СОДЕРЖАНИЕ (описание, превью, шаги, контакт,
  вложения, техинформация), но не тему/тип/статус/модуль; вырезает СЕРВЕР;
- область поиска — только видимые смотрящему поля: по вырезанному описанию
  обращение не находится (иначе поиск выдавал бы содержимое фактом
  совпадения);
- сводка — по всему видимому набору, ДО фильтров и страниц;
- техническая информация сохраняется ТОЛЬКО при явном согласии автора;
  вложения — РОВНО метаданные, лишние поля тела не сохраняются;
- внутренняя заметка и её событие скрываются от не-обладателя права ЦЕЛИКОМ;
- действия карточки считает сервер; замок закрытого — ПЕРВЫМ и одинаково;
- переходы статусов — по карте справочника; терминальный через разбор
  отклоняется (закрытие — отдельная операция с ответом автору);
- лента пишется диффом: разбор одной операцией даёт события по каждому
  изменённому полю.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.models_feedback import (
    OpsFeedbackComment,
    OpsFeedbackEvent,
    OpsFeedbackRequest,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

LIST = "/api/ops/feedback-requests/"


def detail(pk):
    return f"{LIST}{pk}/"


@pytest.fixture
def seeded(db):
    call_command("seed_operations", verbosity=0)


@pytest.fixture
def viewer(seeded):
    api, user = client_for("fb-viewer", "FB_VIEW", perms=("feedback.view",))
    return api, str(user.pk)


@pytest.fixture
def author(seeded):
    api, user = client_for(
        "fb-author", "FB_AUTHOR", perms=("feedback.view", "feedback.create"),
    )
    return api, str(user.pk)


@pytest.fixture
def view_all(seeded):
    api, user = client_for(
        "fb-view-all", "FB_ALL", perms=("feedback.view", "feedback.view_all"),
    )
    return api, str(user.pk)


@pytest.fixture
def confidential_reader(seeded):
    api, _ = client_for(
        "fb-confidential", "FB_CONF",
        perms=(
            "feedback.view", "feedback.view_all",
            "feedback.view_confidential",
        ),
    )
    return api


@pytest.fixture
def triager(seeded):
    api, user = client_for(
        "fb-triager", "FB_TRIAGE",
        perms=("feedback.view", "feedback.view_all", "feedback.triage"),
    )
    return api, str(user.pk)


@pytest.fixture
def internal_reader(seeded):
    api, _ = client_for(
        "fb-internal", "FB_NOTE",
        perms=(
            "feedback.view", "feedback.view_all", "feedback.internal_note",
        ),
    )
    return api


def seeded_by_subject(subject):
    return OpsFeedbackRequest.objects.get(subject=subject)


CONFIDENTIAL_SUBJECT = "Обращение по доступу"
DRAFT_SUBJECT = "Черновик обращения аналитика"
CLOSED_SUBJECT = "Как отменить смену без удаления"
NEW_SUBJECT = CONFIDENTIAL_SUBJECT  # единственное сеяное в статусе NEW


def make_body(**overrides):
    body = {
        "subject": "Своё обращение",
        "description": "Подробное описание проблемы.",
        "typeCode": "BUG",
        "priorityCode": "NORMAL",
        "moduleCode": "OTHER",
        "expectedResult": None,
        "reproductionSteps": None,
        "contact": None,
        "confidential": False,
        "relatedRoute": None,
        "attachments": [],
        "includeTechnicalInfo": False,
        "technicalInfo": None,
        "saveAsDraft": False,
    }
    body.update(overrides)
    return body


# ── Видимость и вырезание ──────────────────────────────────────────────────


def test_viewer_without_view_all_sees_nothing_foreign(viewer):
    api, _ = viewer
    data = api.get(LIST).json()
    assert data["totalVisible"] == 0
    assert data["results"] == []
    # Пустой реестр — всё равно одна (пустая) страница.
    assert data["pageCount"] == 1


def test_foreign_draft_hidden_even_with_view_all(view_all):
    api, _ = view_all
    data = api.get(LIST).json()
    subjects = {
        row["subject"]
        for page in range(1, data["pageCount"] + 1)
        for row in api.get(f"{LIST}?page={page}").json()["results"]
    }
    assert DRAFT_SUBJECT not in subjects
    # Видимых — восемь из девяти сеяных: спрятан ровно черновик.
    assert data["totalVisible"] == 8
    draft = seeded_by_subject(DRAFT_SUBJECT)
    assert api.get(detail(draft.pk)).status_code == 404


def test_confidential_content_cut_by_server(view_all):
    api, _ = view_all
    row = seeded_by_subject(CONFIDENTIAL_SUBJECT)
    data = api.get(detail(row.pk)).json()["request"]
    # Тема/тип/статус/модуль остаются — реестр обязан остаться реестром.
    assert data["subject"] == CONFIDENTIAL_SUBJECT
    assert data["statusCode"] == "NEW"
    # Содержание вырезано ЦЕЛИКОМ, включая производное превью и вложения.
    for field in (
        "description", "descriptionPreview", "expectedResult",
        "reproductionSteps", "contact", "relatedRoute", "attachments",
        "technicalInfo",
    ):
        assert data[field] is None, field
    assert data["restrictedReason"] is not None


def test_confidential_content_visible_with_right(confidential_reader):
    row = seeded_by_subject(CONFIDENTIAL_SUBJECT)
    data = confidential_reader.get(detail(row.pk)).json()["request"]
    assert data["description"] is not None
    assert data["restrictedReason"] is None
    assert data["descriptionPreview"].startswith("Прошу разобраться")


def test_search_does_not_match_cut_description(view_all, confidential_reader):
    # Слово встречается ТОЛЬКО в закрытом описании, не в теме.
    api, _ = view_all
    assert api.get(f"{LIST}?search=разграничение").json()["totalMatched"] == 0
    matched = confidential_reader.get(
        f"{LIST}?search=разграничение"
    ).json()["totalMatched"]
    assert matched == 1


# ── Сводка и страницы ──────────────────────────────────────────────────────


def test_stats_over_visible_set_before_filters(view_all):
    api, _ = view_all
    data = api.get(f"{LIST}?type=BUG").json()
    assert data["totalMatched"] == 2
    # Сводка не сузилась вместе с фильтром.
    assert data["stats"]["total"] == 8
    by_status = {
        item["statusCode"]: item["count"] for item in data["stats"]["byStatus"]
    }
    assert by_status["DRAFT"] == 0  # черновик не виден — и не посчитан
    assert by_status["NEW"] == 1


def test_pagination_and_page_overflow(view_all):
    api, _ = view_all
    first = api.get(LIST).json()
    assert first["pageSize"] == 4
    assert first["pageCount"] == 2
    assert len(first["results"]) == 4
    # Страница за пределами набора — последняя, а не ошибка.
    overflow = api.get(f"{LIST}?page=99").json()
    assert overflow["page"] == 2
    assert len(overflow["results"]) == 4


def test_mine_filter(author):
    api, _ = author
    api.post(LIST, make_body(), format="json")
    data = api.get(f"{LIST}?mine=true").json()
    assert data["totalMatched"] == 1
    assert data["results"][0]["isOwn"] is True


# ── Создание и отправка ────────────────────────────────────────────────────


def test_create_draft_and_technical_info_consent(author):
    api, _ = author
    tech = {
        "appRevision": "r1", "viewport": "800×600",
        "platform": "desktop", "capturedAt": "2026-08-10T10:00:00+05:00",
    }
    response = api.post(
        LIST,
        make_body(saveAsDraft=True, includeTechnicalInfo=False,
                  technicalInfo=tech),
        format="json",
    )
    assert response.status_code == 200
    created = response.json()
    assert created["statusCode"] == "DRAFT"
    assert created["submittedAt"] is None
    row = OpsFeedbackRequest.objects.get(pk=created["feedbackId"])
    # Согласия не было — присланная техинформация НЕ сохранена (null, а не
    # пустой объект: «не собирали», а не «собрали и не нашли»).
    assert row.technical_info is None
    assert row.submitted_at is None


def test_create_attachment_keeps_exactly_metadata(author):
    api, _ = author
    response = api.post(
        LIST,
        make_body(attachments=[{
            "fileName": "a.png", "sizeBytes": 10, "mimeType": "image/png",
            # Лишнее поле тела (содержимое) месту в записи не находит.
            "content": "base64-данные",
        }]),
        format="json",
    )
    row = OpsFeedbackRequest.objects.get(pk=response.json()["feedbackId"])
    # Ассерт по ВСЕМУ значению: вырезание производных проверяется целым
    # JSON, а не поиском знакомых ключей.
    assert row.attachments == [
        {"fileName": "a.png", "sizeBytes": 10, "mimeType": "image/png"}
    ]


def test_create_unknown_module_rejected(author):
    api, _ = author
    response = api.post(
        LIST, make_body(moduleCode="NO_SUCH"), format="json"
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_submit_own_draft_and_resubmit(author):
    api, _ = author
    created = api.post(
        LIST, make_body(saveAsDraft=True), format="json"
    ).json()
    pk = created["feedbackId"]
    submitted = api.post(f"{LIST}{pk}/submit/").json()
    assert submitted["statusCode"] == "NEW"
    row = OpsFeedbackRequest.objects.get(pk=pk)
    assert row.status_code == "NEW"
    assert row.submitted_at is not None
    assert list(
        row.events.values_list("kind", flat=True)
    ) == ["CREATED", "SUBMITTED"]
    second = api.post(f"{LIST}{pk}/submit/")
    assert second.status_code == 422
    assert second.json()["error_code"] == "FEEDBACK_ALREADY_SUBMITTED"


def test_submit_foreign_draft_is_404(author):
    api, _ = author
    draft = seeded_by_subject(DRAFT_SUBJECT)
    assert api.post(f"{LIST}{draft.pk}/submit/").status_code == 404


# ── Карточка: заметки, действия ────────────────────────────────────────────


def test_internal_note_hidden_entirely_without_right(view_all):
    api, _ = view_all
    row = seeded_by_subject(
        "Не открывается карточка мероприятия по прямой ссылке"
    )
    response = api.get(detail(row.pk))
    payload = response.json()
    kinds = {c["kind"] for c in payload["comments"]}
    assert kinds == {"PUBLIC_REPLY"}
    event_kinds = {e["kind"] for e in payload["timeline"]}
    assert "INTERNAL_NOTE_ADDED" not in event_kinds
    # Слово из заметки не просачивается НИ ОДНИМ полем ответа.
    assert "регрессия" not in response.content.decode("utf-8")


def test_internal_note_visible_with_right(internal_reader):
    row = seeded_by_subject(
        "Не открывается карточка мероприятия по прямой ссылке"
    )
    payload = internal_reader.get(detail(row.pk)).json()
    assert {c["kind"] for c in payload["comments"]} == {
        "PUBLIC_REPLY", "INTERNAL_NOTE",
    }
    assert "INTERNAL_NOTE_ADDED" in {e["kind"] for e in payload["timeline"]}


def test_closed_lock_is_first_for_all_actions(triager):
    api, _ = triager
    row = seeded_by_subject(CLOSED_SUBJECT)
    actions = api.get(detail(row.pk)).json()["actions"]
    assert len(actions) == 4
    # Замок закрытого — первым и ОДИНАКОВО, даже для обладателя права
    # разбора: причина не зависит от прав смотрящего.
    for action in actions:
        assert action["available"] is False
        assert "закрыто" in action["reason"]
    assert api.get(detail(row.pk)).json()["allowedStatuses"] == []


def test_actions_reflect_actor_rights(triager, view_all):
    row = seeded_by_subject(NEW_SUBJECT)
    api, _ = triager
    by_code = {
        a["code"]: a for a in api.get(detail(row.pk)).json()["actions"]
    }
    assert by_code["TRIAGE"]["available"] is True
    assert by_code["ADD_INTERNAL_NOTE"]["available"] is False
    reader, _ = view_all
    by_code = {
        a["code"]: a for a in reader.get(detail(row.pk)).json()["actions"]
    }
    assert by_code["TRIAGE"]["available"] is False
    assert by_code["ADD_PUBLIC_REPLY"]["available"] is False  # не автор


# ── Комментарии ────────────────────────────────────────────────────────────


def test_internal_note_requires_right(view_all):
    api, _ = view_all
    row = seeded_by_subject(NEW_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/comments/",
        {"kind": "INTERNAL_NOTE", "body": "заметка"},
        format="json",
    )
    assert response.status_code == 403


def test_public_reply_by_author_allowed(author):
    api, _ = author
    created = api.post(LIST, make_body(), format="json").json()
    pk = created["feedbackId"]
    response = api.post(
        f"{LIST}{pk}/comments/",
        {"kind": "PUBLIC_REPLY", "body": "дополняю обращение"},
        format="json",
    )
    assert response.status_code == 200
    row = OpsFeedbackRequest.objects.get(pk=pk)
    assert row.comments.get().kind == "PUBLIC_REPLY"
    assert "PUBLIC_REPLY_ADDED" in set(
        row.events.values_list("kind", flat=True)
    )


def test_comment_on_closed_rejected(triager):
    api, _ = triager
    row = seeded_by_subject(CLOSED_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/comments/",
        {"kind": "PUBLIC_REPLY", "body": "поздно"},
        format="json",
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "FEEDBACK_CLOSED"


# ── Разбор ─────────────────────────────────────────────────────────────────


def test_triage_requires_permission(view_all):
    api, _ = view_all
    row = seeded_by_subject(NEW_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/triage/", {"statusCode": "IN_REVIEW"}, format="json"
    )
    assert response.status_code == 403


def test_triage_transition_checked_against_map(triager):
    api, _ = triager
    row = seeded_by_subject(NEW_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/triage/", {"statusCode": "ACCEPTED"}, format="json"
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "FEEDBACK_TRANSITION_NOT_ALLOWED"


def test_triage_refuses_terminal_status(triager):
    api, _ = triager
    row = seeded_by_subject(NEW_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/triage/", {"statusCode": "REJECTED"}, format="json"
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "FEEDBACK_USE_CLOSE"


def test_triage_writes_diff_events_and_persists(triager):
    api, actor = triager
    row = seeded_by_subject(NEW_SUBJECT)
    snapshot = row.updated_at
    response = api.post(
        f"{LIST}{row.pk}/triage/",
        {
            "statusCode": "IN_REVIEW",
            "assigneeUserId": "demo-objects-admin",
            "workingPriorityCode": "HIGH",
        },
        format="json",
    )
    assert response.status_code == 200
    row.refresh_from_db()
    assert row.status_code == "IN_REVIEW"
    assert row.assignee_user_id == "demo-objects-admin"
    # Подпись назначенного — уже известная в обращениях, а не голый id.
    assert row.assignee_label == "Ведение объектов"
    assert row.working_priority_code == "HIGH"
    assert row.updated_at > snapshot
    kinds = list(
        OpsFeedbackEvent.objects.filter(request=row)
        .order_by("at", "id")
        .values_list("kind", flat=True)
    )
    # Один поступок разбора — событие по КАЖДОМУ изменённому полю.
    assert kinds[-3:] == [
        "STATUS_CHANGED", "WORKING_PRIORITY_SET", "ASSIGNED",
    ]
    status_event = OpsFeedbackEvent.objects.filter(
        request=row, kind="STATUS_CHANGED"
    ).latest("id")
    assert status_event.old_value == "NEW"
    assert status_event.new_value == "IN_REVIEW"


def test_triage_absent_key_means_keep(triager):
    api, _ = triager
    row = seeded_by_subject(
        "Не открывается карточка мероприятия по прямой ссылке"
    )
    # Тело без ключей ничего не меняет — и не пишет ни одного события.
    before = OpsFeedbackEvent.objects.filter(request=row).count()
    assert api.post(
        f"{LIST}{row.pk}/triage/", {}, format="json"
    ).status_code == 200
    row.refresh_from_db()
    assert row.assignee_user_id == "demo-objects-admin"
    assert OpsFeedbackEvent.objects.filter(request=row).count() == before
    # null — «снять»: снятие ответственного — такое же событие, как
    # назначение.
    api.post(
        f"{LIST}{row.pk}/triage/", {"assigneeUserId": None}, format="json"
    )
    row.refresh_from_db()
    assert row.assignee_user_id is None
    unassigned = OpsFeedbackEvent.objects.filter(request=row).latest("id")
    assert unassigned.kind == "ASSIGNED"
    assert unassigned.old_value == "demo-objects-admin"
    assert unassigned.new_value is None


# ── Закрытие ───────────────────────────────────────────────────────────────


def test_close_requires_public_reply(triager):
    api, _ = triager
    row = seeded_by_subject(NEW_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/close/",
        {"statusCode": "REJECTED", "publicReply": "  "},
        format="json",
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_close_duplicate_requires_visible_original(triager):
    api, _ = triager
    row = seeded_by_subject(NEW_SUBJECT)
    no_target = api.post(
        f"{LIST}{row.pk}/close/",
        {"statusCode": "DUPLICATE", "publicReply": "дубль"},
        format="json",
    )
    assert no_target.status_code == 422
    self_target = api.post(
        f"{LIST}{row.pk}/close/",
        {
            "statusCode": "DUPLICATE",
            "duplicateOfId": str(row.pk),
            "publicReply": "дубль",
        },
        format="json",
    )
    assert self_target.status_code == 422
    # Оригинал, невидимый закрывающему (чужой черновик), — 404.
    draft = seeded_by_subject(DRAFT_SUBJECT)
    hidden = api.post(
        f"{LIST}{row.pk}/close/",
        {
            "statusCode": "DUPLICATE",
            "duplicateOfId": str(draft.pk),
            "publicReply": "дубль",
        },
        format="json",
    )
    assert hidden.status_code == 404


def test_close_writes_reply_comment_and_events(triager):
    api, _ = triager
    row = seeded_by_subject(NEW_SUBJECT)
    response = api.post(
        f"{LIST}{row.pk}/close/",
        {"statusCode": "REJECTED", "publicReply": "Не воспроизводится."},
        format="json",
    )
    assert response.status_code == 200
    row.refresh_from_db()
    assert row.status_code == "REJECTED"
    reply = OpsFeedbackComment.objects.filter(request=row).latest("id")
    assert reply.kind == "PUBLIC_REPLY"
    assert reply.body == "Не воспроизводится."
    kinds = list(
        OpsFeedbackEvent.objects.filter(request=row)
        .order_by("at", "id")
        .values_list("kind", flat=True)
    )
    # Закрытие — отдельный вид события, а не «ещё одна смена статуса».
    assert kinds[-2:] == ["PUBLIC_REPLY_ADDED", "CLOSED"]
    # Закрытое обращение больше не принимает разбора.
    late = api.post(
        f"{LIST}{row.pk}/triage/", {"statusCode": "IN_REVIEW"}, format="json"
    )
    assert late.status_code == 422
    assert late.json()["error_code"] == "FEEDBACK_CLOSED"


def test_duplicate_link_hides_invisible_original(view_all, author):
    # Дубликат ссылается на оригинал; если оригинал невидим смотрящему,
    # тема скрывается, а причина называется.
    api, _ = view_all
    dup = seeded_by_subject("Повтор обращения про карточку мероприятия")
    link = api.get(detail(dup.pk)).json()["duplicateOf"]
    assert link["subject"] is not None  # оригинал видим обладателю view_all
    # Автору без view_all не видны ни дубликат, ни оригинал — сама карточка
    # дубликата 404: чужое обращение.
    own_api, _ = author
    assert own_api.get(detail(dup.pk)).status_code == 404
