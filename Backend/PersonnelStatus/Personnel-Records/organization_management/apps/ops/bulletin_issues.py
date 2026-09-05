"""Выпуски информационного бюллетеня (`[МД-01]`, `[БЛН-04]`, Plane №420).

Выпуск — срез (дата и время), кто выпустил, снимок строк и PDF. Это то, что
ушло адресатам: собрать бюллетень заново на тот же срез можно, но строки к
тому времени изменятся, и спор «что было отправлено» решает только выпуск.
"""
import datetime as dt
import io

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from organization_management.apps.operations import document_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_document import OpsBulletinIssue
from organization_management.apps.ops.documents_bulletin import (
    bulletin_rows,
    render_bulletin,
)


def parse_as_of(raw):
    """ISO-дата-время среза → aware datetime; пусто → `None` («сейчас»).

    Дата без времени — «на 08:00 ч.» этого дня: так читается заголовок образца
    (`[БЛН-01]`), и так же сборщик доопределял дату до этой задачи.
    """
    if raw in (None, ""):
        return None
    text = str(raw).strip()
    moment = parse_datetime(text)
    if moment is None:
        try:
            moment = dt.datetime.combine(dt.date.fromisoformat(text), dt.time(8, 0))
        except ValueError:
            raise DomainError(
                "VALIDATION_ERROR", 400,
                detail={"asOf": ["Ожидается дата и время среза в формате ISO."]},
                message="Срез бюллетеня не разобран.",
            )
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment)
    return moment


def serialize_issue(issue):
    return {
        "id": str(issue.pk),
        "asOf": issue.as_of.isoformat(),
        "issuedBy": issue.issued_by,
        "issuedAt": issue.created_at.isoformat() if issue.created_at else None,
        "eventCount": issue.event_count,
        "fileName": issue.attachment.original_name,
    }


def list_issues(limit=50):
    return [
        serialize_issue(issue)
        for issue in OpsBulletinIssue.objects.select_related("attachment")[:limit]
    ]


def issue_bulletin(*, as_of, actor):
    """Выпустить бюллетень на срез: строки и PDF замораживаются в выпуске.

    🔴 ТРАНЗАКЦИЯ НЕ ОБЪЕМЛЕТ КОНВЕРТАЦИЮ (Plane №622). Раньше вся функция шла
    под `@transaction.atomic`, а внутри — `render_bulletin(fmt="pdf")`, то есть
    `subprocess.run("soffice", …, timeout=60)`: каждое нажатие «Выпустить»
    держало открытое соединение Postgres всю конвертацию, до минуты. Несколько
    одновременных нажатий вычерпывали пул соединений, и вставало ВСЁ
    приложение, а не только бюллетень. Транзакция нужна двум записям и только
    им: вложение без выпуска — мусор в хранилище, выпуск без вложения —
    неоткрываемая строка.

    🔴 СТРОКИ СОБИРАЮТСЯ ОДИН РАЗ и передаются отрисовщику (Plane №623). Он
    собирал их ЗАНОВО, и при READ COMMITTED коммит между двумя сборками
    разводил сохранённый снимок и замороженный PDF — рушилась ровно та
    гарантия «что ушло адресатам», ради которой выпуск и заведён.
    """
    moment = parse_as_of(as_of)
    if moment is None:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"asOf": ["Укажите дату и время среза."]},
            message="Срез бюллетеня не задан.",
        )
    local = timezone.localtime(moment)
    rows = bulletin_rows(local.date())
    payload = render_bulletin(as_of=local, fmt="pdf", rows=rows)
    with transaction.atomic():
        attachment = document_service.create_attachment(
            source=io.BytesIO(payload),
            original_name=f"byulleten-{local.strftime('%Y%m%d-%H%M')}.pdf",
            content_type="application/pdf",
            actor=actor,
        )
        issue = OpsBulletinIssue.objects.create(
            as_of=moment,
            issued_by=actor,
            rows=rows,
            event_count=len(rows),
            attachment=attachment,
            created_by=actor,
        )
    return serialize_issue(issue)


def issue_file(issue_id, *, actor):
    """Байты выпуска — ЧЕРЕЗ `document_service` (Plane №620), а не из хранилища.

    Путь открывался напрямую, и мимо проходили обе гарантии, ради которых
    `document_service` написан:

    - **сверка SHA-256.** Записанный хэш отвечает на вопрос «что мы положили», а
      выдаём мы то, что ЛЕЖИТ СЕЙЧАС; между этими моментами файл мог быть
      подменён, обрезан сбоем диска или затёрт восстановлением. Подменённые
      байты уходили молча, под именем и номером целого документа.
    - **строка журнала `DOCUMENT_DOWNLOADED`.** Тот же модуль объявляет её
      обязательной для ЛЮБОЙ выдачи байтов хранимого документа; выпуск бюллетеня
      — то, «что ушло адресатам», и выдача его без следа противоречит смыслу
      самой сущности выпуска.

    Пропажа файла тоже перестала быть голым 500 с трассировкой: `open()` бросал
    `FileNotFoundError`, теперь это конверт `DOCUMENT_INTEGRITY_FAILED` — строка
    есть, значит документ выпускался, и отсутствие байт это порча, а не
    отсутствие объекта.

    🔴 НЕЧИСЛОВОЙ id — 404, А НЕ 500 (Plane №621). Шаблон роутера — `[^/.]+`, и
    сырой сегмент адреса уходил в `filter(pk=…)`, где нечисловое значение
    поднимает `ValueError` внутри драйвера БД; `ops_exception_handler` пропускает
    не-`DomainError` дальше в DRF, и наружу шла трассировка. В проекте это прямо
    запрещено и стережётся в трёх соседних модулях (`operations/selectors.py`,
    `ops/feedback.py`, `ops/duties.py`).
    """
    issue = (
        OpsBulletinIssue.objects.select_related("attachment")
        .filter(pk=issue_id)
        .first()
        if str(issue_id).isdigit()
        else None
    )
    if issue is None:
        raise DomainError(
            "ENTITY_NOT_FOUND", 404, detail={"id": str(issue_id)},
            message="Выпуск бюллетеня не найден.",
        )
    path = document_service.prepare_download(
        attachment=issue.attachment, actor=actor
    )
    with open(path, "rb") as handle:
        return issue.attachment.original_name, handle.read()
