"""Слияние снятых кодов участия в «Участие в ОМ» (Plane №486, починка №752).

🔴 ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Логика слияния родилась внутри миграции 0091 и
там же осталась заперта, а миграция оказалась НЕВЫПОЛНИМОЙ на всех базах,
кроме той, где `IN_EVENT` завели руками: `forwards` рано выходит, если целевого
типа нет, а не создаёт его ни одна миграция — он появляется только из
`seed_status_types`, который гоняется ПОСЛЕ `migrate`. Миграция при этом
записывается применённой, и вернуться к ней уже нечем.

Поэтому правило вынуто из миграции в обычный модуль: его зовёт починочная
миграция 0092 (историческими моделями) и проверяет проба (настоящими). Пока
оно жило только внутри `RunPython`, проверить его было нечем — оттого дефект и
дожил до ревью.

ЦЕЛЕВОЙ ТИП СОЗДАЁТСЯ ЗДЕСЬ, А НЕ ЖДЁТСЯ ОТ СИДА. Данные мигрирует миграция,
и зависеть от команды, которую администратор запускает отдельно и позже, она
не имеет права. Прецедент в разделе есть: 0057 так же заводит тип статуса.
"""

from organization_management.apps.operations.models_status import UNKNOWN_EVENT_ID

TARGET = "IN_EVENT"
TARGET_NAME = "Участие в ОМ"
#: Те же значения, что кладёт `seed_status_types`: справочник обязан выглядеть
#: одинаково, кто бы ни завёл строку первым.
TARGET_PRIORITY = 75
TARGET_COLUMN = "IN_SERVICE"

SQUAD = "EVENT_ASSIGNMENT"
GROUP = "EVENT_ASSIGNMENT_GROUP"
KIND_BY_LEGACY_CODE = {SQUAD: "PHYSICAL_SQUAD", GROUP: "SCREENING_GROUP"}


def ensure_target_type(StatusType):
    """Целевой тип есть — вернуть его; нет — завести по образцу снятого.

    Свойства берутся у legacy-типа, когда он есть: у слитых кодов колонка
    расхода, участие в штате и жёсткость блокировки уже настроены, и
    придумывать их заново значило бы завести ТРЕТЬЮ правду о том же статусе.
    """
    existing = StatusType.objects.filter(code=TARGET).first()
    if existing is not None:
        return existing
    sample = StatusType.objects.filter(code__in=(SQUAD, GROUP)).first()
    defaults = {
        "name": TARGET_NAME,
        "priority": TARGET_PRIORITY,
        "report_column_code": (
            sample.report_column_code if sample is not None else TARGET_COLUMN
        ),
    }
    for field in ("counts_in_staff", "is_ku_owned", "is_hard_block",
                  "restricts_editing", "is_placeholder"):
        if sample is not None and hasattr(sample, field):
            defaults[field] = getattr(sample, field)
    return StatusType.objects.create(code=TARGET, **defaults)


def merge_legacy_participation_types(StatusType, Status, Participation):
    """Перевести строки снятых кодов в `IN_EVENT` и погасить сами коды.

    Идемпотентна: строк на снятых кодах не осталось — делать нечего. Возвращает
    счётчики, чтобы починочная миграция могла сказать, что именно сделала.
    """
    report = {"target_created": False, "statuses": 0, "kinds": 0, "deactivated": 0}
    # 🔴 СЛИВАТЬ НЕЧЕГО — НЕ ТРОГАЕМ СПРАВОЧНИК ВООБЩЕ. На базе, где снятых
    # кодов не было никогда (пустой каталог, который наполнит сид), заведение
    # целевого типа означало бы, что миграция ЗА СИД решает, каким справочник
    # быть. Поймано прогоном: четыре пробы держат состав каталога после голых
    # миграций, и лишняя строка ломала их — не «пины устарели», а миграция
    # лезла не в своё дело.
    #
    # Проверяются И типы, И строки: тип мог быть удалён руками, а исторические
    # строки на его коде остаться — их всё равно надо перевести.
    if not (
        StatusType.objects.filter(code__in=(SQUAD, GROUP)).exists()
        or Status.objects.filter(status_type_code__in=(SQUAD, GROUP)).exists()
    ):
        return report
    before = StatusType.objects.filter(code=TARGET).exists()
    ensure_target_type(StatusType)
    report["target_created"] = not before

    for legacy, kind in KIND_BY_LEGACY_CODE.items():
        for status in Status.objects.filter(status_type_code=legacy).iterator():
            rows = list(status.participations.all())
            # Вид ДОПИСЫВАЕТСЯ только там, где его нет: у строк цепочки он уже
            # верный, и переписывать его прежним кодом значило бы затереть факт
            # догадкой.
            for row in rows:
                if not row.kind_code:
                    row.kind_code = kind
                    row.save(update_fields=["kind_code"])
                    report["kinds"] += 1
            if not rows:
                # Участия нет вовсе — исторический факт из-под бэкфилла Ш-3.
                # `UNKNOWN_EVENT_ID` — «мероприятие неизвестно»: ссылка
                # плоская, внешнего ключа нет. Уборка сирот этот маркер
                # пропускает (Plane №753) — иначе она уносила бы ровно те
                # строки, ради которых слияние и писалось.
                Participation.objects.create(
                    status=status,
                    event_id=UNKNOWN_EVENT_ID,
                    kind_code=kind,
                    role_code="",
                )
                report["kinds"] += 1
            status.status_type_code = TARGET
            status.save(update_fields=["status_type_code"])
            report["statuses"] += 1

    report["deactivated"] = StatusType.objects.filter(
        code__in=(SQUAD, GROUP), is_active=True
    ).update(is_active=False)
    return report
