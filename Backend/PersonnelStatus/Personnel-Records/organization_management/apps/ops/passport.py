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

from django.db import connection, transaction

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
    normalized = []
    for i, sector in enumerate(sectors):
        if not isinstance(sector, dict):
            field_errors[f"sectors.{i}"] = ["Ожидается объект сектора."]
            continue
        name = sector.get("name", "")
        if not isinstance(name, str):
            field_errors[f"sectors.{i}.name"] = ["Ожидается строка."]
            name = ""
        else:
            name = name.strip()
            if name == "":
                field_errors[f"sectors.{i}.name"] = ["Укажите название сектора."]
            elif len(name) > 255:
                field_errors[f"sectors.{i}.name"] = ["Не длиннее 255 символов."]
        posts = sector.get("posts", [])
        if not isinstance(posts, list):
            field_errors[f"sectors.{i}.posts"] = ["Ожидается список постов."]
            continue
        normalized_posts = []
        for j, post in enumerate(posts):
            if not isinstance(post, dict):
                field_errors[f"sectors.{i}.posts.{j}"] = ["Ожидается объект поста."]
                continue
            post_name = post.get("name", "")
            if not isinstance(post_name, str):
                field_errors[f"sectors.{i}.posts.{j}.name"] = ["Ожидается строка."]
                post_name = ""
            else:
                post_name = post_name.strip()
                if post_name == "":
                    field_errors[f"sectors.{i}.posts.{j}.name"] = [
                        "Укажите название поста."
                    ]
                elif len(post_name) > 255:
                    field_errors[f"sectors.{i}.posts.{j}.name"] = ["Не длиннее 255 символов."]
            task = post.get("task")
            requirements = post.get("requirements")
            task = "" if task is None else task
            requirements = "" if requirements is None else requirements
            for field, value in (("task", task), ("requirements", requirements)):
                if not isinstance(value, str):
                    field_errors[f"sectors.{i}.posts.{j}.{field}"] = ["Ожидается строка."]
                elif len(value) > 1000:
                    field_errors[f"sectors.{i}.posts.{j}.{field}"] = ["Не длиннее 1000 символов."]
            normalized_posts.append({
                "id": post.get("id"), "name": post_name,
                "task": task, "requirements": requirements,
            })
        normalized.append({"id": sector.get("id"), "name": name, "posts": normalized_posts})
    if field_errors:
        raise _validation(field_errors)
    return normalized


def _passport_row_id(raw, *, path, owned, seen, errors):
    """Positive keys identify existing rows; legacy/local labels identify new rows."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, (str, int)):
        errors[path] = ["Укажите корректный идентификатор."]
        return None
    text = str(raw).strip()
    if not text:
        return None
    if text.isascii() and text.isdigit():
        if len(text) > 19 or not 0 < int(text) <= 9223372036854775807:
            errors[path] = ["Укажите корректный идентификатор."]
            return None
        key = int(text)
        identity = ("existing", key)
        if key not in owned:
            errors[path] = ["Строка не принадлежит этому объекту или больше не существует."]
    elif isinstance(raw, int) or text.lstrip("+-").isdigit():
        errors[path] = ["Укажите корректный идентификатор."]
        return None
    else:
        key = None
        identity = ("temporary", text)
    if identity in seen:
        errors[path] = ["Идентификатор повторяется в паспорте."]
    seen.add(identity)
    return key


def _validate_passport_ids(sectors, existing_sectors, existing_posts):
    errors, sector_ids, post_ids = {}, set(), set()
    for i, sector in enumerate(sectors):
        sector["id"] = _passport_row_id(sector["id"], path=f"sectors.{i}.id",
            owned=existing_sectors, seen=sector_ids, errors=errors)
        for j, post in enumerate(sector["posts"]):
            post["id"] = _passport_row_id(post["id"], path=f"sectors.{i}.posts.{j}.id",
                owned=existing_posts, seen=post_ids, errors=errors)
    if errors:
        raise _validation(errors)


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
    # A transaction lock also serializes the first creation in an empty catalog.
    # Existing public codes and import identifiers are never renumbered.
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ["ops_security_objects.code"])
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

    codes = set(OpsSecurityObject.objects.values_list("code", flat=True))
    number = max((int(code[4:]) for code in codes
                  if code.startswith("OBJ-") and code[4:].isascii() and code[4:].isdigit()), default=0) + 1
    code = f"OBJ-{number:03d}"
    if len(code) > OpsSecurityObject._meta.get_field("code").max_length:
        # A maximal imported numeric label must not make the catalog unwritable.
        number = 1
        while f"OBJ-{number:03d}" in codes:
            number += 1
        code = f"OBJ-{number:03d}"
    return OpsSecurityObject.objects.create(
        name=name,
        code=code,
        object_type=object_type,
        region=region,
        address=address,
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.RED,
        ownership=ownership,
    )


#: Тот же лимит и тот же список типов, что у снимка ОЛ (`apps/ops/gvo.py`,
#: `PERSON_PHOTO_MAX_BYTES`/`PERSON_PHOTO_TYPES`) — предмет разный, требование
#: к файлу одно и то же, повторять число под другим именем незачем.
OBJECT_PHOTO_MAX_BYTES = 5 * 1024 * 1024
OBJECT_PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")
OBJECT_PHOTO_FORMATS = {"jpeg": "jpg", "png": "png", "webp": "webp"}


def set_object_photo(object_id, upload, *, actor=None):
    """Положить снимок объекту-каталогу (Plane SJ-1049). None — объекта нет.

    Проверка ПО БАЙТАМ, а не по заявленному `Content-Type` — тот же довод и
    тот же приём, что у `gvo.set_person_photo` (ревью №825 по №951,
    08.09.2026): заголовок части multipart пишет клиент, и без разбора байт
    Pillow'ом HTML с подложным `Content-Type: image/png` лёг бы под своим
    расширением и раздавался бы с домена портала — хранимый XSS любому, у
    кого есть право на паспорт. Имя хранимого файла собирается здесь же —
    от клиента не остаётся ни имени, ни расширения.
    """
    try:
        object_id = int(object_id)
    except (TypeError, ValueError):
        return None
    if not 1 <= object_id <= 2**63 - 1:
        return None

    security_object = OpsSecurityObject.objects.filter(pk=object_id).first()
    if security_object is None:
        return None
    if upload is None:
        raise _validation({"photo": ["Приложите файл изображения."]})
    content_type = getattr(upload, "content_type", "") or ""
    if content_type not in OBJECT_PHOTO_TYPES:
        raise _validation({"photo": ["Допустимы JPEG, PNG или WebP."]})
    if upload.size > OBJECT_PHOTO_MAX_BYTES:
        raise _validation({"photo": ["Файл больше 5 МБ."]})

    from uuid import uuid4

    from PIL import Image, UnidentifiedImageError

    try:
        upload.seek(0)
        with Image.open(upload) as image:
            image.verify()
            image_format = (image.format or "").lower()
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError):
        raise _validation(
            {"photo": ["Файл не является изображением JPEG, PNG или WebP."]}
        )
    if image_format not in OBJECT_PHOTO_FORMATS:
        raise _validation({"photo": ["Допустимы JPEG, PNG или WebP."]})
    upload.seek(0)
    stored_name = f"{security_object.pk}-{uuid4().hex}.{OBJECT_PHOTO_FORMATS[image_format]}"
    storage = security_object.photo.storage
    old_name = security_object.photo.name or ""
    generated_name = security_object.photo.field.generate_filename(
        security_object, stored_name
    )
    new_name = storage.save(generated_name, upload)
    try:
        with transaction.atomic():
            security_object.photo.name = new_name
            security_object.save(update_fields=["photo", "updated_at"])
            audit_service.record(
                actor=actor,
                action=audit_service.SECURITY_OBJECT_PHOTO_SET,
                entity_type=audit_service.ENTITY_SECURITY_OBJECT,
                entity_id=security_object.pk,
                new_value={"code": security_object.code, "photo": new_name},
            )
    except Exception:
        # Файловое хранилище не участвует в транзакции БД: при любом отказе
        # модели или обязательного audit новый blob убирается вручную, а
        # прежний ещё не тронут.
        storage.delete(new_name)
        security_object.photo.name = old_name
        raise
    if old_name and old_name != new_name:
        # Старый blob удаляется только после успешного commit: до этого он —
        # единственная согласованная с БД версия снимка.
        transaction.on_commit(lambda: storage.delete(old_name))
    return security_object


@transaction.atomic
def update_passport(security_object, sectors):
    """Заменить действующую редакцию (черновик) целиком.

    Форма присылает паспорт целиком: отсутствующие строки удаляются, а
    оставшиеся сохраняют идентификаторы, на которые ссылаются наряды.
    Опубликованные версии не затрагиваются.
    """
    sectors = _validate_sectors_payload(sectors)
    OpsSecurityObject.objects.select_for_update().get(pk=security_object.pk)
    existing_sectors = {row.pk: row for row in OpsObjectSector.objects.filter(security_object=security_object)}
    existing_posts = {row.pk: row for row in OpsSecurityPost.objects.filter(sector__security_object=security_object)}
    _validate_passport_ids(sectors, existing_sectors, existing_posts)
    kept_sectors, kept_posts = set(), set()
    for i, sector in enumerate(sectors, start=1):
        row = existing_sectors.get(sector["id"])
        if row is None:
            row = OpsObjectSector.objects.create(security_object=security_object, name=sector["name"], position=i)
        else:
            row.name, row.position = sector["name"], i
            row.save(update_fields=["name", "position", "updated_at"])
        kept_sectors.add(row.pk)
        for j, post in enumerate(sector["posts"], start=1):
            saved = existing_posts.get(post["id"])
            values = {"sector": row, "name": post["name"], "task": post["task"],
                      "requirements": post["requirements"], "position": j}
            if saved is None:
                saved = OpsSecurityPost.objects.create(**values)
            else:
                for field, value in values.items():
                    setattr(saved, field, value)
                saved.save(update_fields=[*values, "updated_at"])
            kept_posts.add(saved.pk)
    OpsSecurityPost.objects.filter(sector__security_object=security_object).exclude(pk__in=kept_posts).delete()
    OpsObjectSector.objects.filter(security_object=security_object).exclude(pk__in=kept_sectors).delete()
    # Drop a caller's prefetched tree before deriving the passport state.
    security_object.refresh_from_db()
    security_object.save(update_fields=["updated_at"])
    # Правка черновика меняет состояние: разошёлся с версией — «требует
    # доработки» (Plane №66).
    refresh_passport_state(security_object)
    return security_object


def resolve_passport_state(security_object):
    """Состояние паспорта объекта: RED / YELLOW / GREEN (Plane №66).

    До 26.08.2026 состояния НЕ БЫЛО КОМУ ставить: `create_object` жёстко писал
    RED, публикация версии поля не трогала, и зелёным объект не становился
    никогда — колонка реестра, сводка KPI и баннер карточки показывали
    состояние, которого система не производит. Фикстура стенда дописывала
    GREEN прямо в поле, чтобы пробе было на что смотреть.

    Правило собрано из подписей самих состояний и того, что уже есть в
    домене:

    * **RED** «Не оформлен» — в паспорте нет ни одного поста: вести по такому
      объекту нечего;
    * **YELLOW** «Требует доработки» — посты есть, но опубликованной версии
      нет ЛИБО черновик разошёлся с последней версией (посты правят, а
      публиковать забыли);
    * **GREEN** «Оформлен» — есть опубликованная версия, и черновик ей
      соответствует.

    СВЕЖЕСТЬ СЮДА НЕ ВХОДИТ, и это осознанно. Свежесть зависит от текущей
    даты: вчерашний GREEN сам собой становится «просроченным», а хранимое
    поле об этом не узнает, пока объект кто-нибудь не сохранит, — состояние
    протухало бы молча. У свежести своя колонка (`resolve_freshness`) и свои
    показатели KPI (`verificationOverdue`, `neverPublished`), и они считаются
    на каждый показ. Здесь — свойство ДОКУМЕНТА, которое меняется только
    вместе с ним.
    """
    has_posts = OpsSecurityPost.objects.filter(
        sector__security_object=security_object
    ).exists()
    if not has_posts:
        return OpsSecurityObject.PassportState.RED
    latest = (
        security_object.passport_versions.order_by("-version_number")
        .values_list("sectors_snapshot", flat=True)
        .first()
    )
    if latest is None:
        return OpsSecurityObject.PassportState.YELLOW

    # Черновик против последней версии: сравниваются ИМЕНА секторов и постов,
    # а не идентификаторы — правка паспорта пересоздаёт строки, и сравнение по
    # id объявляло бы расхождением каждое сохранение.
    def shape(sectors):
        return [
            (
                str(sector.get("name", "")).strip(),
                [str(post.get("name", "")).strip() for post in sector.get("posts", [])],
            )
            for sector in sectors or []
        ]

    if shape(snapshot_sectors(security_object)) != shape(latest):
        return OpsSecurityObject.PassportState.YELLOW
    return OpsSecurityObject.PassportState.GREEN


def refresh_passport_state(security_object):
    """Пересчитать и СОХРАНИТЬ состояние, если оно изменилось.

    Состояние хранится полем, а не считается на лету, потому что по нему
    отбирают и считают KPI реестра: вычисление на каждую строку превратило бы
    список объектов в перебор версий и постов. Цена хранения — обязанность
    пересчитывать его там, где паспорт меняется; таких мест два, и оба ниже
    по файлу: правка черновика и публикация версии.
    """
    state = resolve_passport_state(security_object)
    if security_object.passport_state != state:
        security_object.passport_state = state
        security_object.save(update_fields=["passport_state", "updated_at"])
    return state


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
    # Публикация — единственный путь объекта в «зелёное» (Plane №66).
    refresh_passport_state(security_object)
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
