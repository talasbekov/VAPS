"""Авторегистрация моделей в Django Admin.

РЕШЕНИЕ ЗАКАЗЧИКА 27.08.2026 (Plane №182): «полностью разрешаю, всё должно в
админке отражаться, я должен руками это всё тестировать». До него раздел ОМ
отдавал в Admin ровно два справочника, а 63 модели — мероприятия, объекты,
посты, паспорта, охраняемые лица, аналитику, рейтинг — не показывал вовсе,
и проверить их руками было нечем.

ЧТО ЭТО ЗНАЧИТ И ЧЕМ ОПЛАЧЕНО. Форма Admin пишет модель НАПРЯМУЮ, минуя
сервисы: сдача дня без новой версии, статус без проверки пересечений, обход
блокировки без причины, рейтинг без идемпотентности, журнал — правкой вместо
добавления. Это ровно находка ARCH1 (HIGH) аудита 23.08.2026, и теперь она
принята сознательно как цена ручной проверки. Прямое следствие: правка через
Admin НЕ равна работе раздела — она не проверяет инварианты и не пишет в
аудит. Проверять поведение системы надо через экраны и API; Admin здесь —
смотровое окно в базу и способ подготовить данные, а не второй интерфейс
раздела.

ПОЧЕМУ АВТОМАТОМ, А НЕ 73 КЛАССА РУКАМИ. Руками написанный перечень
устаревает молча: новая модель просто не появляется в Admin, и никто этого
не замечает — так и получилось с моделями выпуска документа, приехавшими
после гварда. Здесь список берётся у ПРИЛОЖЕНИЯ, поэтому новая модель
показывается сама. Тонкая настройка остаётся возможной: свой `ModelAdmin`,
зарегистрированный в `admin.py` приложения, авторегистратор не трогает —
он добавляет только то, чего в реестре ещё нет.

РЕШЕНИЯ ПО ПОЛЯМ приняты так, чтобы страница списка не отвечала ошибкой и не
клала базу:

- в `search_fields` идут ТОЛЬКО текстовые колонки — по цене и по смыслу, а
  НЕ потому, что иначе будет ошибка. Проверено на этом стеке (Django 5.1.15,
  Postgres): `icontains` по числу и по uuid не падает — Django сам кастует,
  `UPPER("id"::text) LIKE …`. Старое обоснование «LIKE по числу отвечает
  ProgrammingError» (см. комментарий в `operations/admin.py` про
  `division_id`) на текущей версии НЕ воспроизводится, и повторять его тут
  значило бы передать дальше неправду. Настоящая причина в другом: поиск
  OR-ит LIKE по КАЖДОЙ колонке из списка, и каждая нетекстовая добавляет свой
  cast — на таблице мероприятий это лишний полный проход ради совпадений,
  которых человек не искал (строка `2` нашла бы всё, где двойка встречается
  в id, в процентах готовности и в счётчике конфликтов);
- в `list_filter` идут только булевы, поля с `choices` и даты. Фильтр по
  свободному CharField перечисляет ВСЕ различные значения колонки — на
  таблице событий это отдельный тяжёлый запрос ради бесполезного списка;
- FK показываются как `raw_id_fields`: выпадающий список тянет всю
  целевую таблицу в каждую форму, а ссылок на объекты и сотрудников тут
  много;
- `JSONField` и `TextField` в колонки списка не идут: JSONB этапов ОМ — это
  килобайты на строку, и список превратился бы в простыню. В форме правки
  они на месте;
- `list_select_related = True`: без него FK в колонках дают запрос на строку.
"""
from django.contrib import admin
from django.db import models

# Сколько колонок показывать в списке. Больше десятка не помещается по ширине
# и превращает таблицу в горизонтальную прокрутку.
MAX_LIST_DISPLAY = 8
MAX_SEARCH_FIELDS = 6
MAX_LIST_FILTERS = 6

# Текстовые типы, по которым LIKE работает. UUIDField сюда НЕ входит
# сознательно: в Postgres это тип uuid, и icontains по нему — ProgrammingError.
TEXT_FIELDS = (
    models.CharField,
    models.TextField,
    models.SlugField,
    models.EmailField,
    models.URLField,
)

# Типы, которым не место в колонках списка: содержимое либо огромное, либо
# нечитаемое одной строкой.
BULKY_FIELDS = (models.JSONField, models.TextField, models.BinaryField)

DATE_FIELDS = (models.DateField, models.DateTimeField)

# Служебные отметки времени: в конце списка они полезны, в начале — занимают
# место, которое нужно под смысловые колонки.
TIMESTAMP_NAMES = ("created_at", "updated_at", "created", "modified")


def _concrete_fields(model):
    """Только собственные колонки: без обратных связей и без M2M.

    M2M в `list_display` Admin запрещает прямо (`admin.E109`), а обратные
    связи там дали бы запрос на строку.
    """
    return [
        field
        for field in model._meta.get_fields()
        if getattr(field, "concrete", False) and not field.many_to_many
    ]


def build_list_display(model):
    named = []
    timestamps = []
    for field in _concrete_fields(model):
        if isinstance(field, BULKY_FIELDS):
            continue
        if field.name in TIMESTAMP_NAMES:
            timestamps.append(field.name)
            continue
        named.append(field.name)
    # Отметки времени — хвостом: «когда завели» почти всегда нужнее, чем
    # десятая смысловая колонка, но не важнее первых.
    display = (named + timestamps)[:MAX_LIST_DISPLAY]
    # Пустым list_display быть не может — у модели из одних JSONB-полей
    # остался бы только pk.
    return tuple(display) or ("pk",)


def build_search_fields(model):
    names = [
        field.name
        for field in _concrete_fields(model)
        if isinstance(field, TEXT_FIELDS) and not field.choices
    ]
    return tuple(names[:MAX_SEARCH_FIELDS])


def build_list_filter(model):
    names = []
    for field in _concrete_fields(model):
        if field.choices:
            names.append(field.name)
        elif isinstance(field, models.BooleanField):
            names.append(field.name)
        elif isinstance(field, DATE_FIELDS) and field.name not in TIMESTAMP_NAMES:
            names.append(field.name)
    return tuple(names[:MAX_LIST_FILTERS])


def build_raw_id_fields(model):
    return tuple(
        field.name
        for field in _concrete_fields(model)
        if field.many_to_one or field.one_to_one
    )


def build_model_admin(model):
    """Собрать класс `ModelAdmin` под конкретную модель."""
    attrs = {
        "list_display": build_list_display(model),
        "list_select_related": True,
        "save_on_top": True,
    }
    search_fields = build_search_fields(model)
    if search_fields:
        attrs["search_fields"] = search_fields
    list_filter = build_list_filter(model)
    if list_filter:
        attrs["list_filter"] = list_filter
    raw_id_fields = build_raw_id_fields(model)
    if raw_id_fields:
        attrs["raw_id_fields"] = raw_id_fields
    # Своё упорядочивание модели не переопределяем: если автор его задал, он
    # знал зачем. Иначе — свежие сверху, это то, что ищут при ручной проверке.
    if not model._meta.ordering:
        attrs["ordering"] = ("-pk",)
    return type(f"{model.__name__}AutoAdmin", (admin.ModelAdmin,), attrs)


def register_remaining(app_label, skip=()):
    """Зарегистрировать все ещё не зарегистрированные модели приложения.

    Возвращает имена зарегистрированных моделей — чтобы гвард мог утверждать
    не «что-то произошло», а что именно.

    `skip` — имена моделей, которые приложение сознательно оставляет вне
    Admin. Пустой по умолчанию: решение заказчика — показывать всё.
    """
    from django.apps import apps as django_apps

    registered = []
    for model in django_apps.get_app_config(app_label).get_models():
        if model in admin.site._registry:
            # Уже есть свой, настроенный руками — он главнее.
            continue
        if model.__name__ in skip:
            continue
        admin.site.register(model, build_model_admin(model))
        registered.append(model.__name__)
    return registered
