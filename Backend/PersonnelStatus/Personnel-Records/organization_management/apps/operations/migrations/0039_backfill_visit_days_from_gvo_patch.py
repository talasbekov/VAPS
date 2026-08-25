"""Бэкфилл: секция «Объекты посещения» патча сводки ГВО переезжает в таблицу.

До этой миграции ответ на вопрос «какие объекты посещаются» жил в ДВУХ местах:
списком объектов мероприятия (`ops_security_event_visit_objects`, 24.08) и
свободным текстом патча сводки ГВО (ключ `visits`, блоки «дата | день недели» и
строки «объект | примечание»). Два списка расходились молча: объект, дописанный
в сводке, не появлялся в раскрытии реестра и не получал расстановки.

Переносится ровно то, что таблице было негде хранить: день посещения и
примечание. Строка патча ищется среди объектов ЭТОГО мероприятия по имени
(без учёта регистра и лишних пробелов). Не нашлась — строка создаётся: имя
объекта из сводки — это факт, введённый человеком, и терять его нельзя.
Ссылка на реестр у такой строки ищется по имени и остаётся пустой, если
объекта с таким именем в реестре нет — та же семантика, что у объекта,
удалённого из реестра: снимок имени продолжает его называть.

После переноса ключ `visits` снимается с патча, а патч, ставший пустым, —
удаляется: иначе сводка продолжила бы читать старый список, и расхождение
вернулось бы на следующей же правке.

Обратная миграция ключ `visits` НЕ восстанавливает: перенесённые данные лежат
в таблице и читаются оттуда, а восстановленный текст патча стал бы третьим
списком. Откат снимает только поля (миграция 0038).
"""
import re

from django.db import migrations

# «18.06.2026» — формат первой строки блока дня (formatRuDate фронта).
RU_DATE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
# Заглушка сводки: «уточняется» примечанием — это отсутствие примечания.
UNSPECIFIED = "уточняется"


def _iso_day(raw):
    match = RU_DATE.match(str(raw or "").strip())
    if match is None:
        return None
    day, month, year = match.groups()
    return f"{year}-{month}-{day}"


def _norm(name):
    return " ".join(str(name or "").split()).casefold()


def _note(raw):
    text = str(raw or "").strip()
    return "" if text == "" or text.casefold() == UNSPECIFIED else text[:255]


def forwards(apps, schema_editor):
    Patch = apps.get_model("operations", "OpsGvoSummaryPatch")
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    SecurityObject = apps.get_model("operations", "OpsSecurityObject")

    registry = {_norm(o.name): o.pk for o in SecurityObject.objects.all()}

    for rec in Patch.objects.select_related("event").iterator():
        patch = rec.patch if isinstance(rec.patch, dict) else {}
        days = patch.get("visits")
        if not isinstance(days, list):
            continue

        rows = list(VisitObject.objects.filter(event_id=rec.event_id))
        by_name = {_norm(r.object_name): r for r in rows}
        next_position = max((r.position for r in rows), default=-1) + 1
        # Ссылки реестра, уже занятые строками этого ОМ: один объект реестра
        # в одном мероприятии дважды не заводится (уникальность в базе), а
        # переименование объекта в реестре как раз даёт такую пару — снимок
        # имени у строки старый, имя в сводке новое. Новая строка в этом
        # случае остаётся без ссылки, со снимком имени из сводки.
        used_objects = {r.security_object_id for r in rows if r.security_object_id}

        for day in days:
            if not isinstance(day, dict):
                continue
            iso = _iso_day(day.get("day"))
            for item in day.get("items") or []:
                if not isinstance(item, dict):
                    continue
                name = " ".join(str(item.get("obj") or "").split())
                if name == "":
                    continue
                note = _note(item.get("note"))
                row = by_name.get(_norm(name))
                if row is None:
                    link = registry.get(_norm(name))
                    if link in used_objects:
                        link = None
                    row = VisitObject.objects.create(
                        event_id=rec.event_id,
                        security_object_id=link,
                        object_name=name[:255],
                        passport_binding=None,
                        protected_person_id=None,
                        protected_person_name="",
                        position=next_position,
                        visit_day=iso,
                        note=note,
                    )
                    next_position += 1
                    by_name[_norm(name)] = row
                    if link is not None:
                        used_objects.add(link)
                    continue
                row.visit_day = iso
                row.note = note
                row.save(update_fields=["visit_day", "note", "updated_at"])

        remaining = {k: v for k, v in patch.items() if k != "visits"}
        if remaining:
            rec.patch = remaining
            rec.save(update_fields=["patch", "updated_at"])
        else:
            rec.delete()


def backwards(apps, schema_editor):
    """Ничего: перенесённые данные читаются из таблицы, и восстановленный
    текст патча стал бы третьим списком объектов посещения."""


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0038_opssecurityeventvisitobject_note_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
