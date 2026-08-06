"""Admin раздела: что в нём есть и, главное, чего в нём НЕТ.

Правка справочника через Admin — обещание среза 37 («перенести дедлайн
должен уметь администратор, а не выкатка»), и до этого среза оно не
исполнялось: строку правили только из shell.

Вторая половина — архитектурный гвард: бизнес-модели раздела в Admin не
регистрируются. Admin мутирует записи БЕЗ сервисов, то есть в обход версий
сдачи, проверки пересечений статусов, причины обхода и записи в журнал.
Регистрация такой модели — не «удобство для админа», а второй вход в домен.
"""
import pytest
from django.contrib import admin
from django.contrib.auth.models import User

# Поимённо импортируются только те модели, о которых у файла есть СВОЁ
# утверждение (справочники в Admin и синглтон настроек). Запрещённые
# перечисляет само приложение — см. FORBIDDEN_MODELS ниже.
from organization_management.apps.operations.models import Role, StatusType
from organization_management.apps.operations.models_submission import (
    OpsDivisionNotifyRecipient,
    OpsSubmissionControlSettings,
)

pytestmark = pytest.mark.django_db


def site_admin(model):
    return admin.site._registry.get(model)


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


# Что раздел ОСОЗНАННО отдаёт в Admin. Всё остальное — под запретом, и список
# устроен именно так, а не наоборот: перечисляли бы мы запрещённое, новая модель
# оказывалась бы разрешённой по умолчанию — то есть забыть было бы достаточно.
#
# Проверено на себе: до этого среза список был перечнем ЗАПРЕЩЁННЫХ, и три
# модели, приехавшие с выпуском документа (вложение, счётчик номеров, выпуск),
# в него никто не добавил. Зарегистрируй их кто-нибудь — гвард промолчал бы.
ADMIN_ALLOWED = {
    # Настройки контроля сдачи: перенести дедлайн должен уметь администратор,
    # а не выкатка.
    "OpsSubmissionControlSettings",
    # Закрепление ответственного за уведомления: настройка, а не решение с
    # последствиями — ни версии, ни записи в журнал она не порождает.
    "OpsDivisionNotifyRecipient",
}


def _section_models():
    from django.apps import apps

    return sorted(
        apps.get_app_config("operations").get_models(), key=lambda m: m.__name__
    )


FORBIDDEN_MODELS = [
    model for model in _section_models() if model.__name__ not in ADMIN_ALLOWED
]


def test_the_section_has_models_to_check():
    """Опора: пустой список моделей сделал бы проверку ниже вечнозелёной."""
    assert len(FORBIDDEN_MODELS) >= 10


def test_the_allowlist_names_only_models_that_exist():
    """Опечатка в списке разрешённых молча РАСШИРИЛА бы запрет на настоящую
    модель — она осталась бы под проверкой, а разрешение не сработало бы. Ещё
    хуже обратное: переименовали модель, а имя в списке осталось, и новая
    оказалась запрещена без объяснений."""
    known = {model.__name__ for model in _section_models()}

    assert ADMIN_ALLOWED <= known


@pytest.mark.parametrize(
    "model", FORBIDDEN_MODELS, ids=[m.__name__ for m in FORBIDDEN_MODELS]
)
def test_business_records_are_not_registered(model):
    """Каждая из них пишется СЕРВИСОМ по своим правилам.

    Сдача — новой версией, статус — с проверкой пересечений, обход — с
    причиной и записью в журнал, журнал — вообще только добавлением. Форма
    Admin не знает ни одного из этих правил и применила бы UPDATE.

    Водяной знак не бизнес-запись, а учёт фоновой работы — и в Admin ему тем
    более нечего делать: правка даты руками означает «пройти эти дни заново»
    или «считать их пройденными», то есть повторную материализацию эффектов
    либо молча потерянные дни. Такое делают командой с её проверками, а не
    формой.

    Список моделей берётся у ПРИЛОЖЕНИЯ, а не пишется руками: новая модель
    попадает под запрет сама, и забыть её нельзя. Разрешения перечислены
    отдельно и явно — их мало, и каждое объяснено.
    """
    assert site_admin(model) is None, f"{model.__name__} мутируем мимо сервиса"


def test_the_singleton_cannot_be_added_or_deleted(rf):
    """Синглтон держит БД; гейты Admin говорят «нельзя» заранее.

    Без них администратор получил бы 500 вместо отказа — а на удалении и
    вовсе тихий сброс настроек к дефолту (селектор самолечится), выглядящий
    как удаление.
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


def test_reference_data_of_the_section_stays_available():
    # Справочники раздела вне сдачи (роли, типы статусов) регистрирует не
    # этот модуль; тест лишь фиксирует, что их отсутствие здесь осознанно.
    assert site_admin(Role) is None
    assert site_admin(StatusType) is None
