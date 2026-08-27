"""Admin раздела: что в нём есть — и почему теперь есть ВСЁ.

РАЗВОРОТ РЕШЕНИЯ 27.08.2026 (Plane №182). До этой даты файл стерёг обратное:
бизнес-записи раздела в Admin не регистрируются, потому что форма Admin
мутирует их без сервисов — сдачу без новой версии, статус без проверки
пересечений, обход без причины и без журнала. Заказчик снял запрет прямо:
«полностью разрешаю, всё должно в админке отражаться, я должен руками это
всё тестировать». Цена решения (находка аудита ARCH1, HIGH — второй путь
мутации мимо сервисов и аудита) принята сознательно и записана в
`Personnel-Records/Decisions.md` и `Known-Issues.md`.

Из этого следует, что стеречь надо ровно противоположное. Прежний гвард
защищал от РЕГИСТРАЦИИ; новый — от ПРОПУСКА: модель, не попавшая в Admin,
невидима для ручной проверки, и заметить это нечем, кроме такого теста.
Именно так и терялись модели раньше — три модели выпуска документа приехали
после гварда, и в его список их никто не внёс.

Поэтому список моделей здесь по-прежнему берётся у ПРИЛОЖЕНИЯ, а не пишется
руками: новая модель попадает под проверку сама.
"""
import pytest
from django.contrib import admin
from django.contrib.auth.models import User

from organization_management.admin_auto import (
    build_list_filter,
    build_search_fields,
)
from organization_management.apps.operations.models import Role, StatusType
from organization_management.apps.operations.models_submission import (
    OpsDivisionNotifyRecipient,
    OpsSubmissionControlSettings,
)

pytestmark = pytest.mark.django_db


def site_admin(model):
    return admin.site._registry.get(model)


def _section_models():
    from django.apps import apps

    return sorted(
        apps.get_app_config("operations").get_models(), key=lambda m: m.__name__
    )


SECTION_MODELS = _section_models()


def test_the_section_has_models_to_check():
    """Опора: пустой список моделей сделал бы проверки ниже вечнозелёными."""
    assert len(SECTION_MODELS) >= 10


@pytest.mark.parametrize(
    "model", SECTION_MODELS, ids=[m.__name__ for m in SECTION_MODELS]
)
def test_every_model_of_the_section_is_visible_in_admin(model):
    """Ни одной невидимой сущности: заказчик проверяет раздел руками.

    Модель, которой нет в Admin, нельзя ни посмотреть, ни завести под
    проверку — и её отсутствие ничем не проявляется, пока кто-нибудь не
    пойдёт её искать. Список берётся у приложения, поэтому новая модель
    обязана показаться сама, а не после того, как о ней вспомнят.
    """
    assert site_admin(model) is not None, (
        f"{model.__name__} не показывается в Admin — ручная проверка её не видит"
    )


@pytest.mark.parametrize(
    "model", SECTION_MODELS, ids=[m.__name__ for m in SECTION_MODELS]
)
def test_the_search_of_the_list_stays_textual(model):
    """Поиск OR-ит LIKE по КАЖДОЙ колонке из `search_fields`.

    Нетекстовая колонка добавляет к этому свой cast и свои совпадения: строка
    «2» нашла бы всё, где двойка встречается в id, в проценте готовности и в
    счётчике конфликтов, — то есть поиск перестал бы отвечать на вопрос,
    который человек задал, и стоил бы лишний полный проход.

    Ошибки при этом НЕ будет: проверено на этом стеке (Django 5.1.15,
    Postgres) — `icontains` по числу и по uuid Django кастует сам,
    `UPPER("id"::text) LIKE …`. Написано прямо, потому что рядом в
    `operations/admin.py` живёт комментарий про ProgrammingError на
    `division_id`, и следующий человек унаследует из него неверную причину.
    """
    model_admin = site_admin(model)
    fields = {field.name: field for field in model._meta.get_fields()}

    for name in getattr(model_admin, "search_fields", ()):
        field = fields.get(name.lstrip("^=@"))
        if field is None:
            continue
        assert field.get_internal_type() in {
            "CharField",
            "TextField",
            "SlugField",
            "EmailField",
            "URLField",
        }, f"{model.__name__}.{name}: поиск по нетекстовой колонке уронит список"


def test_the_builder_keeps_uuid_and_numbers_out_of_the_search():
    """Красная проба сборщика: правило живёт в нём, а не только в результате.

    Проверка выше смотрит на то, что получилось; эта — на само правило, и
    падает, если из `TEXT_FIELDS` кто-нибудь добавит туда UUID или число.
    """
    from organization_management.apps.operations.models_event import (
        OpsSecurityEvent,
    )

    searchable = build_search_fields(OpsSecurityEvent)

    assert "code" in searchable
    assert "business_date" not in searchable


def test_the_filters_do_not_enumerate_free_text_columns():
    """Фильтр по свободному CharField перечисляет ВСЕ значения колонки.

    На таблице мероприятий это отдельный тяжёлый запрос ради списка, которым
    невозможно пользоваться. В фильтры идут только `choices`, булевы и даты.
    """
    from organization_management.apps.operations.models_event import (
        OpsSecurityEvent,
    )

    filters = build_list_filter(OpsSecurityEvent)

    assert "stage" in filters, "поле с choices обязано быть фильтром"
    assert "title" not in filters, "свободный текст фильтром быть не может"


def test_the_control_settings_are_editable_in_admin():
    assert site_admin(OpsSubmissionControlSettings) is not None


def test_the_notify_recipients_are_editable_in_admin():
    """Закрепление ответственного — настройка, а не решение с последствиями.

    Сервиса у неё нет и быть не должно: смена дежурства не порождает ни
    версии, ни записи в журнал — заводить её мимо Admin означало бы выкатку
    на каждую перестановку.
    """
    model_admin = site_admin(OpsDivisionNotifyRecipient)

    assert model_admin is not None
    # Поиск по целочисленной колонке отвечал бы ProgrammingError (LIKE по
    # числу), поэтому ищем только по получателю.
    assert model_admin.search_fields == ("recipient",)


def test_the_singleton_cannot_be_added_or_deleted(rf):
    """Синглтон держит БД; гейты Admin говорят «нельзя» заранее.

    Разворот решения их НЕ отменяет: это не запрет на видимость, а защита от
    500-й и от тихого сброса настроек, выглядящего как удаление. Строку
    видно и правится она из Admin — нельзя только завести вторую и удалить
    единственную.
    """
    model_admin = site_admin(OpsSubmissionControlSettings)
    request = rf.get("/admin/")
    request.user = User.objects.create_superuser("admin-reg", password="x")

    assert OpsSubmissionControlSettings.objects.exists()
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_delete_permission(request) is False


def test_the_first_row_could_be_added_if_it_were_missing(rf):
    # Гейт добавления условный, а не глухой: пустая таблица (перенос данных,
    # ручная чистка) обязана остаться заполнимой из Admin.
    model_admin = site_admin(OpsSubmissionControlSettings)
    request = rf.get("/admin/")
    request.user = User.objects.create_superuser("admin-reg2", password="x")
    OpsSubmissionControlSettings.objects.all().delete()

    assert model_admin.has_add_permission(request) is True


def test_reference_data_of_the_section_became_visible_too():
    """Роли и типы статусов раздела — та же ручная проверка.

    Раньше их отсутствие в Admin фиксировалось как осознанное; теперь
    осознанно обратное.
    """
    assert site_admin(Role) is not None
    assert site_admin(StatusType) is not None
