"""Срез A2: паспорт объекта — секторы/посты, версии, свежесть, KPI.

Достраивает /api/ops/objects/ до полного контракта клиента
(PersonalRecordFront, entities/security-object/model/types.ts):

- списочный ответ — конверт {results, freshness, kpi, freshnessPolicy,
  unavailableKpi}, где freshness/kpi посчитаны СЕРВЕРОМ по всему реестру;
- объект несёт sectors (действующая редакция-черновик) и passportVersions
  (неизменяемые снимки публикаций);
- PATCH /objects/{id}/passport/ правит черновик;
- POST /objects/{id}/passport/versions/ публикует версию.

Форма и валидации взяты из mock-слоя клиента (mocks/ops/objects-handlers.ts)
— он и был контрактом, под который написан экран. Свежесть — производное на
чтении от бизнес-даты (Clock) и ХРАНИМОЙ политики (§21.7: не константа в
коде); у объекта не хранится.
"""
import datetime as dt

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.clock import Clock, override as clock_override
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_object import (
    OpsObjectSector,
    OpsPassportFreshnessPolicy,
    OpsPassportVersion,
    OpsSecurityObject,
    OpsSecurityPost,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/objects/"


def make_object(code, name, passport_state="RED", **overrides):
    fields = {
        "name": name,
        "code": code,
        "object_type": "Государственное учреждение",
        "region": "г. Астана",
        "address": "пр. Мәңгілік Ел, 8",
        "object_state": OpsSecurityObject.ObjectState.ACTIVE,
        "passport_state": passport_state,
    }
    fields.update(overrides)
    return OpsSecurityObject.objects.create(**fields)


def make_sector(obj, name="Сектор 1", position=1, posts=("Пост 1",)):
    sector = OpsObjectSector.objects.create(
        security_object=obj, name=name, position=position
    )
    for i, post_name in enumerate(posts, start=1):
        OpsSecurityPost.objects.create(
            sector=sector,
            name=post_name,
            task="Охрана периметра",
            requirements="Допуск",
            position=i,
        )
    return sector


def make_policy(interval=120, percent=25, version="fp-v1"):
    return OpsPassportFreshnessPolicy.objects.get_or_create(
        singleton_key=1,
        defaults={
            "version": version,
            "verification_interval_days": interval,
            "due_soon_percent": percent,
        },
    )[0]


def publish(obj, effective_from, number=None, api=None, note="плановая"):
    """Публикация через API — единственный писатель версий."""
    resp = api.post(
        f"{URL}{obj.pk}/passport/versions/",
        {"effectiveFrom": effective_from, "note": note},
        format="json",
    )
    return resp


@pytest.fixture
def reader():
    api, _ = client_for("obj-reader", "OBJ_VIEWER", perms=("object.view",))
    return api

@pytest.fixture
def manager():
    api, _ = client_for(
        "obj-manager", "OBJ_MANAGER", perms=("object.view", "object.manage")
    )
    return api


# -- список: конверт --------------------------------------------------------


def test_list_envelope_shape(reader):
    make_policy()
    make_object("B-2", "Второй")
    obj = make_object("A-1", "Первый", passport_state="GREEN")
    make_sector(obj)
    data = reader.get(URL).json()
    assert set(data) == {
        "results",
        "freshness",
        "kpi",
        "freshnessPolicy",
        "unavailableKpi",
    }
    # порядок реестра — по коду
    assert [r["code"] for r in data["results"]] == ["A-1", "B-2"]
    # freshness — по записи на каждую строку results, тот же порядок
    assert [f["objectId"] for f in data["freshness"]] == [
        str(r["id"]) if not isinstance(r["id"], str) else r["id"]
        for r in data["results"]
    ]
    assert data["freshnessPolicy"] == {
        "version": "fp-v1",
        "verificationIntervalDays": 120,
        "dueSoonPercent": 25,
    }
    # честный список «не считается» — код/подпись/причина
    assert all(
        set(m) == {"code", "label", "reason"} for m in data["unavailableKpi"]
    )


def test_object_row_carries_sectors_and_versions(reader, manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj, posts=("Пост 1", "Пост 2"))
    assert publish(obj, "2026-08-01", api=manager).status_code == 201
    row = reader.get(URL).json()["results"][0]
    assert isinstance(row["id"], str)  # контракт клиента: id — строка
    assert [s["name"] for s in row["sectors"]] == ["Сектор 1"]
    assert [p["name"] for p in row["sectors"][0]["posts"]] == ["Пост 1", "Пост 2"]
    version = row["passportVersions"][0]
    assert version["versionNumber"] == 1
    assert version["effectiveFrom"] == "2026-08-01"
    assert version["publishedBy"] != ""
    assert [s["name"] for s in version["sectors"]] == ["Сектор 1"]


# -- свежесть: производное от Clock и политики -------------------------------


def test_freshness_no_published_version(reader):
    make_policy()
    make_object("A-1", "Без публикаций")
    f = reader.get(URL).json()["freshness"][0]
    assert f["state"] == "NO_PUBLISHED_VERSION"
    assert f["verificationDueAt"] is None
    assert f["freshnessPolicyVersion"] == "fp-v1"


@pytest.mark.parametrize(
    "today, expected",
    [
        # интервал 120, порог 25% → dueSoon с 30 дней до срока
        (dt.date(2026, 8, 2), "FRESH"),      # осталось 119
        (dt.date(2026, 10, 29), "FRESH"),    # осталось 31
        (dt.date(2026, 10, 30), "DUE_SOON"), # осталось 30 — ровно порог
        (dt.date(2026, 11, 29), "DUE_SOON"), # осталось 0 — день срока
        (dt.date(2026, 11, 30), "OVERDUE"),  # срок прошёл
    ],
)
def test_freshness_states_by_business_date(reader, manager, today, expected):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    assert publish(obj, "2026-08-01", api=manager).status_code == 201
    with clock_override(today):
        data = reader.get(URL).json()
    f = data["freshness"][0]
    assert f["state"] == expected
    assert f["verificationDueAt"] == "2026-11-29"


def test_freshness_counts_from_latest_publication(reader, manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    assert publish(obj, "2026-01-01", api=manager).status_code == 201
    assert publish(obj, "2026-08-01", api=manager).status_code == 201
    with clock_override(dt.date(2026, 8, 10)):
        f = reader.get(URL).json()["freshness"][0]
    # от старой публикации давно OVERDUE; от последней — FRESH
    assert f["state"] == "FRESH"


# -- KPI: по всему реестру ---------------------------------------------------


def test_kpi_counts(reader, manager):
    make_policy()
    green = make_object("A-1", "Зелёный", passport_state="GREEN")
    make_sector(green)
    assert publish(green, "2026-08-01", api=manager).status_code == 201
    make_object("B-2", "Красный без публикаций", passport_state="RED")
    make_object("C-3", "Жёлтый без публикаций", passport_state="YELLOW")
    with clock_override(dt.date(2026, 8, 10)):
        kpi = reader.get(URL).json()["kpi"]
    assert kpi == {
        "total": 3,
        "passportGreen": 1,
        "passportYellow": 1,
        "passportRed": 1,
        "verificationOverdue": 0,
        "neverPublished": 2,
    }


def test_list_without_policy_is_domain_error(reader):
    """Нет строки политики — 500 недопустим: явный отказ с кодом."""
    make_object("A-1", "Первый")
    resp = reader.get(URL)
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


# -- PATCH /passport/: правка черновика --------------------------------------


def test_patch_passport_replaces_draft(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj, name="Старый", posts=("Старый пост",))
    body = {
        "sectors": [
            {
                "id": "tmp-1",
                "name": "Новый сектор",
                "posts": [
                    {
                        "id": "tmp-p1",
                        "name": "Новый пост",
                        "task": "Задача",
                        "requirements": "Требования",
                    }
                ],
            }
        ]
    }
    resp = manager.patch(f"{URL}{obj.pk}/passport/", body, format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert [s["name"] for s in data["sectors"]] == ["Новый сектор"]
    # персистентность — из БД, не из ответа
    assert list(
        OpsObjectSector.objects.filter(security_object=obj).values_list(
            "name", flat=True
        )
    ) == ["Новый сектор"]
    assert OpsSecurityPost.objects.filter(sector__security_object=obj).count() == 1


def test_patch_passport_validation_errors_keyed_per_row(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    body = {
        "sectors": [
            {"id": "s1", "name": "  ", "posts": [{"id": "p1", "name": "Пост"}]},
            {"id": "s2", "name": "Сектор", "posts": [{"id": "p2", "name": " "}]},
        ]
    }
    resp = manager.patch(f"{URL}{obj.pk}/passport/", body, format="json")
    assert resp.status_code == 400
    payload = resp.json()
    assert payload["error_code"] == "VALIDATION_ERROR"
    assert payload["details"] == {
        "sectors.0.name": ["Укажите название сектора."],
        "sectors.1.posts.0.name": ["Укажите название поста."],
    }
    # отклонённая правка ничего не тронула
    assert OpsObjectSector.objects.filter(security_object=obj).count() == 0


def test_patch_passport_unknown_object_404(manager):
    make_policy()
    resp = manager.patch(f"{URL}999999/passport/", {"sectors": []}, format="json")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_patch_passport_requires_manage(reader):
    make_policy()
    obj = make_object("A-1", "Первый")
    resp = reader.patch(f"{URL}{obj.pk}/passport/", {"sectors": []}, format="json")
    assert resp.status_code == 403
    assert OpsObjectSector.objects.count() == 0


# -- POST /passport/versions/: публикация ------------------------------------


def test_publish_version_snapshot_is_immutable(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj, name="Снимаемый", posts=("Пост 1",))
    resp = publish(obj, "2026-08-01", api=manager)
    assert resp.status_code == 201
    # правка черновика ПОСЛЕ публикации версию не трогает
    OpsObjectSector.objects.filter(security_object=obj).update(name="Переименован")
    version = OpsPassportVersion.objects.get(security_object=obj)
    assert [s["name"] for s in version.sectors_snapshot] == ["Снимаемый"]
    data = resp.json()
    assert data["passportVersions"][0]["versionNumber"] == 1
    assert data["passportVersions"][0]["note"] == "плановая"


def test_publish_second_version_increments_number(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    assert publish(obj, "2026-08-01", api=manager).status_code == 201
    resp = publish(obj, "2026-09-01", api=manager)
    assert resp.status_code == 201
    numbers = [v["versionNumber"] for v in resp.json()["passportVersions"]]
    assert numbers == [1, 2]


def test_publish_duplicate_effective_from_rejected(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    assert publish(obj, "2026-08-01", api=manager).status_code == 201
    resp = publish(obj, "2026-08-01", api=manager)
    assert resp.status_code == 400
    assert resp.json()["details"] == {
        "effectiveFrom": ["На эту дату версия паспорта уже опубликована."]
    }
    assert OpsPassportVersion.objects.count() == 1


def test_publish_bad_date_rejected(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    resp = publish(obj, "01.08.2026", api=manager)
    assert resp.status_code == 400
    assert resp.json()["details"] == {
        "effectiveFrom": ["Укажите дату вступления в силу."]
    }


def test_publish_empty_passport_rejected(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    # сектор есть, постов нет — публиковать нечего
    OpsObjectSector.objects.create(security_object=obj, name="Пустой", position=1)
    resp = publish(obj, "2026-08-01", api=manager)
    assert resp.status_code == 400
    assert resp.json()["details"] == {
        "sectors": ["В паспорте нет ни одного поста — публиковать нечего."]
    }


def test_publish_requires_manage(reader):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    resp = reader.post(
        f"{URL}{obj.pk}/passport/versions/",
        {"effectiveFrom": "2026-08-01", "note": ""},
        format="json",
    )
    assert resp.status_code == 403
    assert OpsPassportVersion.objects.count() == 0


def test_publish_writes_audit_row(manager):
    make_policy()
    obj = make_object("A-1", "Первый")
    make_sector(obj)
    assert publish(obj, "2026-08-01", api=manager).status_code == 201
    row = OpsAuditLog.objects.get(action="PASSPORT_VERSION_PUBLISHED")
    assert row.entity_type == "security_object"
    assert row.entity_id == obj.pk
    assert row.new_value["versionNumber"] == 1


# -- база как последний рубеж -----------------------------------------------


def test_db_rejects_duplicate_effective_from():
    obj = make_object("A-1", "Первый")
    def row(number, day):
        return OpsPassportVersion(
            security_object=obj,
            version_number=number,
            effective_from=day,
            published_at=Clock.now(),
            published_by="t",
            sectors_snapshot=[],
        )
    row(1, dt.date(2026, 8, 1)).save()
    with pytest.raises(IntegrityError), transaction.atomic():
        row(2, dt.date(2026, 8, 1)).save()


def test_db_rejects_zero_version_number():
    obj = make_object("A-1", "Первый")
    with pytest.raises(IntegrityError), transaction.atomic():
        OpsPassportVersion.objects.create(
            security_object=obj,
            version_number=0,
            effective_from=dt.date(2026, 8, 1),
            published_at=Clock.now(),
            published_by="t",
            sectors_snapshot=[],
        )
