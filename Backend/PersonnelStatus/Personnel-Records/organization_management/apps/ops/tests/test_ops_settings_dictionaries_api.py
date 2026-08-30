"""Срез D1: настройки (владелец политик), справочники, аудит раздела ОМ.

Ключевое свойство настроек — СКВОЗНАЯ запись в политику-потребитель: правка
passport.*/conflict.rest_after_duty.mode в той же транзакции обновляет
синглтон политики и его версию, и следующий расчёт (свежесть паспорта,
конфликт отдыха) идёт уже по новой версии. Это и проверяется цепочкой
целиком, а не изолированной правкой строки.
"""
import pytest

from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy,
)
from organization_management.apps.operations.models_object import (
    OpsPassportFreshnessPolicy,
)
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
    OpsPolicySectionVersion,
    OpsPolicySetting,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    make_object,
)

pytestmark = pytest.mark.django_db

SETTINGS = "/api/ops/settings/"
DICTS = "/api/ops/dictionaries/"


@pytest.fixture(autouse=True)
def seeded(db):
    OpsPolicySetting.objects.create(
        setting_code="passport.due_soon_percent",
        section_code="PASSPORT_FRESHNESS", kind="NUMBER", value_type="PERCENT",
        safe_label="Порог «скоро проверка»", description="",
        value=25, min_value=5, max_value=50, options=None,
        editable=True, locked_reason=None,
    )
    OpsPolicySetting.objects.create(
        setting_code="conflict.rest_after_duty.mode",
        section_code="CONFLICT_RULES", kind="CHOICE", value_type="MODE",
        safe_label="Отдых после дежурства", description="",
        value="SOFT_OVERRIDE", min_value=None, max_value=None,
        options=[
            {"value": "SOFT_OVERRIDE", "safeLabel": "Обход с обоснованием",
             "description": ""},
            {"value": "HARD_BLOCK", "safeLabel": "Жёсткая блокировка",
             "description": ""},
        ],
        editable=True, locked_reason=None,
    )
    OpsPolicySetting.objects.create(
        setting_code="conflict.duty_overlap.mode",
        section_code="CONFLICT_RULES", kind="CHOICE", value_type="MODE",
        safe_label="Пересечение дежурств", description="",
        value="HARD_BLOCK", min_value=None, max_value=None,
        options=[{"value": "HARD_BLOCK", "safeLabel": "Жёсткая блокировка",
                  "description": ""}],
        editable=False,
        locked_reason="Жёсткий запрет пересечения нельзя ослабить никому.",
    )
    OpsPolicySectionVersion.objects.create(
        section_code="PASSPORT_FRESHNESS", version="fp-v1"
    )
    OpsPolicySectionVersion.objects.create(
        section_code="CONFLICT_RULES", version="cp-v1"
    )
    OpsPassportFreshnessPolicy.objects.create(
        singleton_key=1, version="fp-v1",
        verification_interval_days=120, due_soon_percent=25,
    )
    OpsDutyConflictPolicy.objects.create(
        singleton_key=1, version="cp-v1", rest_after_duty_mode="SOFT_OVERRIDE"
    )


@pytest.fixture
def admin_api():
    api, _ = client_for(
        "ops-settings-admin", "OPS_ADMIN",
        perms=("settings.view", "settings.manage",
               "dictionary.view", "dictionary.manage", "audit.view",
               "object.view"),
    )
    return api


@pytest.fixture
def viewer_api():
    api, _ = client_for(
        "ops-settings-viewer", "OPS_VIEWER",
        perms=("settings.view", "dictionary.view"),
    )
    return api


# ── Настройки ────────────────────────────────────────────────────────────────


def test_list_carries_actions_and_versions(viewer_api):
    data = viewer_api.get(SETTINGS).json()
    by_code = {s["settingCode"]: s for s in data["results"]}
    locked = by_code["conflict.duty_overlap.mode"]
    assert locked["action"] == {
        "canEdit": False,
        "disabledReason": "Жёсткий запрет пересечения нельзя ослабить никому.",
    }
    editable = by_code["passport.due_soon_percent"]
    # право правки решает сервер: у наблюдателя причина — нехватка права
    assert editable["action"]["canEdit"] is False
    assert "ops.settings.manage" in editable["action"]["disabledReason"]
    assert data["sectionVersions"]["PASSPORT_FRESHNESS"] == "fp-v1"


def test_update_writes_through_to_freshness_policy(admin_api):
    resp = admin_api.patch(
        f"{SETTINGS}passport.due_soon_percent/",
        {"value": 40, "reason": "смягчение порога"},
        format="json",
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["setting"]["value"] == 40
    assert data["sectionVersions"]["PASSPORT_FRESHNESS"] == "fp-v2"
    assert data["event"]["oldValue"] == "25 %"
    assert data["event"]["newValue"] == "40 %"
    assert data["event"]["policyVersionAfter"] == "fp-v2"
    # сквозная запись: потребитель читает новое значение И новую версию
    policy = OpsPassportFreshnessPolicy.objects.get(singleton_key=1)
    assert (policy.due_soon_percent, policy.version) == (40, "fp-v2")
    # и живой расчёт свежести подписан новой версией
    make_object(with_passport=True)
    freshness = admin_api.get("/api/ops/objects/").json()["freshness"][0]
    assert freshness["freshnessPolicyVersion"] == "fp-v2"


def test_update_mode_writes_through_to_conflict_policy(admin_api):
    resp = admin_api.patch(
        f"{SETTINGS}conflict.rest_after_duty.mode/",
        {"value": "HARD_BLOCK", "reason": "ужесточение"},
        format="json",
    )
    assert resp.status_code == 200
    policy = OpsDutyConflictPolicy.objects.get(singleton_key=1)
    assert (policy.rest_after_duty_mode, policy.version) == (
        "HARD_BLOCK", "cp-v2",
    )
    assert resp.json()["event"]["newValue"] == "Жёсткая блокировка"


def test_update_guards(admin_api, viewer_api):
    resp = admin_api.patch(
        f"{SETTINGS}conflict.duty_overlap.mode/",
        {"value": "HARD_BLOCK", "reason": "x"},
        format="json",
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "SETTING_LOCKED"
    resp = admin_api.patch(
        f"{SETTINGS}passport.due_soon_percent/",
        {"value": 99, "reason": "вне диапазона"},
        format="json",
    )
    assert resp.status_code == 400
    assert "от 5 до 50" in resp.json()["details"]["value"][0]
    resp = admin_api.patch(
        f"{SETTINGS}passport.due_soon_percent/",
        {"value": 30, "reason": " "},
        format="json",
    )
    assert resp.json()["details"]["reason"] == ["Укажите причину изменения."]
    # без права правка запрещена гейтом
    resp = viewer_api.patch(
        f"{SETTINGS}passport.due_soon_percent/",
        {"value": 30, "reason": "нет права"},
        format="json",
    )
    assert resp.status_code == 403
    # отклонённые правки не тронули ни значение, ни версию
    assert OpsPolicySetting.objects.get(
        setting_code="passport.due_soon_percent"
    ).value == 25
    assert OpsPolicySectionVersion.objects.get(
        section_code="PASSPORT_FRESHNESS"
    ).version == "fp-v1"


def test_change_log_lists_events_newest_first(admin_api):
    for value, reason in [(30, "первая"), (35, "вторая")]:
        admin_api.patch(
            f"{SETTINGS}passport.due_soon_percent/",
            {"value": value, "reason": reason},
            format="json",
        )
    events = admin_api.get("/api/ops/setting-changes/").json()["results"]
    assert [e["reason"] for e in events] == ["вторая", "первая"]
    assert events[0]["policyVersionAfter"] == "fp-v3"


# ── Справочники ──────────────────────────────────────────────────────────────


def seed_dictionary():
    group = OpsDictionaryEntry.objects.create(
        dictionary_code="POST_REQUIREMENT_GROUPS", code="ACCESS",
        label="Допуски", description="", is_active=True, group_code=None,
    )
    req = OpsDictionaryEntry.objects.create(
        dictionary_code="POST_REQUIREMENTS", code="ACCESS_A",
        label="Допуск «Объект A»", description="", is_active=True,
        group_code="ACCESS",
    )
    free = OpsDictionaryEntry.objects.create(
        dictionary_code="RETURN_REASONS", code="UNDERSTAFFED",
        label="Посты недоукомплектованы", description="", is_active=True,
        group_code=None,
    )
    return group, req, free


def test_definitions_with_counts(viewer_api):
    seed_dictionary()
    data = viewer_api.get(DICTS).json()["results"]
    by_code = {d["code"]: d for d in data}
    # Закрытый мир справочников: число правится ОСОЗНАННО вместе со списком в
    # `ops/dictionaries.py`. Восемь с 28.08.2026: к ролям наряда расстановки
    # (Plane №237) добавлены виды участия в ОМ и роли внутри группы
    # (Plane №274) — заказчик просил «выбор Физнаряд и разные специфические
    # группы, эти группы имеют разные статусы». ДЕВЯТЬ с 30.08.2026: секции
    # бланка расстановки (Plane №242) — вторая координата места, роль отвечает
    # «кем», секция «где».
    assert len(data) == 9
    assert "PLACEMENT_ROLES" in by_code
    assert "PLACEMENT_SECTIONS" in by_code
    # Две пары «родитель — дети» в справочниках: требования постов и роли
    # групп. Пин на обе, чтобы вторая не пропала незамеченной.
    assert "EVENT_PARTICIPATION_KINDS" in by_code
    assert "EVENT_GROUP_ROLES" in by_code
    assert by_code["POST_REQUIREMENTS"]["totalCount"] == 1
    assert by_code["POST_REQUIREMENT_GROUPS"]["activeCount"] == 1


def test_usage_tracked_and_not_tracked(viewer_api):
    group, req, free = seed_dictionary()
    rows = viewer_api.get(f"{DICTS}POST_REQUIREMENT_GROUPS/entries/").json()[
        "results"
    ]
    usage = rows[0]["usage"]
    assert usage["status"] == "TRACKED"
    assert usage["totalCount"] == 1
    assert usage["references"][0]["samples"] == ["Допуск «Объект A»"]
    rows = viewer_api.get(f"{DICTS}RETURN_REASONS/entries/").json()["results"]
    usage = rows[0]["usage"]
    assert usage["status"] == "NOT_TRACKED"
    assert usage["totalCount"] == 0
    assert "свободный комментарий" in usage["reason"]


def test_create_entry_validations(admin_api):
    seed_dictionary()
    resp = admin_api.post(
        f"{DICTS}POST_REQUIREMENTS/entries/",
        {"code": " ", "label": "", "groupCode": "NOPE"},
        format="json",
    )
    assert resp.status_code == 400
    details = resp.json()["details"]
    assert set(details) == {"code", "label", "groupCode"}
    resp = admin_api.post(
        f"{DICTS}POST_REQUIREMENTS/entries/",
        {"code": "access_a", "label": "Дубль", "groupCode": "ACCESS"},
        format="json",
    )
    # код нормализуется в верхний регистр → дубль
    assert resp.json()["details"]["code"] == [
        "Код уже используется в этом справочнике."
    ]
    resp = admin_api.post(
        f"{DICTS}POST_REQUIREMENTS/entries/",
        {"code": "height_180", "label": "Рост от 180", "groupCode": "ACCESS"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.json()["code"] == "HEIGHT_180"


def test_delete_rules(admin_api):
    group, req, free = seed_dictionary()
    # NOT_TRACKED — удаление запрещено с причиной
    resp = admin_api.delete(f"{DICTS}entries/{free.pk}/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "DICTIONARY_USAGE_UNKNOWN"
    # TRACKED с носителями — 409 с перечислением
    resp = admin_api.delete(f"{DICTS}entries/{group.pk}/")
    assert resp.status_code == 409
    payload = resp.json()
    assert payload["error_code"] == "DICTIONARY_ENTRY_IN_USE"
    assert "Допуск «Объект A»" in payload["message"]
    # требование само NOT_TRACKED (его связи — свободный текст паспортов):
    # даже «висячий» код не удаляется, только деактивация
    resp = admin_api.delete(f"{DICTS}entries/{req.pk}/")
    assert resp.status_code == 422
    # TRACKED без носителей — удаляется
    empty_group = OpsDictionaryEntry.objects.create(
        dictionary_code="POST_REQUIREMENT_GROUPS", code="EMPTY",
        label="Пустая группа", description="", is_active=True, group_code=None,
    )
    resp = admin_api.delete(f"{DICTS}entries/{empty_group.pk}/")
    assert resp.status_code == 204
    assert OpsDictionaryEntry.objects.count() == 3


def test_set_active_and_group_guard(admin_api):
    group, req, free = seed_dictionary()
    data = admin_api.post(
        f"{DICTS}entries/{group.pk}/set-active/",
        {"isActive": False},
        format="json",
    ).json()
    assert data["isActive"] is False
    # неактивная группа не принимает новые требования
    resp = admin_api.post(
        f"{DICTS}POST_REQUIREMENTS/entries/",
        {"code": "NEW_REQ", "label": "Новое", "groupCode": "ACCESS"},
        format="json",
    )
    assert resp.json()["details"]["groupCode"] == [
        "Группа не найдена или неактивна."
    ]


def test_dictionary_mutations_require_manage(viewer_api):
    seed_dictionary()
    resp = viewer_api.post(
        f"{DICTS}RETURN_REASONS/entries/",
        {"code": "X", "label": "Y"},
        format="json",
    )
    assert resp.status_code == 403


# ── Аудит раздела ────────────────────────────────────────────────────────────


def test_audit_endpoint_shape_and_order(admin_api):
    admin_api.patch(
        f"{SETTINGS}passport.due_soon_percent/",
        {"value": 30, "reason": "проба"},
        format="json",
    )
    rows = admin_api.get("/api/ops/audit-logs/").json()["results"]
    assert rows[0]["action"] == "SETTINGS_UPDATED"
    assert rows[0]["entityType"] == "policy_setting"
    assert rows[0]["actorUserId"] != ""
    assert rows[0]["reason"] == "проба"
    assert set(rows[0]) == {
        "id", "actorUserId", "action", "entityType", "entityId",
        "oldValue", "newValue", "reason", "createdAt",
    }


def test_audit_requires_permission(viewer_api):
    assert viewer_api.get("/api/ops/audit-logs/").status_code == 403


# ── Правка значения справочника (Plane №274) ─────────────────────────────
#
# ЗАЧЕМ. Заказчик просил у модуля «Справочники» все три действия — «Добавлять,
# удалять, редактировать». Правки не было вовсе: значение можно было завести,
# снять с активных и удалить. Опечатку в подписи лечили удалением и заведением
# заново, теряя связи и историю.


def test_an_entry_label_and_description_are_edited(admin_api):
    _group, req, _free = seed_dictionary()

    resp = admin_api.patch(
        f"{DICTS}entries/{req.pk}/",
        {"label": "Допуск «Объект А»", "description": "Форма допуска первая"},
        format="json",
    )

    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["label"] == "Допуск «Объект А»"
    assert body["description"] == "Форма допуска первая"
    req.refresh_from_db()
    assert req.label == "Допуск «Объект А»"


def test_the_code_is_not_editable(admin_api):
    """Код — то, ЧЕМ на значение ссылаются: сменить его значит оборвать ссылки.

    Проба стережёт не отказ, а неизменность: ручка код просто не принимает, и
    присланный код обязан не долететь до строки. Отказ был бы хуже — форма
    правки честно не показывает поле кода, и жаловаться пользователю не на что.
    """
    _group, req, _free = seed_dictionary()
    was = req.code

    resp = admin_api.patch(
        f"{DICTS}entries/{req.pk}/",
        {"label": "Новая подпись", "code": "ПОДМЕНА"},
        format="json",
    )

    assert resp.status_code == 200, resp.json()
    req.refresh_from_db()
    assert req.code == was, "код значения переписан — ссылки на него оборвутся"


def test_an_empty_label_is_refused(admin_api):
    _group, req, _free = seed_dictionary()

    resp = admin_api.patch(
        f"{DICTS}entries/{req.pk}/", {"label": "   "}, format="json"
    )

    assert resp.status_code == 400, resp.json()
    assert resp.json()["details"]["label"] == ["Обязательное поле."]
    req.refresh_from_db()
    assert req.label == "Допуск «Объект A»", "отказ всё-таки затёр подпись"


def test_a_missing_group_is_refused(admin_api):
    """Группа требования проверяется по справочнику — как при заведении."""
    _group, req, _free = seed_dictionary()

    resp = admin_api.patch(
        f"{DICTS}entries/{req.pk}/",
        {"label": "Допуск", "groupCode": "НЕТ-ТАКОЙ"},
        format="json",
    )

    assert resp.status_code == 400, resp.json()
    assert "groupCode" in resp.json()["details"]


def test_editing_is_closed_by_permission(viewer_api):
    """Читатель справочников их не правит: право `dictionary.manage`."""
    _group, req, _free = seed_dictionary()

    resp = viewer_api.patch(
        f"{DICTS}entries/{req.pk}/", {"label": "Чужая правка"}, format="json"
    )

    assert resp.status_code == 403
    req.refresh_from_db()
    assert req.label == "Допуск «Объект A»"


# ── Виды участия в ОМ и роли внутри группы (Plane №274, Ш-2) ─────────────
#
# ЗАЧЕМ. Заказчик: «выбор Физнаряд и разные специфические группы, эти группы
# имеют разные статусы (например: группа Досмотра, внутри досмотрщик, кинолог)».
#
# 🔴 Главное свойство пары — РОЛЬ ПРИНАДЛЕЖИТ ГРУППЕ. Общий список ролей
# позволил бы поставить кинолога в группу досмотра, и проверить это было бы
# нечем: подписи выглядят одинаково правдоподобно.


def seed_participation():
    group = OpsDictionaryEntry.objects.create(
        dictionary_code="EVENT_PARTICIPATION_KINDS", code="SCREENING_GROUP",
        label="Группа досмотра", description="", is_active=True,
        group_code=None,
    )
    squad = OpsDictionaryEntry.objects.create(
        dictionary_code="EVENT_PARTICIPATION_KINDS", code="PHYSICAL_SQUAD",
        label="Физический наряд", description="", is_active=True,
        group_code=None,
    )
    return group, squad


def test_a_role_belongs_to_its_group(admin_api):
    group, _squad = seed_participation()

    created = admin_api.post(
        f"{DICTS}EVENT_GROUP_ROLES/entries/",
        {"code": "screener", "label": "Досмотрщик", "groupCode": group.code},
        format="json",
    )

    assert created.status_code == 201, created.json()
    assert created.json()["groupCode"] == "SCREENING_GROUP"


def test_a_role_of_a_missing_group_is_refused(admin_api):
    seed_participation()

    resp = admin_api.post(
        f"{DICTS}EVENT_GROUP_ROLES/entries/",
        {"code": "dog_handler", "label": "Кинолог", "groupCode": "NO_SUCH"},
        format="json",
    )

    assert resp.status_code == 400, resp.json()
    assert resp.json()["details"]["groupCode"] == [
        "Группа не найдена или неактивна."
    ]


def test_a_group_with_roles_reports_them_as_usage(admin_api, viewer_api):
    """Связь видна СО СТОРОНЫ ГРУППЫ: иначе её удалили бы вместе с ролями."""
    group, _squad = seed_participation()
    admin_api.post(
        f"{DICTS}EVENT_GROUP_ROLES/entries/",
        {"code": "screener", "label": "Досмотрщик", "groupCode": group.code},
        format="json",
    )

    rows = viewer_api.get(
        f"{DICTS}EVENT_PARTICIPATION_KINDS/entries/"
    ).json()["results"]
    usage = next(row for row in rows if row["code"] == "SCREENING_GROUP")["usage"]

    assert usage["status"] == "TRACKED"
    assert usage["totalCount"] == 1
    assert usage["references"][0]["sourceLabel"] == "Роли внутри группы"
    assert usage["references"][0]["samples"] == ["Досмотрщик"]


def test_a_group_holding_roles_is_not_deleted(admin_api):
    group, _squad = seed_participation()
    admin_api.post(
        f"{DICTS}EVENT_GROUP_ROLES/entries/",
        {"code": "screener", "label": "Досмотрщик", "groupCode": group.code},
        format="json",
    )

    resp = admin_api.delete(f"{DICTS}entries/{group.pk}/")

    assert resp.status_code == 409, resp.content
    assert OpsDictionaryEntry.objects.filter(pk=group.pk).exists()


def test_the_physical_squad_has_no_roles_inside(viewer_api, admin_api):
    """У физнаряда ролей внутри нет — и связей у него тоже нет.

    Проба стережёт не пустоту, а РАЗЛИЧИЕ: группа досмотра показывает связь,
    физнаряд — ноль. Один только ноль зеленел бы и на сломанном подсчёте.
    """
    group, squad = seed_participation()
    admin_api.post(
        f"{DICTS}EVENT_GROUP_ROLES/entries/",
        {"code": "screener", "label": "Досмотрщик", "groupCode": group.code},
        format="json",
    )

    rows = viewer_api.get(
        f"{DICTS}EVENT_PARTICIPATION_KINDS/entries/"
    ).json()["results"]
    by_code = {row["code"]: row for row in rows}

    assert by_code["PHYSICAL_SQUAD"]["usage"]["totalCount"] == 0
    assert by_code["SCREENING_GROUP"]["usage"]["totalCount"] == 1
