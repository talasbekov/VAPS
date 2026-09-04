"""Процесс 2 «Охранное мероприятие» ЦЕЛИКОМ и его связка с расходом
(Plane №259, Ш-4).

ЗАЧЕМ ЭТО ЕСТЬ. Каждый шаг цикла ОМ покрыт своей пробой — рекогносцировка,
раскладка, расстановка, согласование, ознакомление, закрытие живут в шести
разных файлах. Ни одна из них не отвечает на вопрос заказчика: «пройдёт ли
мероприятие ОТ БЮЛЛЕТЕНЯ ДО ЗАКРЫТИЯ». Цепочка рвётся не внутри шага, а на
стыке — там, где следующий шаг ждёт состояния, которого предыдущий не оставил.

СВЯЗКА ДВУХ ПРОЦЕССОВ проверяется здесь же, и она устроена не так, как описана
в постановке. Заказчик пишет: «из ежедневного расхода списки со статусом
„Участие на ОМ“ по управлениям попадают ответственному, тот сводит по
департаменту и отправляет штабу Д2». В коде направление ОБРАТНОЕ: департамент
называет людей штабу (`forces/allocation/<id>/members/`), и это действие САМО
заводит человеку статус `IN_EVENT` (слияние, Plane №486) — то есть участие в ОМ появляется в
расходе следствием выделения, а не наоборот. Результат для заказчика тот же
(человек виден в расходе как привлечённый), но путь другой, и проба
фиксирует именно код, а не пересказ.
"""
import pytest

from organization_management.apps.operations.models_status import OpsEmployeeStatus

from .test_ops_forces_gathering import (  # noqa: F401
    allocated_event,
    make_assignment_status_type,
    make_department,
    make_directorate,
    make_employee,
)
from .test_ops_security_events_api import approver, manager  # noqa: F401

pytestmark = pytest.mark.django_db


def test_an_event_walks_from_bulletin_to_closure(manager, approver):  # noqa: F811
    """Полный цикл ОМ одной пробой: девять шагов постановки заказчика."""
    make_assignment_status_type()
    department = make_department()
    make_directorate(department, "Управление охраны")
    person = make_employee("Сериков")

    # Шаги 1–3 постановки: бюллетень, объект, рекогносцировка и автопередача
    # цифры штабу — их собирает фикстура соседнего файла и на выходе даёт ОМ
    # уже с заявкой департаменту (шаг 4).
    base, allocation_id = allocated_event(manager, department)

    # Шаг 4: штаб оповещает департамент.
    notified = manager.post(f"{base}forces/allocation/{allocation_id}/notify/")
    assert notified.status_code == 200, notified.json()

    # Шаг 5: департамент называет людей и отправляет список штабу.
    added = manager.post(
        f"{base}forces/allocation/{allocation_id}/members/",
        {"employeeId": str(person.pk)},
        format="json",
    )
    assert added.status_code == 200, added.json()
    sent = manager.post(f"{base}forces/allocation/{allocation_id}/submit/")
    assert sent.status_code == 200, sent.json()
    accepted = manager.post(f"{base}forces/allocation/{allocation_id}/accept/")
    assert accepted.status_code == 200, accepted.json()

    # 🔴 СВЯЗКА С ПРОЦЕССОМ 1: человек, отданный на ОМ, несёт статус участия —
    # именно по нему расход считает занятость мероприятиями.
    assert OpsEmployeeStatus.objects.filter(
        employee_id=person.pk, status_type_code="IN_EVENT"
    ).exists(), "выделенный человек не получил статус участия — расход его не увидит"

    # Шаг 7: расстановка. Состав принят, значит на посты ставят из него.
    event = manager.get(f"{base}").json()
    roster = event["forceRoster"]
    assert roster, "штаб принял людей, но состава у мероприятия нет"
    posts = event["reconSectorPosts"]
    assert posts, "расчёт постов пуст — расставлять некуда"

    # Постов может быть больше, чем принятых людей (тот самый недобор): лишние
    # снимаются — шаг 6 постановки, ради которого и делался Ш-1.
    seated = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[0]["id"], "employeeId": str(roster[0]["employeeId"])},
        format="json",
    )
    assert seated.status_code == 200, seated.json()
    for extra in posts[1:]:
        dropped = manager.delete(f"{base}placement/posts/{extra['id']}/")
        assert dropped.status_code == 200, dropped.json()

    done = manager.post(f"{base}placement/complete/")
    assert done.status_code == 200, done.json()
    assert done.json()["stage"] == "APPROVAL", done.json()["stage"]

    # Шаг 8: документ уходит руководству Д2 и заместителю организации.
    # Маршрут заводится ЯВНО: пустой маршрут сервер отбивает
    # (`APPROVAL_ROUTE_EMPTY`), и подпись под расстановкой, которую никто не
    # смотрел, была бы подписью ни под чем.
    route = manager.post(
        f"{base}approval/route/",
        {
            "name": "К. Оразов",
            "unit": "Департамент 2",
            "position": "Заместитель организации",
        },
        format="json",
    )
    assert route.status_code == 200, route.json()
    approver_id = route.json()["approvalRoute"][0]["id"]
    sent_for_approval = manager.post(f"{base}approval/send/")
    assert sent_for_approval.status_code == 200, sent_for_approval.json()
    # Решение согласующего — от СОГЛАСУЮЩЕГО: с 28.08.2026 подпись и возврат
    # разведены с ведением мероприятия (решение заказчика, Plane №267).
    decided = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )
    assert decided.status_code == 200, decided.json()

    # Последняя подпись завершает этап САМА (`[СОГ-09]`, Plane №399) — ручка
    # `approve/` для этого больше не нужна, ответ на решение уже несёт стадию.
    approved = decided
    assert approved.json()["stage"] == "ACKNOWLEDGEMENT", approved.json()["stage"]

    # Шаг 9: ознакомление — кнопка рассылки и завершение этапа.
    notify = manager.post(f"{base}acknowledgement/notify/")
    assert notify.status_code == 200, notify.json()
    # Ознакомление ЗАВЕРШАЕТСЯ не рассылкой, а подтверждениями: этап не
    # закрывается, пока каждый назначенный не отметился
    # (`ACKNOWLEDGEMENT_INCOMPLETE`). Уведомление — приглашение, а не факт
    # ознакомления, и подменять одно другим нельзя.
    # Список назначений берётся у САМОГО мероприятия: рассылка отвечает
    # отчётом «кому ушло», а не карточкой ОМ.
    for assignment in manager.get(f"{base}").json()["placementAssignments"]:
        confirmed = manager.post(f"{base}acknowledge/{assignment['id']}/")
        assert confirmed.status_code == 200, confirmed.json()

    ack_done = manager.post(f"{base}acknowledgement/complete/")
    assert ack_done.status_code == 200, ack_done.json()
    assert ack_done.json()["stage"] == "CONDUCT", ack_done.json()["stage"]

    # Шаг 10: закрытие. Итог обязателен по КАЖДОМУ направлению расчёта:
    # частичного закрытия нет, иначе «ОМ отработано» говорилось бы о
    # мероприятии, часть которого никто не подытожил.
    directions = sorted(
        {post["sector"] for post in manager.get(f"{base}").json()["reconSectorPosts"]}
    )
    closed = manager.post(
        f"{base}close/",
        {
            "directionSummaries": [
                {"direction": name, "summary": "Происшествий нет."}
                for name in directions
            ]
        },
        format="json",
    )
    assert closed.status_code == 200, closed.json()
    assert closed.json()["stage"] == "CLOSED", closed.json()["stage"]
    assert closed.json()["closedAt"] is not None, "закрытое ОМ без даты закрытия"
