"""Срез A1: /api/ops/objects/ — реестр охраняемых объектов.

ЭТО НЕ ПЕРЕЕЗД. Ни один путь `/api/ops/*` не существует ни в целевом бэке, ни
в доноре (см. docs/api-gaps.md): раздел «Охранные мероприятия» написан под
бэкенд, которого нет, и живёт на браузерном мок-слое MSW. Поэтому здесь не
переносится чужой контракт поверх старых таблиц, как в срезах 153–159, а
заводится СВОЯ модель — у охраняемого объекта в целевом бэке нет ни таблицы,
ни аналога.

Форма ответа взята из контракта фронта — `SecurityObject` в
PersonalRecordFront/josparlau/src/features/objects/model/types.ts, — потому
что клиент уже написан и менять его в этой работе не входит в задачу. Отсюда
camelCase наружу при snake_case в модели.

ГРАНИЦА СРЕЗА. Строка объекта — и только она. Секторы, посты, версии паспорта,
блок `freshness`, агрегаты `kpi` и действующая политика `freshnessPolicy` в
срез НЕ входят: под ними свои таблицы (секторы/посты/версии) и своя настройка
(раздел «Настройки», §21.7 прямо запрещает выводить срок из константы в коде).
Отдать их пустыми массивами и нулями было бы хуже отсутствия: клиент не
отличил бы «объект без паспорта» от «эта часть ещё не построена».
"""
import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.operations.models_object import (
    OpsSecurityObject,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/objects/"

CONTRACT_FIELDS = {
    "id",
    # Срез A2: паспорт — черновик и снимки публикаций едут в строке объекта.
    "sectors",
    "passportVersions",
    "name",
    "code",
    "type",
    "region",
    "address",
    "objectState",
    "passportState",
    "createdAt",
    "updatedAt",
}


def make_object(code, name, **overrides):
    fields = {
        "name": name,
        "code": code,
        "object_type": "Государственное учреждение",
        "region": "г. Астана",
        "address": "пр. Мәңгілік Ел, 8",
        "object_state": OpsSecurityObject.ObjectState.ACTIVE,
        "passport_state": OpsSecurityObject.PassportState.GREEN,
    }
    fields.update(overrides)
    return OpsSecurityObject.objects.create(**fields)


@pytest.fixture(autouse=True)
def freshness_policy(db):
    """Срез A2: списочный ответ считает свежесть по ХРАНИМОЙ политике и без
    неё отказывает (422) — фикстура даёт тестам реестра мир, в котором
    политика настроена, как это делает сид прода."""
    from organization_management.apps.operations.models_object import (
        OpsPassportFreshnessPolicy,
    )
    OpsPassportFreshnessPolicy.objects.get_or_create(
        singleton_key=1,
        defaults={
            "version": "fp-v1",
            "verification_interval_days": 120,
            "due_soon_percent": 25,
        },
    )


@pytest.fixture
def registry():
    """Три объекта, и порядок их ЗАВЕДЕНИЯ намеренно не совпадает ни с одной
    сортировкой, которую мог бы применить клиент.

    Коды идут B → C → A, имена — «Ак…» → «Бе…» → «Ве…» (то есть по алфавиту
    имён порядок заведения ПРАВИЛЬНЫЙ). Совпади фикстура с сортировкой по
    имени или с порядком вставки — проверка «список упорядочен по коду»
    прошла бы и на выборке вообще без order_by.
    """
    return {
        "b": make_object("OBJ-B", "Академия"),
        "c": make_object("OBJ-C", "Бейбарыс"),
        "a": make_object("OBJ-A", "Ведомство"),
    }


def reader(name="ops-objects-reader"):
    return client_for(name, "VIEWER", ["object.view"])


def rows(response):
    body = response.json()
    # Пагинация DRF заворачивает список в конверт; контракт фронта читает
    # `results`, поэтому строки достаём одинаково в обоих случаях.
    return body["results"] if isinstance(body, dict) else body


def by_code(response, code):
    return next(row for row in rows(response) if row["code"] == code)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(registry):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(registry):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("ops-objects-nobody")

    assert api.get(URL).status_code == 403


def test_foreign_permission_does_not_open_the_list(registry):
    """Право соседнего ресурса реестр объектов не открывает.

    Без этого кейса гейт мог бы стоять на «хоть какое-нибудь право», и
    держатель orgstructure.view читал бы охраняемые объекты.
    """
    api, _ = client_for("ops-objects-orgreader", "VIEWER", ["orgstructure.view"])

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(registry):
    api, _ = reader()

    assert api.get(URL).status_code == 200


def test_read_permission_opens_the_card(registry):
    api, _ = reader()

    assert api.get(f"{URL}{registry['a'].id}/").status_code == 200


def test_card_is_closed_without_permission(registry):
    api, _ = client_for("ops-objects-card-nobody")

    assert api.get(f"{URL}{registry['a'].id}/").status_code == 403


# ── Контракт ─────────────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(registry):
    """Поля пиним точным равенством.

    Проверка «поля присутствуют» пропустила бы лишнее: клиент раздела написан
    по фиксированной форме `SecurityObject`, и поле сверх контракта разошлось
    бы с ней молча.
    """
    api, _ = reader()

    assert set(by_code(api.get(URL), "OBJ-A")) == CONTRACT_FIELDS


def test_card_carries_the_same_fields_as_the_row(registry):
    """Карточка и строка списка описывают ОДИН объект.

    Разойдись они в наборе полей — клиент, открывший карточку из списка,
    получил бы два разных описания одной сущности.
    """
    api, _ = reader()

    card = api.get(f"{URL}{registry['a'].id}/").json()
    assert set(card) == CONTRACT_FIELDS


def test_states_do_not_swap_columns(registry):
    """Состояние объекта и состояние паспорта — РАЗНЫЕ поля.

    Значения берутся заведомо различимые: перепутай сериализатор источники,
    и подмена была бы видна. На объекте с ACTIVE/GREEN она бы не проявилась.
    """
    archived = make_object(
        "OBJ-D",
        "Гарнизон",
        object_state=OpsSecurityObject.ObjectState.ARCHIVED,
        passport_state=OpsSecurityObject.PassportState.RED,
    )
    api, _ = reader()

    row = by_code(api.get(URL), "OBJ-D")
    assert row["objectState"] == "ARCHIVED"
    assert row["passportState"] == "RED"
    assert row["id"] == str(archived.id)  # контракт клиента: id — строка


def test_type_carries_the_object_type(registry):
    """`type` контракта — это вид объекта, а не что-либо ещё.

    Имя поля в модели другое (`object_type`): `type` затенял бы встроенное
    имя питона, а в контракте клиента поле называется именно так.
    """
    api, _ = reader()

    assert by_code(api.get(URL), "OBJ-A")["type"] == "Государственное учреждение"


def test_plain_columns_are_carried_verbatim(registry):
    api, _ = reader()
    row = by_code(api.get(URL), "OBJ-A")

    assert row["name"] == "Ведомство"
    assert row["region"] == "г. Астана"
    assert row["address"] == "пр. Мәңгілік Ел, 8"


def test_timestamps_are_reported(registry):
    api, _ = reader()
    row = by_code(api.get(URL), "OBJ-A")

    assert row["createdAt"] is not None
    assert row["updatedAt"] is not None


# ── Порядок и выборка ────────────────────────────────────────────────────


def test_list_is_ordered_by_code(registry):
    """Порядок задаёт СЕРВЕР, а не клиент.

    Три строки, а не две: на двух элементах «порядок по коду» совпал бы со
    слишком многим — с обратным порядком вставки, например.
    """
    api, _ = reader()

    assert [row["code"] for row in rows(api.get(URL))] == [
        "OBJ-A",
        "OBJ-B",
        "OBJ-C",
    ]


def test_ordering_is_owned_by_the_model():
    """Разряды порядка пиним ЛИТЕРАЛЬНО, а не только поведением.

    Поведенческой пробы мало: ключ вторым разрядом нужен ради устойчивости
    страниц, а на выборке без совпадающих кодов его отсутствие не проявится —
    уникальность кода как раз и делает второй разряд невидимым в ответе.
    """
    assert OpsSecurityObject._meta.ordering == ["code", "id"]


def test_query_count_does_not_grow_with_rows(registry):
    """Гвард N+1 — сравнением ДВУХ ЗАМЕРОВ, не магическим числом.

    Замер на трёх строках и на семи обязан совпасть: разойдись они, значит
    строка тянет свой запрос. Зафиксированное число здесь ничего не поймало
    бы — оно всегда «сколько получилось», и первый же добавленный
    SerializerMethodField со ссылкой уехал бы в прод вместе с новым числом.
    """
    api, _ = reader()

    with CaptureQueriesContext(connection) as small:
        assert len(rows(api.get(URL))) == 3

    for index in range(4):
        make_object(f"OBJ-N{index}", f"Новый {index}")

    with CaptureQueriesContext(connection) as large:
        assert len(rows(api.get(URL))) == 7

    assert len(large.captured_queries) == len(small.captured_queries)


# ── Ограничения базы ─────────────────────────────────────────────────────


def test_unknown_object_state_is_refused_by_the_database():
    """Ограничение держит БАЗА, а не форма.

    Строки заводит код мимо full_clean, а поле без дефолта молча принимает
    "" — и объект без состояния прошёл бы как значение.
    """
    with pytest.raises(IntegrityError), transaction.atomic():
        make_object("OBJ-BAD-1", "Кривое состояние", object_state="ЧТО-ТО")


def test_unknown_passport_state_is_refused_by_the_database():
    with pytest.raises(IntegrityError), transaction.atomic():
        make_object("OBJ-BAD-2", "Кривой паспорт", passport_state="ЧТО-ТО")


def test_blank_code_is_refused_by_the_database():
    """Пустой код — не код: по нему идёт и сортировка, и поиск объекта."""
    with pytest.raises(IntegrityError), transaction.atomic():
        make_object("   ", "Объект без кода")


def test_blank_name_is_refused_by_the_database():
    with pytest.raises(IntegrityError), transaction.atomic():
        make_object("OBJ-BAD-3", "   ")


def test_code_is_unique(registry):
    with pytest.raises(IntegrityError), transaction.atomic():
        make_object("OBJ-A", "Двойник кода")


def test_every_declared_state_is_accepted_by_the_database():
    """Ограничение и choices перечисляют ОДНО И ТО ЖЕ.

    Наборы кодов записаны в модуле дважды (тело вложенного Meta не видит имён
    класса), и разойтись им нельзя в обе стороны: лишний код в ограничении
    пропустил бы мусор, недостающий — запретил бы объявленное состояние.
    Кейсы выше закрывают первую сторону, этот — вторую.
    """
    for index, object_state in enumerate(OpsSecurityObject.ObjectState.values):
        for passport_state in OpsSecurityObject.PassportState.values:
            make_object(
                f"OBJ-M-{object_state}-{passport_state}",
                f"Сочетание {index}",
                object_state=object_state,
                passport_state=passport_state,
            )

    assert OpsSecurityObject.objects.count() == 6
