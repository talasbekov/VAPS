"""«Текущий статус» — одно правило на всех, и два ЯВНО разных вопроса.

Определений было три и они расходились: два в `staff_unit` (порядок с
доводчиком и без, `None` против синтетического «в строю» БЕЗ ДАТ) и одно в
`statuses/application/services.py` (период должен покрывать сегодня).

Третье отличалось не по недосмотру — оно отвечает на другой вопрос. Поэтому
свести всё в одну функцию было бы неправильно, и главный тест здесь —
`test_two_selectors_answer_different_questions`: он держит различие явным,
чтобы следующий, кто решит «да это же одно и то же», увидел, что сломает.
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.selectors import (
    active_status,
    active_status_prefetch,
    status_on_date,
)

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


@pytest.fixture
def person(db):
    employee = Employee.objects.create(
        personnel_number="sel-1", last_name="Селектов", first_name="Семён",
        hire_date=timezone.localdate() - timedelta(days=900),
    )
    # Статус, заведённый сигналом, убираем: каждый тест ставит свой расклад.
    employee.statuses.all().delete()
    return employee


@pytest.mark.django_db
def test_two_selectors_answer_different_questions(person):
    """Истёкший, но НЕ закрытый статус: в списке есть, «на сегодня» — нет.

    Такой статус остаётся `state=ACTIVE` в базе, пока его не закроет
    `complete_expired_statuses_task`. Список обязан его показать — таблица
    подсвечивает строку как просроченную, и по ней видно, что статус пора
    закрыть. Ответу «что с человеком сегодня» он не годится.

    🔴 Если эти два селектора когда-нибудь сольют в один, упадёт именно этот
    тест — и это правильно.
    """
    today = timezone.localdate()
    expired = EmployeeStatus.objects.create(
        employee=person, status_type=_ST.VACATION,
        start_date=today - timedelta(days=20), end_date=today - timedelta(days=5),
    )
    # Гвард против вакуума: состояние должно остаться ACTIVE, иначе проба
    # проверяла бы обычный завершённый статус, а не расхождение селекторов.
    EmployeeStatus.objects.filter(pk=expired.pk).update(state=_STATE.ACTIVE)
    expired.refresh_from_db()
    assert expired.state == _STATE.ACTIVE, 'фикстура не даёт истёкший-но-активный'

    assert active_status(person) == expired, 'список потерял незакрытый статус'
    assert status_on_date(person.id, today) is None, (
        'истёкший статус выдан как действующий сегодня'
    )


@pytest.mark.django_db
def test_active_status_ignores_cancelled_and_completed(person):
    today = timezone.localdate()
    EmployeeStatus.objects.create(
        employee=person, status_type=_ST.SICK_LEAVE,
        start_date=today - timedelta(days=40), end_date=today - timedelta(days=35),
        state=_STATE.CANCELLED,
    )
    assert active_status(person) is None

    current = EmployeeStatus.objects.create(
        employee=person, status_type=_ST.TRAINING,
        start_date=today - timedelta(days=1), end_date=today + timedelta(days=3),
    )
    assert active_status(person) == current
    assert status_on_date(person.id, today) == current


@pytest.mark.django_db
def test_active_status_uses_prefetch_without_extra_query(person, django_assert_num_queries):
    """С префетчем выбор статуса не стоит ни одного запроса.

    Прежний код в списке подразделения звал `.order_by()` на связи и тем самым
    убивал уже объявленный рядом `Prefetch` — получался запрос на каждого
    сотрудника.
    """
    today = timezone.localdate()
    EmployeeStatus.objects.create(
        employee=person, status_type=_ST.VACATION,
        start_date=today - timedelta(days=1), end_date=today + timedelta(days=3),
    )

    loaded = (
        Employee.objects.filter(pk=person.pk)
        .prefetch_related(active_status_prefetch('statuses'))
        .first()
    )
    with django_assert_num_queries(0):
        assert active_status(loaded).status_type == _ST.VACATION


@pytest.mark.django_db
def test_serializer_reports_absence_instead_of_inventing_a_status(person):
    """Сериализатор штатки отдаёт `None`, а не синтетическое «в строю».

    Раньше при отсутствии статуса он возвращал
    `{"status_type": "in_service", "state": "active"}` БЕЗ дат: экран показывал
    статус, которого нет в базе, и колонки периода при этом пустовали. Это был
    второй источник «статуса без периода» в таблицах.
    """
    from organization_management.apps.staff_unit.serializers import EmployeeSerializer

    assert EmployeeSerializer(person).data['current_status'] is None

    today = timezone.localdate()
    EmployeeStatus.objects.create(
        employee=person, status_type=_ST.BUSINESS_TRIP,
        start_date=today, end_date=today + timedelta(days=2),
    )
    payload = EmployeeSerializer(person).data['current_status']
    assert payload['status_type'] == _ST.BUSINESS_TRIP
    # Период доезжает: ради него всё и затевалось.
    assert str(payload['start_date']) == str(today)
    assert str(payload['end_date']) == str(today + timedelta(days=2))
