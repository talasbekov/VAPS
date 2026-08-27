"""Реестр транспорта ГОН — чтение (Plane №215).

ПОЧЕМУ ТОЛЬКО ЧТЕНИЕ. В этом разделе справочник правится в Django Admin, а не
своим экраном: та же мерка, что у охраняемых лиц и нормативной базы («Admin =
справочники»). Заводить рядом вторую, безусловную дверь в те же строки значит
получить две правды о том, кто и как их меняет.

ОТБОР СЧИТАЕТ СЕРВЕР, а не браузер: реестр ГОН — это сотни строк, и отбор по
классу брони на клиенте означал бы гонять их все ради десяти.
"""
from django.db import models

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_vehicle import (
    OpsEventVehicle,
    OpsVehicle,
)


def _row(car):
    return {
        "id": str(car.id),
        "brand": car.brand,
        "bodyClass": car.body_class,
        # Год отдаётся ЧИСЛОМ или null, а не пустой строкой: «неизвестно» и
        # «нулевой год» — разные вещи, и склеивать их в одну строку значит
        # заставлять экран угадывать.
        "productionYear": car.production_year,
        "plate": car.plate,
        "armorClass": car.armor_class,
        "deployment": car.deployment,
        "note": car.note,
        "isActive": car.is_active,
    }


def list_vehicles(*, armor_class=None, deployment=None, search=None, include_retired=False):
    """Строки реестра.

    По умолчанию — только ДЕЙСТВУЮЩИЕ: снятая машина живёт ради истории
    мероприятий, а не ради того, чтобы её выделили снова. `include_retired`
    показывает весь парк — это нужно администратору, который разбирается,
    куда делась машина.
    """
    query = OpsVehicle.objects.all()
    if not include_retired:
        query = query.filter(is_active=True)
    if armor_class:
        query = query.filter(armor_class__iexact=str(armor_class).strip())
    if deployment:
        query = query.filter(deployment__icontains=str(deployment).strip())
    if search:
        needle = str(search).strip()
        if needle:
            # Марка И номер: человек ищет либо «Maybach», либо «001 qq 01», и
            # заставлять его выбирать поле поиска незачем.
            query = query.filter(
                models.Q(brand__icontains=needle) | models.Q(plate__icontains=needle)
            )
    return [_row(car) for car in query]


def armor_classes():
    """Классы брони, КОТОРЫЕ ЕСТЬ В ПАРКЕ, — для отбора на экране.

    Считаются по данным, а не по перечислению: класс брони у машины —
    свободная строка (в модели сказано почему), и жёсткий список в отборе
    разошёлся бы с парком в первый же завоз.
    """
    return sorted(
        value
        for value in OpsVehicle.objects.filter(is_active=True)
        .values_list("armor_class", flat=True)
        .distinct()
        if value
    )


# ── Выделение транспорта на мероприятие (Plane №215) ────────────────────────


def _allocation_row(row):
    return {
        "id": str(row.id),
        "vehicleId": str(row.vehicle_id) if row.vehicle_id is not None else None,
        # Подпись — СНИМОК: удалённая из реестра машина продолжает называть
        # себя в истории мероприятия, у которого она была.
        "label": row.vehicle_label,
        "callsign": row.callsign,
        "purpose": row.purpose,
        # Живые сведения машины — только пока ссылка цела. Их отсутствие
        # экран обязан отличать от пустого класса брони, поэтому null.
        "plate": row.vehicle.plate if row.vehicle is not None else None,
        "armorClass": row.vehicle.armor_class if row.vehicle is not None else None,
        "position": row.position,
    }


def list_event_vehicles(event):
    return [
        _allocation_row(row)
        for row in event.vehicles.select_related("vehicle").all()
    ]


def allocate_vehicle(event, *, vehicle_id, callsign="", purpose=""):
    """Выделить машину реестра на мероприятие.

    Снятая с эксплуатации машина не выделяется: `is_active=False` означает
    «этой машины в парке больше нет», и разрешить её значило бы поставить в
    кортеж то, чего не существует.
    """
    car = OpsVehicle.objects.filter(pk=vehicle_id).first()
    if car is None:
        raise DomainError(
            "VEHICLE_NOT_FOUND", 404, message="Машина не найдена в реестре."
        )
    if not car.is_active:
        raise DomainError(
            "VEHICLE_RETIRED",
            422,
            message="Машина снята с эксплуатации — выделить её нельзя.",
        )
    if event.vehicles.filter(vehicle=car).exists():
        raise DomainError(
            "VEHICLE_ALREADY_ALLOCATED",
            422,
            message="Эта машина уже выделена на мероприятие.",
        )
    last = event.vehicles.order_by("-position").values_list(
        "position", flat=True
    ).first()
    OpsEventVehicle.objects.create(
        event=event,
        vehicle=car,
        vehicle_label=f"{car.brand} ({car.plate})",
        callsign=str(callsign or "").strip(),
        purpose=str(purpose or "").strip(),
        position=(last or 0) + 1,
    )
    return event


def release_vehicle(event, allocation_id):
    """Снять машину с мероприятия."""
    row = event.vehicles.filter(pk=allocation_id).first()
    if row is None:
        raise DomainError(
            "ALLOCATION_NOT_FOUND",
            404,
            message="Такого выделения на этом мероприятии нет.",
        )
    row.delete()
    return event
