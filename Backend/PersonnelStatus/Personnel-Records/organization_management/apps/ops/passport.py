"""Паспорт объекта: свежесть, KPI, правка черновика, публикация версии.

Свежесть — ПРОИЗВОДНОЕ на чтении: считается от effectiveFrom последней
публикации, бизнес-даты (Clock) и хранимой политики (§21.7 запрещает выводить
срок из константы в коде). Формулы повторяют клиентский расчёт мок-слоя
(entities/security-object/model/freshness.ts) — он и был контрактом, под
который написан экран; расхождение в математике окрасило бы один и тот же
паспорт по-разному на списке и в моке e2e.
"""
import datetime as dt
import math

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_object import (
    OpsObjectSector,
    OpsPassportFreshnessPolicy,
    OpsPassportVersion,
    OpsSecurityObject,
    OpsSecurityPost,
)

# Показатели прототипа, которых модель не выдаёт, — честный список с причиной
# (контракт unavailableKpi). Порт фикстуры клиента: пока считать нечего, об
# этом говорит СЕРВЕР, а не заглушка на экране.
UNAVAILABLE_KPI = [
    {
        "code": "OPEN_REMARKS",
        "label": "Есть открытые замечания",
        "reason": (
            "Замечания по объекту не моделируются: у объекта есть паспорт, "
            "секторы и посты, но нет журнала замечаний — считать было бы "
            "нечего."
        ),
    },
    {
        "code": "MISSING_REQUIRED_SCHEME",
        "label": "Нет обязательной схемы",
        "reason": (
            "Схемы и документы объекта требуют blob-хранилища, которого в "
            "этом срезе нет."
        ),
    },
]


def read_policy():
    """Действующая политика. Отсутствие строки — отказ, а не дефолт в коде:
    подставленный интервал был бы ровно той константой, которую §21.7
    запрещает, и результат нёс бы версию политики, которой не существует."""
    policy = OpsPassportFreshnessPolicy.objects.filter(singleton_key=1).first()
    if policy is None:
        raise DomainError(
            "VALIDATION_ERROR",
            422,
            detail={"policy": ["Политика актуальности паспорта не настроена."]},
            message="Политика актуальности паспорта не настроена.",
        )
    return policy


def resolve_freshness(security_object, policy, business_date):
    """Свежесть одной строки реестра; версии обязаны быть предзагружены."""
    versions = list(security_object.passport_versions.all())
    if not versions:
        return {
            "objectId": str(security_object.pk),
            "state": "NO_PUBLISHED_VERSION",
            "verificationDueAt": None,
            "freshnessPolicyVersion": policy.version,
        }
    latest = max(versions, key=lambda v: v.version_number)
    due_at = latest.effective_from + dt.timedelta(
        days=policy.verification_interval_days
    )
    days_left = (due_at - business_date).days
    due_soon_threshold = math.ceil(
        policy.verification_interval_days * policy.due_soon_percent / 100
    )
    if days_left < 0:
        state = "OVERDUE"
    elif days_left <= due_soon_threshold:
        state = "DUE_SOON"
    else:
        state = "FRESH"
    return {
        "objectId": str(security_object.pk),
        "state": state,
        "verificationDueAt": due_at.isoformat(),
        "freshnessPolicyVersion": policy.version,
    }


def build_kpi(objects, freshness_rows):
    state_by_id = {row["objectId"]: row["state"] for row in freshness_rows}
    return {
        "total": len(objects),
        "passportGreen": sum(1 for o in objects if o.passport_state == "GREEN"),
        "passportYellow": sum(1 for o in objects if o.passport_state == "YELLOW"),
        "passportRed": sum(1 for o in objects if o.passport_state == "RED"),
        "verificationOverdue": sum(
            1 for o in objects if state_by_id.get(str(o.pk)) == "OVERDUE"
        ),
        "neverPublished": sum(
            1
            for o in objects
            if state_by_id.get(str(o.pk)) == "NO_PUBLISHED_VERSION"
        ),
    }


def _validation(field_errors):
    return DomainError(
        "VALIDATION_ERROR",
        400,
        detail=field_errors,
        message="Проверьте заполнение паспорта.",
    )


def _validate_sectors_payload(sectors):
    """Построчные ошибки под ключами формы клиента (sectors.{i}...)."""
    field_errors = {}
    if not isinstance(sectors, list):
        raise _validation({"sectors": ["Ожидается список секторов."]})
    for i, sector in enumerate(sectors):
        name = str((sector or {}).get("name", ""))
        if name.strip() == "":
            field_errors[f"sectors.{i}.name"] = ["Укажите название сектора."]
        posts = (sector or {}).get("posts", [])
        if not isinstance(posts, list):
            field_errors[f"sectors.{i}.posts"] = ["Ожидается список постов."]
            continue
        for j, post in enumerate(posts):
            post_name = str((post or {}).get("name", ""))
            if post_name.strip() == "":
                field_errors[f"sectors.{i}.posts.{j}.name"] = [
                    "Укажите название поста."
                ]
    if field_errors:
        raise _validation(field_errors)


@transaction.atomic
def create_object(*, name, object_type, region, address, ownership=None):
    """Завести объект охраны прямо из окна создания ОМ.

    Реестр объектов ведёт владелец объекта, но заказчику нужен путь «объекта
    нет в списке — добавить» на месте (ClickUp 86eyqf7a7): иначе бюллетень
    упирается в чужой процесс. Поэтому заводится МИНИМАЛЬНАЯ карточка, а не
    полная: имя обязательно, остальное — то, что человек знает в этот момент.

    Код НЕ спрашивается у человека: он уникален в реестре, и придуманный на
    ходу дубль отбивался бы ограничением базы уже после заполнения формы.
    Номер выдаётся по порядку реестра.

    Паспорт у новой карточки НЕ оформлен (RED) — это факт, а не заготовка:
    секторы и посты заводит владелец объекта в своём разделе, и до публикации
    версии привязывать к мероприятию нечего.
    """
    field_errors = {}
    name = str(name or "").strip()
    if name == "":
        field_errors["name"] = ["Обязательное поле."]
    elif len(name) > 255:
        field_errors["name"] = ["Не длиннее 255 символов."]
    elif OpsSecurityObject.objects.filter(name__iexact=name).exists():
        # Тёзка в реестре — почти всегда повтор ввода, а не второй объект с
        # тем же именем: две одинаковые строки в выпадающем списке потом
        # неразличимы.
        field_errors["name"] = ["Объект с таким названием уже есть в реестре."]

    object_type = str(object_type or "").strip()
    region = str(region or "").strip()
    address = str(address or "").strip()
    for field, value, limit in (
        ("objectType", object_type, 100),
        ("region", region, 255),
        ("address", address, 500),
    ):
        if len(value) > limit:
            field_errors[field] = [f"Не длиннее {limit} символов."]

    ownership = str(ownership or OpsSecurityObject.Ownership.GUARDED).strip()
    if ownership not in dict(OpsSecurityObject.Ownership.choices):
        field_errors["ownership"] = ["Неизвестный вид принадлежности."]
    if field_errors:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail=field_errors,
            message="Проверьте заполнение карточки объекта.",
        )

    number = OpsSecurityObject.objects.count() + 1
    return OpsSecurityObject.objects.create(
        name=name,
        code=f"OBJ-{number:03d}",
        object_type=object_type,
        region=region,
        address=address,
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.RED,
        ownership=ownership,
    )


@transaction.atomic
def update_passport(security_object, sectors):
    """Заменить действующую редакцию (черновик) целиком.

    Форма присылает паспорт целиком (как мок-контракт): построчного merge нет
    намеренно — две правки подряд дают состояние последней, а не смесь.
    Опубликованные версии не затрагиваются вовсе.
    """
    _validate_sectors_payload(sectors)
    security_object.sectors.all().delete()
    for i, sector in enumerate(sectors, start=1):
        row = OpsObjectSector.objects.create(
            security_object=security_object,
            name=str(sector.get("name", "")).strip(),
            position=i,
        )
        for j, post in enumerate(sector.get("posts", []), start=1):
            OpsSecurityPost.objects.create(
                sector=row,
                name=str(post.get("name", "")).strip(),
                task=str(post.get("task", "") or ""),
                requirements=str(post.get("requirements", "") or ""),
                position=j,
            )
    security_object.save(update_fields=["updated_at"])
    return security_object


def snapshot_sectors(security_object):
    """Секторы черновика в форме контракта клиента (camelCase)."""
    return [
        {
            "id": str(sector.pk),
            "name": sector.name,
            "posts": [
                {
                    "id": str(post.pk),
                    "name": post.name,
                    "task": post.task,
                    "requirements": post.requirements,
                }
                for post in sector.posts.all()
            ],
        }
        for sector in security_object.sectors.all()
    ]


@transaction.atomic
def publish_version(security_object, *, effective_from, note, actor):
    """Опубликовать версию — неизменяемый снимок черновика.

    Предпроверки повторяют мок-контракт; гонку двух публикаций на одну дату
    ловит уникальность БД (uniq_ops_passport_version_effective_from), и
    проигравший получает тот же VALIDATION_ERROR через CONSTRAINT_ERROR_MAP.
    Журнал пишется в той же транзакции: откат публикации не оставляет строки
    о событии, которого не было.
    """
    field_errors = {}
    raw = str(effective_from or "").strip()
    try:
        effective = dt.date.fromisoformat(raw)
    except ValueError:
        effective = None
        field_errors["effectiveFrom"] = ["Укажите дату вступления в силу."]
    if effective is not None and security_object.passport_versions.filter(
        effective_from=effective
    ).exists():
        field_errors["effectiveFrom"] = [
            "На эту дату версия паспорта уже опубликована."
        ]
    if not OpsSecurityPost.objects.filter(
        sector__security_object=security_object
    ).exists():
        field_errors["sectors"] = [
            "В паспорте нет ни одного поста — публиковать нечего."
        ]
    if field_errors:
        raise _validation(field_errors)

    last_number = (
        security_object.passport_versions.order_by("-version_number")
        .values_list("version_number", flat=True)
        .first()
        or 0
    )
    version = OpsPassportVersion.objects.create(
        security_object=security_object,
        version_number=last_number + 1,
        effective_from=effective,
        published_at=Clock.now(),
        published_by=actor,
        note=str(note or "").strip(),
        sectors_snapshot=snapshot_sectors(security_object),
    )
    security_object.save(update_fields=["updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.PASSPORT_VERSION_PUBLISHED,
        entity_type=audit_service.ENTITY_SECURITY_OBJECT,
        entity_id=security_object.pk,
        new_value={
            "versionNumber": version.version_number,
            "effectiveFrom": version.effective_from.isoformat(),
            "code": security_object.code,
        },
    )
    return security_object
