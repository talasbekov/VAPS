"""Врезка раздела ОМ в увольнение сотрудника старой структуры.

ПОЧЕМУ СИГНАЛ, а не вызов из эндпоинта: старый маршрут увольнения
(`api/employees/`) в config/urls.py ЗАКОММЕНТИРОВАН — экшен `dismiss`
недостижим по HTTP, и врезка в него не исполнилась бы ни разу. Увольнение при
этом реально происходит: через админку, шелл и перенос данных, то есть через
сохранение самой карточки. Сигнал ловит именно его и потому работает из любого
пути, включая будущий эндпоинт.

Своим файлом, а НЕ дописыванием в apps/statuses/signals.py: у старого раздела
там свой приёмник, закрывающий СВОИ статусы, и чужую логику переезд не
трогает. Два приёмника на одно событие независимы — каждый закрывает свои
таблицы.

ДВА ТАКТА (pre_save запоминает, post_save действует): переход виден только до
записи (нужно старое состояние из БД), а закрывать статусы можно лишь ПОСЛЕ
того, как карточка действительно записана.

ЧЕСТНО О ГАРАНТИИ. Если вызывающий обернул сохранение в транзакцию (админка,
любой atomic-блок, тесты) — откат уносит и закрытие. В автокоммите
(ATOMIC_REQUESTS в проекте НЕ включён) карточка уже записана, и упавшее
закрытие оставит факты раздела открытыми. Это осознанный выбор порядка:
обратный оставил бы ЗАКРЫТЫЕ статусы у работающего сотрудника — ложь в
расходе, — тогда как незакрытые факты уволенного расход не искажают (слот
уволенного и так считается вакансией). Закрытие идемпотентно, поэтому
повторяется командой без последствий.
"""
from django.db.models.deletion import ProtectedError
from django.db.models.signals import post_save, pre_delete, pre_save
from django.dispatch import receiver

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.dismissal import (
    close_statuses_on_dismissal,
)
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType

# Актор системного закрытия. Живого пользователя в сигнале нет (request сюда
# не доходит), поэтому метка НЕ ЧИСЛОВАЯ — её нельзя спутать с str(User.pk),
# которым раздел записывает людей.
SYSTEM_ACTOR = "system:dismissal"

# Куда pre_save кладёт дату для post_save. Атрибут экземпляра, а не
# глобальное состояние: параллельные сохранения разных карточек не пересекутся.
_PENDING_ATTR = "_ops_pending_dismissal_date"


@receiver(pre_save, sender=Employee)
def remember_dismissal(sender, instance, **kwargs):
    """Отметить ПЕРЕХОД в увольнение — сравнением со старой строкой.

    Условие зеркалит приёмник старого раздела: переход в «уволен» ИЛИ
    появление даты увольнения там, где её не было. Повторное сохранение уже
    уволенного не переход и ничего не запускает.

    Дата берётся из карточки, а пустая — «сегодня» по часам РАЗДЕЛА (не
    timezone.now(): у раздела свои часы, и подмена в тестах должна работать и
    здесь).
    """
    setattr(instance, _PENDING_ATTR, None)
    previous = (
        Employee.objects.filter(pk=instance.pk)
        .values("employment_status", "dismissal_date")
        .first()
    )
    if previous is None:
        # Строки в БД ещё нет — карточка создаётся (в том числе с заданным
        # заранее pk). Переходить не с чего, и закрывать в разделе нечего.
        # ЕДИНСТВЕННЫЙ владелец этой проверки: отдельный гард на пустой pk
        # был бы вторым про то же и сделал бы пробу этого вакуумной.
        return
    became_fired = (
        instance.employment_status == Employee.EmploymentStatus.FIRED
        and previous["employment_status"] != Employee.EmploymentStatus.FIRED
    )
    date_appeared = bool(instance.dismissal_date) and not previous["dismissal_date"]
    if became_fired or date_appeared:
        setattr(
            instance, _PENDING_ATTR, instance.dismissal_date or Clock.today_local()
        )


@receiver(post_save, sender=Employee)
def close_operations_facts(sender, instance, **kwargs):
    """Закрыть статусы и пары раздела — уже после записи карточки.

    Флаг ставит только pre_save, и только увидев переход у СУЩЕСТВУЮЩЕЙ
    строки; отдельной проверки `created` здесь нет намеренно — второй гард о
    том же сделал бы пробу первого вакуумной.
    """
    dismissal_date = getattr(instance, _PENDING_ATTR, None)
    if dismissal_date is None:
        return
    setattr(instance, _PENDING_ATTR, None)
    close_statuses_on_dismissal(
        instance.pk, dismissal_date=dismissal_date, actor=SYSTEM_ACTOR
    )


# ── Справочник типов: деактивация, а не удаление ─────────────────────────


@receiver(pre_delete, sender=StatusType)
def refuse_to_delete_a_used_status_type(sender, instance, **kwargs):
    """Тип, на который ссылается хоть одна строка статуса, не удаляется.

    Правило было записано в самой модели («Деактивация через is_active, не
    удалением») и не держалось ничем, а справочник заведён в админке — то есть
    удалить строку может обычным действием обычный администратор.

    ЧТО ЛОМАЕТСЯ. Код типа лежит в строках статусов и в СНИМКАХ сданных дней
    строкой, а не ссылкой: внешнего ключа здесь нет, и база удаление не
    остановит. Расход, выведенный из снимка, разрешает каждый код по
    справочнику и на незнакомом падает ValueError — то есть уже подписанный
    день перестаёт печататься ВООБЩЕ. Не «показывает не то», а не открывается,
    и починить это задним числом нечем, кроме как завести тип заново с теми же
    свойствами, которых уже никто не помнит.

    Деактивации это не мешает: `catalog_rows` намеренно отдаёт и неактивные
    типы, чтобы старые дни оставались разрешимыми. Правильный способ убрать
    тип из обихода — is_active=False, и он остаётся доступен.

    Проверяются ВСЕ строки, включая отменённые: снимок мог захватить факт,
    который отменили позже, и для него код обязан остаться разрешимым.
    """
    if OpsEmployeeStatus.objects.filter(status_type_code=instance.pk).exists():
        raise ProtectedError(
            f"тип статуса {instance.pk!r} используется строками статусов: "
            "снимите его с обращения через is_active, а не удалением",
            {instance},
        )


# ── Проекция заявки на сбор сил в таблицы (`[МД-06]`, Plane №425) ────────────
# Ловится СОХРАНЕНИЕ мероприятия с полями JSON: писателей в security_events
# около дюжины, и хук в каждом отстал бы от первого же нового. Проекция
# идемпотентна и append-only; при откате транзакции откатывается вместе с JSON.
from organization_management.apps.operations.models_event import OpsSecurityEvent  # noqa: E402

_FORCES_JSON_FIELDS = {"force_requests", "force_allocation"}


@receiver(post_save, sender=OpsSecurityEvent)
def project_forces_ledger(sender, instance, update_fields=None, created=False, **kwargs):
    if not created and update_fields is not None and not (
        set(update_fields) & _FORCES_JSON_FIELDS
    ):
        return
    # 🔴 ПРОЕЦИРОВАТЬ НЕЧЕГО, ПОКА ОБА ПОЛЯ ПУСТЫ (Plane №522, п. 5). Условие
    # выше выходит рано ТОЛЬКО когда `update_fields` передан: любое
    # `event.save()` без него — и всякое СОЗДАНИЕ — прогоняло проекцию
    # целиком, с запросами в четыре таблицы, ради заведомо пустого результата.
    # А сохранений мероприятия без `update_fields` в цепочке большинство:
    # писателей в `security_events` около дюжины.
    #
    # Проверка по СОДЕРЖИМОМУ, а не по списку полей, и потому безопасна: если
    # заявок и раскладки нет, `forces_ledger.project` не найдёт что дописать
    # (он проходит ровно по этим двум спискам) и вернёт нули. Появилась первая
    # строка — условие перестаёт срабатывать в тот же момент.
    if not (instance.force_requests or instance.force_allocation):
        return
    if getattr(instance, "_skip_forces_ledger", False):
        return
    from organization_management.apps.ops import forces_ledger

    forces_ledger.project(instance)
