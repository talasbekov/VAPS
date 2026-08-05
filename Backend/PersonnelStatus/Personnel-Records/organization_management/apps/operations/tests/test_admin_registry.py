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

from organization_management.apps.operations.models import (
    Role,
    StatusType,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
    OpsSubmissionControlSettings,
    OpsTomorrowBlockOverride,
)
from organization_management.apps.operations.models_watermark import OpsWatermark

pytestmark = pytest.mark.django_db


def site_admin(model):
    return admin.site._registry.get(model)


def test_the_control_settings_are_editable_in_admin():
    assert site_admin(OpsSubmissionControlSettings) is not None


@pytest.mark.parametrize(
    "model",
    [
        OpsDailySubmission,
        OpsEmployeeStatus,
        Secondment,
        OpsAuditLog,
        OpsTomorrowBlockOverride,
        UserRole,
        TemporaryDutyPermission,
        OpsWatermark,
    ],
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
