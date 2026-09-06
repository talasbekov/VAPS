"""Страница реестра ОМ не растит запросы вместе со строками (Plane №480).

🔴 ЧТО СТЕРЕЖЁТ. `visit_object_posts` на КАЖДОМ вызове спрашивал
`event.visit_objects.count()` — отдельный запрос. При сериализации строки его
зовут дважды на объект посещения (готовность расстановки и признак
устаревшего согласования через подпись), а `primary_visit_object` делал свой
`order_by().first()` в обход уже подтянутого списка — ещё дважды на
мероприятие плюс раз на признак уровня ОМ. Двадцать строк реестра добирали
порядка шестидесяти лишних запросов.

Это ВОЗВРАТ болезни, а не новая: тем же были №376 (51 запрос к одной ручке) и
№786 (восемь запросов на строку). Она незаметна, пока не измеришь: ответ
верный, экран правильный, растёт только время.

ПОЧЕМУ ПРОБА МЕРЯЕТ ПРИРОСТ, А НЕ ЧИСЛО. Абсолютное число запросов зависит от
всего, что делает ручка, — прав, фильтров, пагинации, — и пин на нём краснел
бы от любой соседней правки, ничего не говоря про N+1. Прирост на строку — это
и есть предмет: он обязан быть НУЛЁМ.
"""
import pytest

from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    give_chief,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _event_with_two_objects(manager, index):  # noqa: F811
    """ОМ с ДВУМЯ объектами посещения: на одном объекте N+1 не виден."""
    first = make_object(code=f"OBJ-Q-{index}-A", with_passport=True)
    created = manager.post(
        URL,
        {
            "title": f"Проба запросов реестра {index}",
            "objectId": str(first.pk),
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    second = make_object(code=f"OBJ-Q-{index}-B", with_passport=True)
    added = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    give_chief(manager, event_id)
    imported = manager.post(
        f"{URL}{event_id}/recon/import-from-passport/",
        {"visitObjectId": str(added.json()["visitObjects"][0]["id"])},
        format="json",
    )
    assert imported.status_code == 200, imported.content
    _populate_people(manager, event_id)
    return event_id


def _populate_people(manager, event_id):  # noqa: F811
    """Люди в строке: назначения, состав и раскладка (Plane №909).

    🔴 БЕЗ ЭТОГО СТОРОЖ НЕ ДОХОДИЛ ДО САМЫХ ДОРОГИХ ПОЛЕЙ. Фикстура заводила
    только объекты посещения и посты, а `placement_assignments`, `force_roster`
    и `force_allocation` оставались пустыми — все три вьюхи начинаются с
    `if not rows: return []`, то есть на пробе стояли ноль запросов и не
    проверялись ВОВСЕ. Между тем именно там живут самые дорогие чтения строки:
    справочник статусов и перекрытия дня спрашиваются на каждую группу людей.

    Назначения ставятся ЧЕРЕЗ РУЧКУ — она же считает готовность, и подделка
    поля мимо неё дала бы строку, которой система не производит. Состав и
    раскладку кладём полями модели: их боевой путь идёт через сбор сил с
    департаментами и правами, а к предмету сторожа (растут ли запросы вместе
    со строками) он отношения не имеет — фикстура стала бы вдвое длиннее
    самой пробы.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    from organization_management.apps.ops.tests.test_ops_security_events_api import (
        make_employee,
    )

    base = f"{URL}{event_id}/"
    posts = manager.get(base).json()["reconSectorPosts"]
    assigned = []
    for post in posts[:2]:
        employee = make_employee()
        resp = manager.post(
            base + "placement/assign/",
            {"postId": post["id"], "employeeId": str(employee.pk)},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        assigned.append(employee)
    extra = [make_employee(), make_employee()]

    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.force_roster = [
        {
            "id": f"roster-{employee.pk}",
            "employeeId": str(employee.pk),
            "employeeName": employee.last_name,
            "divisionName": "",
        }
        for employee in assigned + extra
    ]
    event.force_allocation = [
        {
            "id": f"alloc-{event_id}",
            "departmentId": "",
            "departmentName": "Департамент пробы",
            "need": 2,
            "members": [
                {"employeeId": str(employee.pk), "employeeName": employee.last_name}
                for employee in extra
            ],
        }
    ]
    event.save(update_fields=["force_roster", "force_allocation", "updated_at"])


def _queries_for_registry(manager):  # noqa: F811
    with CaptureQueriesContext(connection) as captured:
        resp = manager.get(f"{URL}?page_size=50")
        assert resp.status_code == 200, resp.content
        rows = len(resp.json()["results"])
    return len(captured), rows


def test_the_registry_does_not_add_queries_per_row(manager):  # noqa: F811
    """Прирост запросов на дополнительное мероприятие — НОЛЬ.

    Красная на мутации: верни `event.visit_objects.count()` внутрь
    `visit_object_posts` (или `order_by().first()` в `primary_visit_object`) —
    каждая новая строка снова начнёт стоить своих запросов.

    🔴 СТРОКА ФИКСТУРЫ — ЖИВАЯ, А НЕ ПУСТАЯ (Plane №909). До этого в ней были
    только объекты посещения и посты, а три самых дорогих поля —
    `placement_assignments`, `force_roster`, `force_allocation` — оставались
    пустыми. Все три вьюхи начинаются с `if not rows: return []`, то есть
    сторож их не проверял вовсе и был бы зелёным при любом N+1 внутри них.
    """
    _event_with_two_objects(manager, 1)
    one, rows_one = _queries_for_registry(manager)
    assert rows_one == 1, "в реестре не одна строка — прирост не с чем сравнивать"

    _event_with_two_objects(manager, 2)
    _event_with_two_objects(manager, 3)
    three, rows_three = _queries_for_registry(manager)
    assert rows_three == 3

    growth = three - one
    assert growth == 0, (
        f"страница реестра выросла на {growth} запросов из-за двух лишних "
        f"строк ({one} → {three}). Запрос на строку — это N+1: он не виден "
        "глазом и растёт линейно вместе с числом мероприятий."
    )


def test_a_partial_prefetch_does_not_cost_two_queries_per_object(manager):  # noqa: F811
    """Набор, подтянувший объекты БЕЗ вложенных, не платит за каждый объект
    (Plane №911).

    🔴 ЧТО СТЕРЕЖЁТ. `visit_objects_of` решал «кэш есть» по наличию ключа
    `visit_objects` — и только его. Набор, подтянувший объекты без
    `deputies`/`document_versions`, проходил проверку и получал список даром, а
    потом платил ДВА запроса на КАЖДЫЙ объект, когда сериализатор доходил до
    замещающих и версий. Такие наборы существуют не в теории: `my_assignments`,
    `documents_summary` и `documents_bulletin` тянут `visit_objects` и на этом
    останавливаются.

    Сторож реестра выше этого не показывал бы НИКОГДА: он гоняет свой набор,
    где вложенные подтянуты, и остаётся зелёным — ровно та слепая зона, из-за
    которой дефект и был бы найден только замером на живой странице.

    Проба строит именно такой неполный набор и считает обращения к таблицам
    замещающих и версий: их должно быть не больше одного на каждую, сколько бы
    объектов посещения ни было. У фикстуры их два.

    КРАСНАЯ ПРОБА: убери проверку вложенных ключей в `visit_objects_of` —
    обращений станет по два на объект.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent
    from organization_management.apps.ops.api.serializers import (
        serialize_security_event,
    )

    event_id = _event_with_two_objects(manager, 9)
    # Набор-нарушитель: объекты подтянуты, вложенные — нет.
    partial = (
        OpsSecurityEvent.objects.prefetch_related("visit_objects")
        .filter(pk=event_id)
        .first()
    )
    assert partial is not None

    with CaptureQueriesContext(connection) as captured:
        serialize_security_event(partial)

    def reads(table):
        return sum(1 for q in captured.captured_queries if table in q["sql"])

    assert reads("ops_visit_object_deputies") <= 1, (
        f"замещающие прочитаны {reads('ops_visit_object_deputies')} раз(а) — "
        "по запросу на объект посещения"
    )
    assert reads("ops_placement_document_versions") <= 1, (
        f"версии документа прочитаны {reads('ops_placement_document_versions')} "
        "раз(а) — по запросу на объект посещения"
    )


def test_the_page_does_not_pull_the_whole_table(manager):  # noqa: F811
    """Страница читает СТРАНИЦУ, а не весь реестр (Plane №910).

    🔴 ВТОРАЯ ПОЛОВИНА СТОРОЖА, И ОНА ПРО ДРУГОЕ. Проба выше считает ЗАПРОСЫ и
    требует нулевого прироста — но это условие выполняется и тогда, когда
    ручка одним запросом вытаскивает в память всю таблицу. Так и было: отбор
    по стадии, периоду, ответственному и поиску шёл питоном по полному списку,
    а три `Prefetch` отрабатывали по нему же. Число запросов при этом
    падало — число вытащенных строк росло, и рост никто не мерил.

    Здесь мерится ВЕРХНЯЯ ГРАНИЦА СТРОК: сколько записей мероприятий
    прочитано на запрос страницы из одной строки. Порог — не круглый, а
    выведенный: сама страница плюс подсчёт `count()` и список значений
    фильтра «ответственный», которые ходят по всей таблице НАМЕРЕННО (иначе
    фильтр предлагал бы не всех, а счётчик врал бы про число найденных).
    Тянуть строки целиком ради этих двух ответов не нужно — они берут одну
    колонку и агрегат.

    КРАСНАЯ ПРОБА: верни фильтрацию и срез страницы в питон (`list(...)` по
    всей таблице) — прочитанных строк станет столько, сколько ОМ в базе.
    """
    for index in (11, 12, 13):
        _event_with_two_objects(manager, index)

    with CaptureQueriesContext(connection) as captured:
        resp = manager.get(f"{URL}?page_size=1")
        assert resp.status_code == 200, resp.content
        assert len(resp.json()["results"]) == 1
        assert resp.json()["count"] == 3, "счётчик считает не весь реестр"

    # Запросы, которые ЧИТАЮТ СТРОКИ мероприятий: без `count(` и без выборки
    # одной колонки — обе ходят по всей таблице намеренно и строк не тянут.
    row_reads = [
        q["sql"]
        for q in captured.captured_queries
        if 'FROM "ops_security_events"' in q["sql"]
        and "COUNT(" not in q["sql"].upper()
        and '"ops_security_events"."title"' in q["sql"]
    ]
    assert len(row_reads) == 1, (
        f"строки мероприятий читаются {len(row_reads)} запросами: "
        + "; ".join(sql[:120] for sql in row_reads)
    )
    assert "LIMIT 1" in row_reads[0], (
        "страница читается без LIMIT — значит в память тянется весь реестр: "
        + row_reads[0][:200]
    )


def test_the_owner_filter_offers_each_name_once(manager):  # noqa: F811
    """Список «Ведущий» не повторяет имя (Plane №910).

    🔴 ПОЙМАНО ЖИВОЙ ПРОБОЙ, А НЕ ЧТЕНИЕМ. Перевод листинга на queryset
    заменил сбор имён множеством на `values_list(...).distinct()` — и это
    молча сломалось: у модели есть `Meta.ordering`, Django добавляет поля
    сортировки в SELECT, и уникальность считается по тройке «имя +
    created_at + id», то есть не считается вовсе. На стенде в списке
    «Ведущий» имя `stand-seed` стояло ЧЕТЫРЕ раза, а всего вариантов
    показывалось 21 вместо 3.

    Лечится пустым `order_by()` перед `distinct()`; проба стережёт именно
    это, а не число вариантов: их состав зависит от данных.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    first = _event_with_two_objects(manager, 21)
    second = _event_with_two_objects(manager, 22)
    # ОДИН владелец у ДВУХ мероприятий — иначе проба вакуумна: без повторов
    # уникальность не проверить, и мутация «снять order_by()» её не красит
    # (проверено запуском — так и вышло с первой версией).
    OpsSecurityEvent.objects.filter(pk__in=[first, second]).update(
        owner_name="Повторов П."
    )

    owners = manager.get(f"{URL}?page_size=1").json()["owners"]

    assert "Повторов П." in owners, "имя не попало в список — проверять нечего"
    assert owners == sorted(set(owners)), (
        f"список ответственных повторяет имена: {owners}"
    )
