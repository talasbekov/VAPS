"""Сводные данные ГВО правят создатель ОМ, назначенный старший ГВО и штаб
(Plane №947, задача заказчика 07.09.2026).

Заказчик: «Сводные данные по Бюллетени нельзя изменить, а нужно чтобы могли
изменять тот кто создал, старший ГВО кого назначили, Начальник управления
второго департамента».

🔴 ЧТО БЫЛО. Правку (`PATCH`/`reset` на `/api/ops/gvo-summaries/<код>/`)
открывали два ключа: право `gvo.manage` (после №601 — только начальник
ДЕПАРТАМЕНТА через `OPS_STAFF_COMMAND` и админ) и роль в данных «старший
мероприятия». Создатель бюллетеня (`acc_employee_d2`: `event.create`,
`event.bulletin`) и начальник управления второго департамента
(`acc_dir_head_d2`: `HEAD_OPS_UNIT` без добавки) получали 403, а экран под
ними показывал сводку без кнопки «Редактировать».

ЧТО СТАЛО. (1) У мероприятия есть `owner_actor_id` — идентификатор учётки
создателя; ставится при создании, у старых строк восстановлен из журнала
аудита (миграция 0104). Создатель правит сводку СВОЕГО ОМ по роли в данных,
как старший. (2) `HEAD_OPS_UNIT` снова носит `gvo.manage` (миграция 0105) —
сид и пины держателей правлены осознанно. (3) Ответ сводки несёт `canEdit`,
посчитанный ТЕМ ЖЕ правилом, что гейт: экран рисует кнопку по нему, а не по
своей копии правила.

КРАСНАЯ ПРОБА: сними ветку создателя из `permission_override` — красными
станут пробы создателя; перестань ставить `owner_actor_id` при создании —
красной станет проба «идентификатор записан»; верни `canEdit` в «только
право» — красной станет проба про `canEdit`.
"""
import pytest
from django.apps import apps as django_apps

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

from .test_ops_gvo_api import GVO_URL, make_event

pytestmark = pytest.mark.django_db

EVENTS_URL = "/api/ops/security-events/"
PATCH = {"section": "head", "values": {"country": "Черногория"}}


def creator(name="gvo-creator"):
    """Персона `[БЛН-10]`: заводит бюллетень, `gvo.manage` и `event.manage`
    у неё нет."""
    return client_for(name, "BULLETIN_CREATOR", ["event.view", "event.create", "event.bulletin"])


def test_creating_an_event_records_the_creator(db):
    api, user = creator()
    created = api.post(
        EVENTS_URL,
        {"title": "Визит делегации", "businessDate": "2026-09-12", "kind": "FOREIGN"},
        format="json",
    )
    assert created.status_code == 201, created.content
    event = OpsSecurityEvent.objects.get(code=created.json()["code"])
    assert event.owner_actor_id == str(user.pk)


def test_the_creator_edits_the_summary_of_own_event_only():
    api, user = creator()
    mine = make_event("ОМ-Т-947")
    mine.owner_actor_id = str(user.pk)
    mine.save(update_fields=["owner_actor_id"])
    foreign = make_event("ОМ-Т-948")
    foreign.owner_actor_id = "someone-else"
    foreign.save(update_fields=["owner_actor_id"])

    ok = api.patch(f"{GVO_URL}ОМ-Т-947/", PATCH, format="json")
    assert ok.status_code == 200, ok.content
    assert ok.json()["patch"]["country"] == "Черногория"
    assert api.post(f"{GVO_URL}ОМ-Т-947/reset/", {"section": "head"}, format="json").status_code == 200

    # Чужое ОМ — 403: «я где-то создатель» права на соседнюю сводку не даёт.
    assert api.patch(f"{GVO_URL}ОМ-Т-948/", PATCH, format="json").status_code == 403
    # Утверждение остаётся у штаба (`[ГВО-09]`): создатель заполняет, не утверждает.
    assert api.post(f"{GVO_URL}ОМ-Т-947/approve/", {}, format="json").status_code == 403


def test_an_event_without_a_recorded_creator_is_not_everyones():
    """Пустой идентификатор у старой строки — не «ничей, значит любой»: пустое
    против пустого не совпадает."""
    api, _ = client_for("gvo-anon-actor", "BULLETIN_CREATOR", ["event.view", "event.create", "event.bulletin"])
    make_event("ОМ-Т-949")  # owner_actor_id == ""
    assert api.patch(f"{GVO_URL}ОМ-Т-949/", PATCH, format="json").status_code == 403


def test_can_edit_flag_follows_the_gate():
    """`canEdit` считает сервер тем же правилом, что и гейт: экран рисует
    «Редактировать» по нему, и второй копии правила на клиенте нет."""
    api, user = creator("gvo-flag-creator")
    mine = make_event("ОМ-Т-950")
    mine.owner_actor_id = str(user.pk)
    mine.save(update_fields=["owner_actor_id"])
    make_event("ОМ-Т-951")

    assert api.get(f"{GVO_URL}ОМ-Т-950/").json()["canEdit"] is True
    assert api.get(f"{GVO_URL}ОМ-Т-951/").json()["canEdit"] is False

    staff, _ = client_for("gvo-flag-staff", "STAFF", ["event.view", "gvo.manage"])
    assert staff.get(f"{GVO_URL}ОМ-Т-951/").json()["canEdit"] is True


def test_backfill_restores_the_creator_from_the_audit_log():
    """Миграция 0104 восстанавливает создателя старых ОМ из журнала: на стенде
    заказчика все проверяемые мероприятия заведены ДО правки."""
    from importlib import import_module

    migration = import_module(
        "organization_management.apps.operations.migrations."
        "0104_security_event_owner_actor_id"
    )
    api, user = creator("gvo-backfill-creator")
    created = api.post(
        EVENTS_URL,
        {"title": "Старое ОМ", "businessDate": "2026-09-12", "kind": "FOREIGN"},
        format="json",
    )
    assert created.status_code == 201, created.content
    code = created.json()["code"]
    OpsSecurityEvent.objects.filter(code=code).update(owner_actor_id="")

    migration._backfill_from_audit(django_apps, None)

    assert OpsSecurityEvent.objects.get(code=code).owner_actor_id == str(user.pk)
