"""Admin раздела ОМ — ТОЛЬКО справочники (порт submissions/admin.py из
Backend/VAPS).

Что здесь появляется, решает не удобство, а природа записи. Справочник —
данные, которые администратор заводит и правит руками: контрольный час,
список «необходимых управлений». Бизнес-запись — то, что раздел ПИШЕТ САМ по
своим правилам: сдача дня, строка статуса, пара прикомандирования, обход
блокировки, строка журнала. Открыв их в Admin, раздел получил бы второй,
безусловный вход в мутации: правку сдачи без новой версии, статус без
проверки пересечений, обход без причины и без записи в журнал — то есть
ровно те инварианты, ради которых у каждого из них есть сервис.

Обход блокировки (ops_tomorrow_block_overrides) поэтому здесь и не появится,
хотя выглядит «настройкой»: это принятое решение с ответственным, а не
конфигурация, и заводить его мимо сервиса значило бы подписывать чужим
именем без причины.

Справочник контроля сдачи — СИНГЛТОН: добавление закрыто при существующей
строке, удаление закрыто всегда. База и так держит единственность
(unique + CHECK singleton_key=1), но она отвечает 500-й, а гейты Admin — тем
же «нельзя», только заранее и по-человечески.

Закрепление получателей уведомлений, наоборот, открыто целиком: это чистая
настройка «кто отвечает за сдачу этого управления» — её заводят, переносят и
снимают по мере смены дежурства, и сервиса у неё нет. Правит её админ, а не
выкатка, ровно по той же причине, по которой сюда попал контрольный час.
"""
from django.contrib import admin

from organization_management.apps.operations.models_submission import (
    OpsDivisionNotifyRecipient,
    OpsSubmissionControlSettings,
)


@admin.register(OpsSubmissionControlSettings)
class OpsSubmissionControlSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "control_hour",
        "required_division_ids",
        "default_notify_recipient",
    )

    def has_add_permission(self, request):
        # Строку сеет миграция; вторая невозможна на уровне БД.
        if self.model.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        # Удалять нечего и незачем: без строки читатели остались бы без
        # контрольного часа, а самолечение селектора вернуло бы дефолт —
        # то есть удаление означало бы «сбросить настройки», притворяясь
        # удалением.
        return False


@admin.register(OpsDivisionNotifyRecipient)
class OpsDivisionNotifyRecipientAdmin(admin.ModelAdmin):
    list_display = ("division_id", "recipient")
    # Поиск ТОЛЬКО по получателю — по смыслу, а НЕ потому, что иначе будет
    # ошибка. Прежняя редакция этого комментария утверждала, что icontains по
    # целочисленной колонке отвечает ProgrammingError («LIKE по числу Postgres
    # не умеет»); проверено запросом 27.08.2026 (Plane №185) — на текущем
    # стеке это неправда, Django 5.1.15 кастует сам:
    #     UPPER("ops_division_notify_recipients"."division_id"::text)
    #         LIKE UPPER(%1%)
    # запрос выполняется и ошибки не даёт. Настоящая причина в другом: поиск
    # OR-ит LIKE по каждой колонке списка, и «1» по division_id совпало бы с
    # 1, 10, 21, 101 разом — то есть отвечал бы не на тот вопрос, который
    # задали. Нужно выбрать подразделение — это фильтр в адресе списка.
    search_fields = ("recipient",)

# Показать в Admin всё остальное — решение заказчика 27.08.2026 (Plane №182):
# ручная проверка требует видеть каждую сущность. Настроенные выше admin-классы
# авторегистратор не трогает; см. organization_management/admin_auto.py — там же
# записано, чем это оплачено (правка мимо сервисов и мимо аудита).
from organization_management.admin_auto import register_remaining  # noqa: E402

register_remaining("operations")
