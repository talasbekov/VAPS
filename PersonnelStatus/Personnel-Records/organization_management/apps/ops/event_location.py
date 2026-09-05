"""Локация ОМ структурой и атрибуты лиц на мероприятии (Plane №418,
`[МД-02]` `[МД-03]`, шаг Ш-2 плана P2).

Отдельный модуль, а не правка `security_events.py` целиком: тот под пять
тысяч строк и одновременно у соседних сессий; здесь — разбор входа и
сборка подписи, а `create_event`/`update_bulletin_details` зовут его.
"""
import datetime as dt

from django.utils import timezone

from organization_management.apps.operations.models_event import (
    OpsSecurityEventPerson,
)
from organization_management.apps.operations.models_geo import OpsCity, OpsCountry


def compose_location(country, city, address):
    """Строка `location` из структуры: «Страна, Город, адрес» без пустых."""
    parts = [
        country.name if country is not None else "",
        city.name if city is not None else "",
        (address or "").strip(),
    ]
    return ", ".join(p for p in parts if p)[:255]


def resolve_location(*, country_id, city_id, address, field_errors, unchanged=()):
    """Страна и город из справочника; город обязан принадлежать стране.

    Возвращает `(country, city, address)`. Неизвестный или скрытый
    идентификатор — ошибка поля, не пропуск: молча выброшенную страну
    человек заметил бы только по бюллетеню, в котором её нет.

    🔴 `unchanged` — ПОЛЯ, ЧЕЙ ID У МЕРОПРИЯТИЯ УЖЕ СТОИТ (Plane №617/№495).
    Для них скрытая строка справочника принимается: она не новый ввод, а то,
    что было выбрано раньше и уже сохранено. Требовать `is_active` от неё —
    значит запирать мероприятие целиком: окно правки шлёт `countryId`/`cityId`
    ВСЕГДА, поэтому после скрытия города любая правка бюллетеня (переименование,
    время, лица) отвечала 400 «Город не найден в справочнике» — про поле,
    которого человек не касался.

    Это прямо противоречило замыслу, записанному на самой модели: у ссылки
    стоит `SET_NULL` с доводом «скрытие города из справочника не вправе стирать
    историю мероприятий». Скрытие — обычная операция ведения справочника, а
    последствие наступало не сразу и не у того, кто скрывал.

    НОВЫЙ выбор по-прежнему строгий: скрытый город нельзя ВЫБРАТЬ, его можно
    только СОХРАНИТЬ ТАКИМ, КАКИМ ОН БЫЛ.
    """
    country = None
    raw_country = str(country_id or "").strip()
    if raw_country:
        country_filter = {"pk": raw_country}
        if "countryId" not in unchanged:
            country_filter["is_active"] = True
        country = (
            OpsCountry.objects.filter(**country_filter).first()
            if raw_country.isdigit()
            else None
        )
        if country is None:
            field_errors["countryId"] = ["Страна не найдена в справочнике."]
    city = None
    raw_city = str(city_id or "").strip()
    if raw_city:
        city_filter = {"pk": raw_city}
        if "cityId" not in unchanged:
            city_filter["is_active"] = True
        city = (
            OpsCity.objects.filter(**city_filter)
            .select_related("country")
            .first()
            if raw_city.isdigit()
            else None
        )
        if city is None:
            field_errors["cityId"] = ["Город не найден в справочнике."]
        elif country is not None and city.country_id != country.pk:
            field_errors["cityId"] = ["Город не относится к выбранной стране."]
        elif country is None:
            # Город назван, страна нет — страна выводится из города: две
            # координаты одной точки не должны расходиться.
            country = city.country
    address = str(address or "").strip()
    if len(address) > 255:
        field_errors["address"] = ["Не длиннее 255 символов."]
    return country, city, address


def location_view(event):
    return {
        "countryId": str(event.country_id) if event.country_id else None,
        "countryName": event.country.name if event.country_id else "",
        "cityId": str(event.city_id) if event.city_id else None,
        "cityName": event.city.name if event.city_id else "",
        "address": event.address,
    }


# ── Лица на мероприятии ─────────────────────────────────────────────────────

_DETAIL_KEYS = {
    "arrivalAt": "arrival_at",
    "departureAt": "departure_at",
    "flightArrival": "flight_arrival",
    "flightDeparture": "flight_departure",
    "isSenior": "is_senior",
    "note": "note",
}


def _parse_when(value, errors, key):
    raw = str(value or "").strip()
    if raw == "":
        return None
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except ValueError:
        errors.append(f"{key}: укажите дату и время в формате ГГГГ-ММ-ДДTЧЧ:ММ.")
        return None
    # Ввод без смещения — местное время (как <input type="datetime-local">);
    # хранится aware, отдаётся тем же местным временем без смещения.
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _when_view(value):
    if value is None:
        return None
    return timezone.localtime(value).strftime("%Y-%m-%dT%H:%M")


def parse_person_details(raw_details, field_errors, field="protectedPersonDetails"):
    """`[{id, arrivalAt, departureAt, flightArrival, flightDeparture,
    isSenior, note}]` → `{person_id: {поле модели: значение}}`.

    Ключи, которых нет в строке, не трогаются (частичная правка), поэтому
    разбор возвращает только названные поля.
    """
    if raw_details is None:
        return None
    if not isinstance(raw_details, list):
        field_errors[field] = ["Ожидается список строк."]
        return None
    details = {}
    errors = []
    for row in raw_details:
        if not isinstance(row, dict):
            errors.append("строка должна быть объектом")
            continue
        person_id = str(row.get("id") or "").strip()
        if not person_id.isdigit():
            errors.append("у строки нет идентификатора лица")
            continue
        fields = {}
        for key, model_field in _DETAIL_KEYS.items():
            if key not in row:
                continue
            value = row[key]
            if model_field in ("arrival_at", "departure_at"):
                fields[model_field] = _parse_when(value, errors, key)
            elif model_field == "is_senior":
                fields[model_field] = bool(value)
            else:
                text = str(value or "").strip()
                limit = 255 if model_field == "note" else 100
                if len(text) > limit:
                    errors.append(f"{key}: не длиннее {limit} символов.")
                fields[model_field] = text
        details[person_id] = fields
    if errors:
        field_errors[field] = errors
    return details


def apply_person_details(event, details):
    """Записать атрибуты лицам, которые УЖЕ на мероприятии; чужие
    идентификаторы пропускаются молча — состав задаёт `protectedPersonIds`,
    а не эта таблица."""
    if not details:
        return
    links = {
        str(link.person_id): link for link in event.person_links.all()
    }
    for person_id, fields in details.items():
        link = links.get(person_id)
        if link is None or not fields:
            continue
        for name, value in fields.items():
            setattr(link, name, value)
        link.save(update_fields=list(fields))


def person_links_view(event):
    """Лица бюллетеня с атрибутами визита — отсортированы по имени, как и
    прежний список: у связи своего порядка нет."""
    rows = []
    for link in event.person_links.select_related("person").all():
        p = link.person
        rows.append(
            {
                "id": str(p.pk),
                "code": p.display_code,
                "name": p.name,
                "arrivalAt": _when_view(link.arrival_at),
                "departureAt": _when_view(link.departure_at),
                "flightArrival": link.flight_arrival,
                "flightDeparture": link.flight_departure,
                "isSenior": link.is_senior,
                "note": link.note,
            }
        )
    return sorted(rows, key=lambda r: r["name"])


__all__ = [
    "OpsSecurityEventPerson",
    "apply_person_details",
    "compose_location",
    "location_view",
    "parse_person_details",
    "person_links_view",
    "resolve_location",
]
