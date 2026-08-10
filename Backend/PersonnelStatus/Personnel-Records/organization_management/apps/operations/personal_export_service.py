"""Выдача личной копии сданного дня (порт personal_export_service.py из
Backend/VAPS).

ORM-обвязка вокруг чистого билдера: подставляет то, чего в снимке нет (имя
подразделения, подписи типов статусов, локальное время сдачи), проверяет
версию схемы снимка и ФИКСИРУЕТ САМ ФАКТ ВЫГРУЗКИ в журнале.

Порядок жёсткий: гард схемы → байты → запись в журнал → отдача. Журнал
означает «файл ОТДАН», а не «кто-то нажал кнопку», поэтому отказ по схеме
строки в нём не оставляет. Запись не глушится try/except и не откладывается:
нет журнала — нет и выдачи. Личная копия существует именно затем, чтобы
предъявлять её в споре, и выдача без следа обесценила бы обе стороны — и
файл, и журнал.

Часы здесь не читаются вовсе: время сдачи берётся из строки, а не с часов
раздела. Копия не документ учёта — ни номера, ни хранения на диске ей не
нужно, байты живут только в памяти ответа.
"""
from zoneinfo import ZoneInfo

from django.conf import settings

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.personal_export import (
    build_personal_export_xlsx,
)
from organization_management.apps.operations.selectors import (
    DivisionTreeSelector,
    StatusTypeSelector,
)
from organization_management.apps.operations.snapshot import SCHEMA_VERSION
from organization_management.apps.operations.strength_report import names_of

# Подписи события сдачи. Незнакомый код печатается сам: словарь событий
# вырастет раньше этого места, и файл обязан это пережить.
EVENT_LABELS = {
    "CONFIRMED_NO_CHANGES": "Без изменений",
    "CHANGED": "С изменениями",
    "AMENDED": "Исправление",
}
SUBMITTED_AT_FORMAT = "%d.%m.%Y %H:%M"


def event_label(event):
    return EVENT_LABELS.get(event, event)


def _submitted_at_label(submitted_at):
    """Время сдачи в локальной зоне СТРОКОЙ.

    Строка, а не datetime: openpyxl не пишет в ячейку значение с зоной, а
    отдать его без зоны значило бы напечатать UTC под видом местного.
    """
    local_tz = ZoneInfo(getattr(settings, "OPS_LOCAL_TIMEZONE", settings.TIME_ZONE))
    return submitted_at.astimezone(local_tz).strftime(SUBMITTED_AT_FORMAT)


# Какие раскладки снимка этот читатель понимает. МНОЖЕСТВО, а не последняя
# версия, и это то, ради чего версия вообще заведена: сдачи уже подписаны и
# лежат в базе со СВОЕЙ раскладкой, а сравнение с одной лишь текущей версией
# означало бы, что каждое расширение снимка отбирает у людей личную копию их
# собственного подписанного дня.
#
# Версия 2 добавила к людям уровень должности — поле ДОБАВИЛА, ничего не сдвинув,
# поэтому первая раскладка читается тем же кодом. Версия, которая что-то
# переставит или переименует, из этого множества выпадет, и читателя придётся
# учить ей осознанно — ровно тогда отказ и нужен.
# Версии перечислены ЯВНО, а не «единица и текущая»: прежняя запись
# {1, SCHEMA_VERSION} молча теряла бы среднюю версию при каждом повышении —
# с переходом на 3 из поддержки выпала бы двойка, то есть все дни, сданные
# между двумя срезами, перестали бы выгружаться.
SUPPORTED_SCHEMA_VERSIONS = frozenset({1, 2, 3, 4, 5, 6, 7})
# ...но текущая версия обязана быть среди них, и это держится здесь, а не
# памятью: повышение SCHEMA_VERSION без правки списка сорвалось бы на импорте
# модуля, то есть на первом же прогоне, а не на выгрузке у пользователя.
assert SCHEMA_VERSION in SUPPORTED_SCHEMA_VERSIONS, (
    f"схема снимка {SCHEMA_VERSION} не перечислена в поддерживаемых: "
    "личная копия перестала бы выгружать свежие сдачи"
)


def _assert_snapshot_schema_supported(snapshot):
    """Отказ на неподдерживаемом снимке ДО генерации и ДО журнала.

    Сравнение по точному типу: isinstance пропустил бы True как единицу, и файл
    собрался бы по чужой раскладке, ничего об этом не сказав.
    """
    schema_version = snapshot.get("schema_version")
    if type(schema_version) is not int or schema_version not in (
        SUPPORTED_SCHEMA_VERSIONS
    ):
        raise DomainError(
            "SNAPSHOT_SCHEMA_UNSUPPORTED",
            422,
            detail={
                "schema_version": repr(schema_version),
                "supported": sorted(SUPPORTED_SCHEMA_VERSIONS),
            },
            message="Снимок сдачи имеет неподдерживаемую версию схемы.",
        )


def export_submission(*, submission, actor):
    """Строка сдачи → (байты .xlsx, имя файла); пишет событие выгрузки."""
    snapshot = submission.snapshot
    _assert_snapshot_schema_supported(snapshot)

    # Название — ИЗ СНИМКА (схема 5), живое только запасное для старых версий:
    # переименование подразделения не смеет менять паспорт уже выданной копии.
    #
    # Подразделения может не быть в выборке (расформировано) — печатается его
    # id: копия обязана выйти и о расформированном, иначе доказать сданное
    # стало бы невозможно ровно там, где это нужнее всего.
    names = DivisionTreeSelector.names_map([submission.division_id])
    division_title = (
        snapshot.get("division_title")
        or names.get(submission.division_id)
        or str(submission.division_id)
    )

    payload = build_personal_export_xlsx(
        snapshot=snapshot,
        division_title=division_title,
        business_date=submission.business_date,
        version=submission.version,
        is_current=submission.is_current,
        event_label=event_label(submission.event),
        submitted_by=submission.submitted_by,
        submitted_at_label=_submitted_at_label(submission.submitted_at),
        late=submission.late,
        # Подписи — из снимка, живые только запасные: переименование типа не
        # смеет менять уже выданную копию (см. names_of).
        status_names=names_of(snapshot, StatusTypeSelector.names_map()),
    )
    filename = (
        f"сдача_{submission.business_date.isoformat()}_v{submission.version}.xlsx"
    )

    audit_service.record(
        actor=actor,
        action=audit_service.SUBMISSION_EXPORTED,
        entity_type=audit_service.ENTITY_SUBMISSION,
        entity_id=submission.pk,
        new_value={
            "submission_id": submission.pk,
            "division_id": submission.division_id,
            "business_date": submission.business_date.isoformat(),
            "version": submission.version,
            "is_current": submission.is_current,
            "event": submission.event,
            # Размер списка — единственная «мера» файла в журнале: по ней
            # видно, что выгрузили не пустышку, и она не тащит в журнал сам
            # снимок, который весит сотни килобайт.
            "roster_size": len(snapshot.get("roster") or []),
        },
    )
    return payload, filename
