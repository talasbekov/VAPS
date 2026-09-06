"""У раздела уведомлений нет обработчиков сигналов, и это решение (Plane №866).

ЧТО БЫЛО. `signals.py` подключал три приёмника — новая заявка на
прикомандирование (`SecondmentRequest`), смена статуса сотрудника, правка и
удаление карточки (`Employee`). Ни один из них не работал НИ РАЗУ: модуль
импортировал `EmployeeStatusLog` из `apps.statuses.models`, а такой модели в
этом репозитории нет вовсе, и `ready()` глушил отказ молчаливым `except`.
Уведомления по этим событиям не создавались нигде — ни строкой в таблице, ни
сообщением в сокете.

РЕШЕНИЕ ЗАКАЗЧИКА 06.09.2026: снять как мёртвый порт чужого проекта. Оживление
означало бы заметную смену поведения (люди начали бы получать уведомления,
которых сегодня нет), а живые уведомления раздела ОМ идут явными вызовами
`apps/operations/notify_service.py`.

🔴 ЗАЧЕМ ПРОБА, ЕСЛИ КОД ПРОСТО УДАЛЁН. Удаление ничем не защищено: следующий
заход, увидев «уведомлений о смене статуса нет», заведёт приёмник заново — и
сделает это МОЛЧА, потому что решение заказчика останется в истории карточки, а
не в коде. Проба краснеет ровно на этом и называет решение вслух; если
уведомления понадобятся, её снимают вместе с новым решением — осознанно.

Проба спрашивает РЕЕСТР СИГНАЛОВ Django, а не наличие файла: приёмник можно
объявить где угодно, и «файла signals.py нет» ничего не доказывало бы.
"""
import pytest
from django.db.models.signals import post_delete, post_save

from organization_management.apps.employees.models import Employee
from organization_management.apps.secondments.models import SecondmentRequest

#: Модели, на сохранение которых раздел уведомлений вешал приёмники.
WATCHED = (Employee, SecondmentRequest)

#: Пакет, приёмники из которого и снимались.
PACKAGE = "organization_management.apps.notifications"


def _receivers_from_notifications(signal, sender):
    """Живые приёмники сигнала, объявленные в разделе уведомлений."""
    found = []
    for receiver in signal._live_receivers(sender):
        module = getattr(receiver, "__module__", "")
        if module.startswith(PACKAGE):
            found.append(f"{module}.{getattr(receiver, '__name__', receiver)}")
    return found


@pytest.mark.parametrize("model", WATCHED, ids=lambda m: m.__name__)
def test_notifications_hangs_no_save_receiver(model):
    assert _receivers_from_notifications(post_save, model) == [], (
        "раздел уведомлений снова вешает приёмник на сохранение "
        f"{model.__name__}. Это решение заказчика (Plane №866, «снять как "
        "мёртвый порт»), и менять его молча нельзя: оживление добавляет людям "
        "уведомления, которых сегодня нет."
    )


def test_notifications_hangs_no_delete_receiver():
    assert _receivers_from_notifications(post_delete, Employee) == [], (
        "раздел уведомлений снова вешает приёмник на удаление сотрудника "
        "(Plane №866)"
    )


def test_the_dead_module_is_gone_and_does_not_come_back_by_import():
    """Самого модуля нет, и его импорт больше ничего не оживляет.

    Вторая половина: приёмники могли бы вернуться не реестром, а тем, что
    кто-то снова импортирует `signals` в `ready()`. Здесь проверяется, что
    импортировать нечего.
    """
    import importlib

    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(f"{PACKAGE}.signals")
