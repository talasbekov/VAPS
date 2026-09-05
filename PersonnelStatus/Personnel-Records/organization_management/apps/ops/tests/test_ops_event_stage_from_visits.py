"""Стадия, готовность и потребность мероприятия считаются по его объектам.

Plane №412, Ш-6 плана №385. Требование `[МД-04]`: «у объекта свои этапы 1–5».
Пока стадию вели у МЕРОПРИЯТИЯ, ОМ с двумя объектами имел одну стадию на оба:
первый объект согласован, второй ещё на расстановке — а карточка говорила
что-то одно, и что именно, зависело от того, кто последним нажал кнопку.

Правило: стадия мероприятия — НАИМЕНЬШАЯ среди объектов (прошло тогда, когда
прошёл последний), потребность — СУММА. Поле осталось колонкой, потому что по
нему фильтрует реестр и считает воронку аналитика; колонка теперь ХРАНИТ
ВЫВОД.

Пробы стерегут:

1. объекты получают стадию, а мероприятие берёт наименьшую;
2. потребность мероприятия — сумма потребностей объектов;
3. согласование одного объекта мероприятие вперёд не двигает, а согласование
   последнего — двигает;
4. закрытие мероприятия закрывает и объекты;
5. обход админа двигает все объекты разом;
6. ОМ БЕЗ объектов посещения стадию не теряет — считать не из чего.
"""
from django.utils import timezone

import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def actor(db):
    """Живая учётка: журнал мутаций пишется поимённо и `None` не принимает."""
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(
        username="stage-actor", password="x"
    )


def _visits(event_id):
    return list(
        OpsSecurityEventVisitObject.objects.filter(
            event_id=event_id
        ).order_by("position", "pk")
    )


def test_the_event_takes_the_smallest_stage_of_its_objects(
    manager, two_objects_on_approval  # noqa: F811
):
    """Наименьшая, а не наибольшая: взять наибольшую значило бы объявить
    готовым ОМ, у которого половина мест ещё не расписана."""
    _, event_id, first, second, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    assert event.stage == "APPROVAL"
    assert {v.stage for v in _visits(event_id)} == {"APPROVAL"}

    # Один объект ушёл вперёд руками — мероприятие остаётся на наименьшей.
    service.advance_visits(event, "ACKNOWLEDGEMENT", visits=[first])

    event = service.lock_event(event_id)
    assert event.stage == "APPROVAL", "мероприятие уехало за одним объектом"
    first.refresh_from_db()
    second.refresh_from_db()
    assert (first.stage, second.stage) == ("ACKNOWLEDGEMENT", "APPROVAL")

    # Догнал второй — мероприятие идёт следом.
    service.advance_visits(event, "ACKNOWLEDGEMENT", visits=[second])
    event = service.lock_event(event_id)
    assert event.stage == "ACKNOWLEDGEMENT"
    assert event.readiness_percent == service.STAGE_READINESS["ACKNOWLEDGEMENT"]


def test_the_need_of_the_event_is_the_sum_of_its_objects(
    manager, two_objects_on_approval  # noqa: F811
):
    _, event_id, _, _, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    visits = _visits(event_id)

    assert all(v.force_need > 0 for v in visits), (
        "потребность объекта не посчитана — проба вакуумна"
    )
    assert event.force_need == sum(v.force_need for v in visits)
    # И «назначено» у объекта — счёт по ЕГО постам, а не по мероприятию.
    assert sum(v.force_assigned for v in visits) == len(
        event.placement_assignments
    )


def test_approving_the_last_object_moves_the_event(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    base, event_id, first, second, _ = two_objects_on_approval
    for index, visit in enumerate((first, second)):
        manager.post(
            f"{base}approval/route/",
            {
                "name": "К. Оразов",
                "unit": "Департамент охраны",
                "position": "Заместитель",
                "visitObjectId": str(visit.pk),
            },
            format="json",
        )
        manager.post(
            f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
        )
        visit.refresh_from_db()
        approver.post(
            f"{base}approval/route/{visit.approval_route[0]['id']}/decide/",
            {
                "decision": "APPROVED",
                "comment": "",
                "visitObjectId": str(visit.pk),
            },
            format="json",
        )
        if index == 0:
            assert service.lock_event(event_id).stage == "APPROVAL", (
                "мероприятие ушло вперёд по одному объекту"
            )

    # Подпись единственного согласующего завершает объект САМА (`[СОГ-09]`,
    # Plane №399) — цикл выше уже согласовал оба; ручки `approve/` не нужны.
    first.refresh_from_db()
    second.refresh_from_db()
    assert (first.stage, second.stage) == ("ACKNOWLEDGEMENT", "ACKNOWLEDGEMENT")
    assert service.lock_event(event_id).stage == "ACKNOWLEDGEMENT"


def test_closing_the_event_closes_its_objects(
    manager, actor, two_objects_on_approval  # noqa: F811
):
    """Закрытое ОМ с объектом «на расстановке» показывало бы работу, которой
    больше нет."""
    _, event_id, _, _, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    service.override_stage(event.pk, stage="CONDUCT", actor=actor)
    event = service.lock_event(event_id)
    summaries = [
        {"direction": sector, "summary": "Без происшествий."}
        for sector in {p.get("sector") for p in event.recon_sector_posts}
    ]

    service.close_event(event.pk, direction_summaries=summaries, actor=actor)

    event = service.lock_event(event_id)
    assert event.stage == "CLOSED"
    visits = _visits(event_id)
    assert {v.stage for v in visits} == {"CLOSED"}
    assert all(v.closed_at is not None for v in visits)


def test_the_admin_override_moves_every_object(
    manager, actor, two_objects_on_approval  # noqa: F811
):
    """Обход переводит карточку целиком: «половину объектов вперёд» никто не
    просил, и такая выборочность была бы решением, которого не принимали."""
    _, event_id, _, _, _ = two_objects_on_approval

    service.override_stage(event_id, stage="RECON", actor=actor)

    event = service.lock_event(event_id)
    assert event.stage == "RECON"
    assert {v.stage for v in _visits(event_id)} == {"RECON"}


def test_an_event_without_visit_objects_keeps_its_own_stage(manager):  # noqa: F811
    """Такие ОМ есть (бюллетень без объекта), и считать им стадию НЕ ИЗ ЧЕГО.

    Обнулить её ради стройности значило бы стереть работающее: у этих
    мероприятий весь ход работы по-прежнему лежит в самом мероприятии.
    """
    created = manager.post(
        URL,
        {
            "title": "ОМ без объекта посещения",
            "businessDate": "2026-09-03",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    assert not _visits(event_id), "у ОМ без объекта завёлся объект посещения"

    manager.patch(
        f"{URL}{event_id}/bulletin/",
        {"briefDescription": "Есть.", "initialTasks": "Есть."},
        format="json",
    )
    resp = manager.post(f"{URL}{event_id}/bulletin/complete/")

    assert resp.status_code == 200, resp.content
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert event.stage == "RECON", "стадия ОМ без объектов перестала двигаться"


def test_the_override_aligns_objects_even_when_the_event_is_already_there(
    manager, approver, actor, two_objects_on_approval  # noqa: F811
):
    """🔴 ОБХОД МОЛЧА НЕ СРАБАТЫВАЛ ИМЕННО ТОГДА, КОГДА НУЖЕН (Plane №478).

    Шорткат идемпотентности `if old_stage == stage: return event` написан во
    времена, когда этап был один на мероприятие. Теперь `event.stage` —
    МИНИМУМ по объектам, и равенство ему перестало значить «все на месте».

    Объект А на «Согласовании», объект Б на «Расстановке» — этап мероприятия
    «Расстановка». Администратор жмёт обход на «Расстановку», желая вернуть
    карточку ЦЕЛИКОМ, и получает успех, за которым не сделано ничего: А как
    был согласуемым, так и остался.

    Цена ошибки выше обычной: обход — последнее средство, к нему идут, когда
    всё остальное встало (№475). Именно в этот момент он и отказывал, отвечая
    «сделано».
    """
    _, event_id, first, second, _ = two_objects_on_approval
    back = approver.post(
        f"{URL}{event_id}/approval/return/",
        {"comment": "переделать", "visitObjectId": str(second.pk)},
        format="json",
    )
    assert back.status_code == 200, back.content

    event = service.lock_event(event_id)
    first.refresh_from_db()
    second.refresh_from_db()
    assert (first.stage, second.stage) == ("APPROVAL", "PLACEMENT")
    assert event.stage == "PLACEMENT", "минимум по объектам — иначе проба не о том"
    before = OpsSecurityEventTransition.objects.filter(event=event).count()

    service.override_stage(event_id, stage="PLACEMENT", actor=actor)

    assert {v.stage for v in _visits(event_id)} == {"PLACEMENT"}, (
        "обход ответил успехом и не выровнял объекты"
    )
    # Переход из этапа в него же в журнал НЕ пишется: воронка посчитала бы его
    # прогрессом (вид определяется сравнением индексов, равенство даёт
    # FORWARD). Выровнялись объекты, а этап мероприятия не двигался.
    assert OpsSecurityEventTransition.objects.filter(event=event).count() == before


def test_the_override_still_does_nothing_when_everyone_is_already_there(
    manager, actor, two_objects_on_approval  # noqa: F811
):
    """Обратная сторона №478: шорткат ослаблен ровно на выравнивание объектов.

    Без этой пробы правку не отличить от «снять шорткат совсем»: повтор
    запроса (двойной клик, ретрай сети) снова писал бы в журнал переход из
    этапа в него же.
    """
    _, event_id, _, _, _ = two_objects_on_approval
    service.override_stage(event_id, stage="RECON", actor=actor)
    event = service.lock_event(event_id)
    stamp = event.updated_at
    before = OpsSecurityEventTransition.objects.filter(event=event).count()

    service.override_stage(event_id, stage="RECON", actor=actor)

    event = service.lock_event(event_id)
    assert event.updated_at == stamp, "повтор обхода тронул карточку"
    assert OpsSecurityEventTransition.objects.filter(event=event).count() == before


def test_the_override_clears_a_closed_stamp_of_a_single_object(
    manager, actor, two_objects_on_approval  # noqa: F811
):
    """Перевод на живой этап снимает штамп закрытия ОБЪЕКТА (Plane №527).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Условие стояло `old_stage == "CLOSED"`, то есть штамп
    снимался, только если было закрыто ВСЁ мероприятие. Но `close_visit_object`
    умеет закрыть ОТДЕЛЬНЫЙ объект при мероприятии на «Проведении» — и после
    обхода на живой этап получался объект со стадией `PLACEMENT` и непустым
    `closed_at`: «закрыт и одновременно в работе». Экраны и отчёты читают эти
    два поля НЕЗАВИСИМО, и каждый верит своему.

    Мутация, на которой проба обязана краснеть: вернуть `old_stage == "CLOSED"`.
    """
    _, event_id, first, _, _ = two_objects_on_approval
    # Закрыт ОДИН объект, мероприятие при этом живо — ровно тот случай, что
    # условие по `old_stage` не покрывало.
    OpsSecurityEventVisitObject.objects.filter(pk=first.pk).update(
        stage="CLOSED", closed_at=timezone.now()
    )
    event = service.lock_event(event_id)
    assert event.stage != "CLOSED", "предусловие: мероприятие не закрыто"

    service.override_stage(event_id, stage="PLACEMENT", actor=actor)

    first.refresh_from_db()
    assert first.stage == "PLACEMENT"
    assert first.closed_at is None, "объект «закрыт и одновременно в работе»"


def test_closing_is_not_an_override_target_at_all():
    """Обходом карточку НЕ закрывают (инвариант, на который опирается №527).

    Штамп закрытия снимается безусловно ровно потому, что все цели обхода —
    живые этапы. Если завтра `CLOSED` окажется среди них, снятие штампа станет
    неверным, и эта проба покраснеет раньше, чем кто-нибудь закроет карточку
    обходом без сводки и комментария.
    """
    assert "CLOSED" not in service.STAGE_OVERRIDE_TARGETS


def test_removing_an_object_recomputes_the_event_stage(
    manager, actor, two_objects_on_approval  # noqa: F811
):
    """Снятие объекта пересчитывает этап мероприятия (Plane №525).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. С №412 `event.stage` — МИНИМУМ по объектам, а снятие
    объекта минимум меняет: ушёл тот, кто один и держал мероприятие на раннем
    этапе. Без пересчёта `event.stage` остаётся НИЖЕ нового минимума, и дальше
    `complete_acknowledgement` отбивает единственный оставшийся объект, который
    уже стоит на «Ознакомлении», — мероприятие запирается снятием ЧУЖОГО
    объекта.

    Мутация, на которой проба обязана краснеть: убрать вызов
    `recompute_event_stage` из `remove_visit_object`.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    # Второй объект уводится ВПЕРЁД, первый остаётся позади и держит минимум.
    OpsSecurityEventVisitObject.objects.filter(pk=second.pk).update(
        stage="ACKNOWLEDGEMENT"
    )
    OpsSecurityEventVisitObject.objects.filter(pk=first.pk).update(stage="PLACEMENT")
    service.recompute_event_stage(service.lock_event(event_id))
    assert service.lock_event(event_id).stage == "PLACEMENT", "предусловие: минимум"

    # Посты первого объекта мешают снятию — снимаем их разметку, как это
    # делает человек перед удалением объекта.
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        {**post, "visitObjectId": None}
        for post in (event.recon_sector_posts or [])
        if str(post.get("visitObjectId") or "") != str(first.pk)
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    service.remove_visit_object(event_id, first.pk)

    assert service.lock_event(event_id).stage == "ACKNOWLEDGEMENT", (
        "этап мероприятия остался ниже нового минимума — карточка заперта"
    )
