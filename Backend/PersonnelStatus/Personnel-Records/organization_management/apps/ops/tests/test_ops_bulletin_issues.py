"""Бюллетень — выпуск с датой и временем среза, хранимый документ (Plane №420).

`[МД-01]`: «выпуск: дата + время среза („на 08:00 ч. 22.04.2026“)».
`[БЛН-04]`: «пользователь выбирает дату/время среза → все мероприятия с датой
≥ среза → PDF». До этой задачи срез был «сейчас», выбрать его было негде, а
собранный документ нигде не оставался.

Пробы стерегут:
1. срез из параметра `asOf` меняет ОТБОР и ЗАГОЛОВОК документа на лету;
2. выпуск замораживает строки и байты — новое ОМ после выпуска в него не
   попадает, а свежая сборка на тот же срез его видит;
3. выпуск отдаёт файл тем же конвертом, что и выгрузка; без среза — 400.
"""
import base64
import datetime as dt
import io

import pytest

from organization_management.apps.ops.tests.test_ops_documents_bulletin import (
    make_event as _make_event,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    manager,
)

pytestmark = pytest.mark.django_db

ISSUES = "/api/ops/bulletin-issues/"
RENDER = "/api/ops/event-documents/render/"


def text_of(pdf_bytes):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "".join((page.extract_text() or "") for page in reader.pages)


def make_event(title, business_date):
    """Штатным сервисом, как и проба документа: ORM обходит инварианты модели."""
    return _make_event(title, business_date)


def test_the_slice_parameter_drives_selection_and_heading(manager):  # noqa: F811
    make_event("Раннее мероприятие", dt.date(2026, 9, 10))
    make_event("Позднее мероприятие", dt.date(2026, 9, 20))

    resp = manager.get(RENDER, {"kind": "bulletin", "ext": "pdf", "asOf": "2026-09-15T08:00"})
    assert resp.status_code == 200, resp.content
    text = "".join(text_of(base64.b64decode(resp.json()["contentBase64"])).split())
    assert "08:00ч.15.09.2026" in text
    assert "Позднеемероприятие" in text
    assert "Раннеемероприятие" not in text

    bad = manager.get(RENDER, {"kind": "bulletin", "asOf": "вчера"})
    assert bad.status_code == 400, bad.content


def test_an_issue_freezes_rows_and_bytes(manager):  # noqa: F811
    make_event("Первое", dt.date(2026, 9, 20))
    issued = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")
    assert issued.status_code == 201, issued.content
    issue = issued.json()
    assert issue["eventCount"] == 1
    assert issue["asOf"].startswith("2026-09-15T08:00")
    assert issue["issuedBy"] != ""

    # Новое ОМ после выпуска: свежая сборка его видит, выпуск — нет.
    make_event("Второе", dt.date(2026, 9, 21))
    fresh = manager.get(RENDER, {"kind": "bulletin", "asOf": "2026-09-15T08:00"})
    assert "Второе" in "".join(text_of(base64.b64decode(fresh.json()["contentBase64"])).split())

    stored = manager.get(f"{ISSUES}{issue['id']}/file/")
    assert stored.status_code == 200, stored.content
    assert stored.json()["fileName"] == issue["fileName"]
    frozen = "".join(text_of(base64.b64decode(stored.json()["contentBase64"])).split())
    assert "Первое" in frozen
    assert "Второе" not in frozen

    listed = manager.get(ISSUES)
    assert [row["id"] for row in listed.json()["results"]] == [issue["id"]]


def test_an_issue_requires_a_slice(manager):  # noqa: F811
    """Без среза — 400 И ПОЛЕ НАЗВАНО (Plane №628).

    🔴 ПРОВЕРКА БЫЛА ТАВТОЛОГИЧНОЙ. Стояло
    `assert "asOf" in …details… or resp.status_code == 400`, а строкой выше уже
    проверено `status_code == 400`: правая часть `or` истинна всегда, и левая не
    выполнялась НИКОГДА. Проба осталась бы зелёной, верни ручка 400 с
    посторонним телом — например с переименованным ключом, — то есть стерегла
    не то, что обещает докстринг модуля.

    Названное поле — не придирка: форма подсвечивает по нему конкретный ввод, и
    «400 с любым телом» означало бы отказ без указания, что именно поправить.
    """
    resp = manager.post(ISSUES, {}, format="json")

    assert resp.status_code == 400, resp.content
    assert "asOf" in resp.json()["details"], resp.json()


# ── Ревью выпуска бюллетеня (Plane №620-№625) ───────────────────────────────


def test_a_non_numeric_issue_id_is_404_and_not_a_server_error(manager):  # noqa: F811
    """Нечисловой id выпуска — «не найдено», а не 500 (Plane №621).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Шаблон роутера — `[^/.]+`, и сырой сегмент адреса
    уходил в `filter(pk=…)`, где нечисловое значение поднимает `ValueError`
    внутри драйвера БД. `ops_exception_handler` пропускает не-`DomainError`
    дальше в DRF, и наружу шла трассировка. Проект это прямо запрещает и
    стережёт в трёх соседних модулях; здесь правило пропустили.

    Мутация, на которой проба обязана краснеть: снять `str(issue_id).isdigit()`.
    """
    for bad in ("abc", "1a", "-"):
        resp = manager.get(f"{ISSUES}{bad}/file/")
        assert resp.status_code == 404, f"{bad!r} → {resp.status_code}: {resp.content}"

    # Числовой, но несуществующий — тот же 404: проверка на цифры не должна
    # подменять собой проверку существования.
    assert manager.get(f"{ISSUES}999999/file/").status_code == 404


def test_issuing_needs_the_bulletin_right_not_read_access(manager):  # noqa: F811
    """Выпуск закрыт правом на ДЕЙСТВИЕ, а не на чтение (Plane №625).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Выпуск пишет постоянную строку в базу и PDF в приватное
    хранилище, а внешний ключ стоит `on_delete=PROTECT` — удалить выпущенное
    средствами продукта нельзя ничем. Под правом на чтение любой наблюдатель
    крутил POST-ы и забивал том неудаляемыми записями: ни дедупликации, ни
    троттлинга, ни проверки «этот срез уже выпущен» здесь нет.

    Список и выдача байтов остаются под `event.view` — выпуск показывает ровно
    то, что показывает реестр, и вторая мерка на одни сведения была бы лишней.
    Проба проверяет ОБА утверждения: без неё «закрыть выпуск» легко превращается
    в «закрыть весь раздел».

    Мутация, на которой проба обязана краснеть: вернуть `create` на
    `event.view` — читатель снова выпустит бюллетень.
    """
    from organization_management.apps.operations.tests.test_bulk_status_api import (
        client_for,
    )

    make_event("Мероприятие для выпуска", dt.date(2026, 9, 20))
    reader, _ = client_for("bulletin-reader", "BULLETIN_READER", perms=("event.view",))

    refused = reader.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")
    assert refused.status_code == 403, refused.content

    # Читать — можно: списком и байтами выпуск открыт тем же правом, что реестр.
    issued = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")
    assert issued.status_code == 201, issued.content
    assert reader.get(ISSUES).status_code == 200
    assert reader.get(f"{ISSUES}{issued.json()['id']}/file/").status_code == 200


def test_downloading_an_issue_is_written_to_the_audit_log(manager):  # noqa: F811
    """Выдача байтов выпуска оставляет след и сверяется по хэшу (Plane №620).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Путь хранилища открывался напрямую, мимо
    `document_service`, и вместе с ним пропадали обе его гарантии: сверка
    SHA-256 (подменённые или побитые байты уходили молча, под именем целого
    документа) и строка журнала `DOCUMENT_DOWNLOADED`, которую тот же модуль
    объявляет обязательной для ЛЮБОЙ выдачи байтов. Выпуск — это «что ушло
    адресатам»; выдача его без следа противоречит смыслу самой сущности.

    Мутация, на которой проба обязана краснеть: вернуть
    `document_storage.storage_path` + `open()` — строки в журнале не появится.
    """
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    make_event("Мероприятие выпуска", dt.date(2026, 9, 20))
    issue = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json").json()

    before = OpsAuditLog.objects.filter(action=audit_service.DOCUMENT_DOWNLOADED).count()
    assert manager.get(f"{ISSUES}{issue['id']}/file/").status_code == 200
    rows = OpsAuditLog.objects.filter(action=audit_service.DOCUMENT_DOWNLOADED)
    assert rows.count() == before + 1, "выдача выпуска не попала в журнал"
    assert rows.order_by("-id").first().new_value["original_name"] == issue["fileName"]


def test_broken_bytes_are_refused_instead_of_served(manager):  # noqa: F811
    """Порча хранилища — отказ, а не молча выданные байты (Plane №620).

    Вторая половина того же дефекта: без `document_service` хэш не сверялся
    вовсе, а пропажа файла давала голый 500 с трассировкой вместо конверта.
    """
    import os

    from organization_management.apps.operations import document_storage
    from organization_management.apps.operations.models_document import OpsBulletinIssue

    make_event("Мероприятие порчи", dt.date(2026, 9, 20))
    issue = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json").json()
    stored = OpsBulletinIssue.objects.select_related("attachment").get(pk=issue["id"])

    path = document_storage.storage_path(stored.attachment)
    with open(path, "ab") as handle:
        handle.write(b"\x00tampered")

    resp = manager.get(f"{ISSUES}{issue['id']}/file/")
    assert resp.status_code == 500, resp.content
    assert resp.json()["error_code"] == "DOCUMENT_INTEGRITY_FAILED", resp.json()

    # Пропажа байт — ТОТ ЖЕ конверт, а не 404 и не трассировка: строка есть,
    # значит документ выпускался, и отсутствие файла это порча.
    os.unlink(path)
    gone = manager.get(f"{ISSUES}{issue['id']}/file/")
    assert gone.status_code == 500, gone.content
    assert gone.json()["error_code"] == "DOCUMENT_INTEGRITY_FAILED", gone.json()


def test_the_same_slice_gives_the_same_document_both_ways(manager):  # noqa: F811
    """Один `asOf` — один документ, как его ни получай (Plane №624).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Выпуск переводил момент в местное время до отрисовки, а
    ручка отрисовки на лету отдавала разобранный aware-datetime как есть, и
    заголовок печатался с ТОЙ tzinfo, что пришла. `2026-09-15T00:30+00:00` через
    отрисовку давал «00:30 ч. 15.09.2026», а через выпуск — «05:30 ч.
    15.09.2026» (Asia/Almaty); около полуночи расходился и НАБОР мероприятий,
    потому что дата среза бралась из того же момента. Два документа с одним и
    тем же срезом в реквизитах — такой бюллетень спор «что было отправлено» не
    решает, а создаёт.

    Момент взят у полуночи по UTC НАРОЧНО: в местном поясе это уже следующий
    день, и разница видна не только в шапке.

    Мутация, на которой проба обязана краснеть: убрать приведение к местному
    времени из `render_bulletin` — шапки разойдутся.
    """
    make_event("Мероприятие среза", dt.date(2026, 9, 20))
    slice_at = "2026-09-15T00:30:00+00:00"

    rendered = manager.get(RENDER, {"kind": "bulletin", "ext": "pdf", "asOf": slice_at})
    assert rendered.status_code == 200, rendered.content
    on_the_fly = "".join(text_of(base64.b64decode(rendered.json()["contentBase64"])).split())

    issued = manager.post(ISSUES, {"asOf": slice_at}, format="json")
    assert issued.status_code == 201, issued.content
    stored = manager.get(f"{ISSUES}{issued.json()['id']}/file/")
    frozen = "".join(text_of(base64.b64decode(stored.json()["contentBase64"])).split())

    heading = "05:30ч.15.09.2026"  # Asia/Almaty от 00:30 UTC
    assert heading in on_the_fly, on_the_fly[:200]
    assert heading in frozen, frozen[:200]


def test_the_rows_are_collected_once_per_issue(manager, monkeypatch):  # noqa: F811
    """Снимок строк и PDF собираются ИЗ ОДНОГО чтения (Plane №623).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. `bulletin_rows` звался дважды — отдельно для снимка и
    ещё раз внутри отрисовщика. При READ COMMITTED коммит, пришедший между
    вызовами, разводит сохранённые `rows`/`event_count` и замороженный PDF: в
    строке выпуска одно, в приложенном документе другое. Рушится ровно та
    гарантия «что ушло адресатам», ради которой выпуск и заведён, — и заметить
    расхождение можно только сравнив снимок с PDF глазами.

    Мутация, на которой проба обязана краснеть: перестать передавать `rows` в
    `render_bulletin` — вызовов станет два.
    """
    from organization_management.apps.ops import bulletin_issues, documents_bulletin

    calls = []
    original = documents_bulletin.bulletin_rows

    def counting(*args, **kwargs):
        calls.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(documents_bulletin, "bulletin_rows", counting)
    monkeypatch.setattr(bulletin_issues, "bulletin_rows", counting)

    make_event("Мероприятие снимка", dt.date(2026, 9, 20))
    resp = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")

    assert resp.status_code == 201, resp.content
    assert len(calls) == 1, f"строки собраны {len(calls)} раза вместо одного"


def test_the_pdf_conversion_runs_outside_the_transaction(manager, monkeypatch):  # noqa: F811
    """Конвертация PDF идёт БЕЗ открытой транзакции (Plane №622).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Вся функция шла под `@transaction.atomic`, а внутри —
    `subprocess.run("soffice", …, timeout=60)`: каждое нажатие «Выпустить»
    держало открытое соединение Postgres всю конвертацию, до минуты. Несколько
    одновременных нажатий вычерпывали пул соединений, и вставало ВСЁ
    приложение, а не только бюллетень. Транзакция нужна двум записям и только
    им.

    Проба смотрит на `in_atomic_block` в момент отрисовки — то есть на сам
    факт, а не на его следствие: измерять время или занятость пула здесь
    значило бы гонять таймеры в тестах.

    Мутация, на которой проба обязана краснеть: вернуть `@transaction.atomic`
    на всю функцию.
    """
    from django.db import connection

    from organization_management.apps.ops import bulletin_issues

    seen = {}
    original = bulletin_issues.render_bulletin

    def watching(*args, **kwargs):
        seen["savepoints"] = len(connection.savepoint_ids)
        return original(*args, **kwargs)

    monkeypatch.setattr(bulletin_issues, "render_bulletin", watching)

    make_event("Мероприятие конвертации", dt.date(2026, 9, 20))
    # 🔴 СМОТРИМ НА ГЛУБИНУ, А НЕ НА `in_atomic_block`. Сам тест обёрнут в
    # транзакцию pytest-django, поэтому «ни одного открытого блока» здесь
    # недостижимо в принципе, и проверка `in_atomic_block` была бы зелёной
    # всегда — то есть вакуумной. Своя транзакция выпуска внутри чужой даёт
    # ТОЧКУ СОХРАНЕНИЯ, и её видно счётчиком.
    baseline = len(connection.savepoint_ids)
    resp = manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")

    assert resp.status_code == 201, resp.content
    assert seen["savepoints"] == baseline, (
        f"во время конвертации открыто точек сохранения {seen['savepoints']} "
        f"против {baseline} до запроса — транзакция объемлет отрисовку"
    )


def test_the_issue_writes_are_still_one_transaction(manager):  # noqa: F811
    """Вложение и выпуск пишутся вместе (обратная сторона Plane №622).

    Вынести конвертацию из транзакции легко, случайно вынеся из неё и ЗАПИСИ.
    Тогда вложение без выпуска оставалось бы мусором в хранилище, а выпуск без
    вложения — неоткрываемой строкой. Проба ломает вторую запись и требует,
    чтобы первая не осталась.
    """
    from unittest.mock import patch

    from organization_management.apps.operations.models_document import (
        OpsAttachment,
        OpsBulletinIssue,
    )

    make_event("Мероприятие отката", dt.date(2026, 9, 20))
    attachments_before = OpsAttachment.objects.count()

    with patch.object(
        OpsBulletinIssue.objects, "create", side_effect=RuntimeError("падение записи")
    ):
        with pytest.raises(RuntimeError):
            manager.post(ISSUES, {"asOf": "2026-09-15T08:00"}, format="json")

    assert OpsAttachment.objects.count() == attachments_before, (
        "вложение осталось без выпуска — записи разъехались по транзакциям"
    )
