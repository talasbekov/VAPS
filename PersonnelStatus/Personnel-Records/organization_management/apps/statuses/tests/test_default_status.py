"""Инвариант: у каждого РАБОТАЮЩЕГО сотрудника есть действующий статус.

Держится в двух местах, и проверяются оба:

* сигнал `give_new_employee_a_status` — на будущее, при заведении сотрудника
  любым путём (ручка, админка, импорт, сид);
* команда `ensure_employee_statuses` — разово за прошлое, когда дефолт заводила
  единственная ручка и мимо неё проходили четверо из четырнадцати.

Уволенные в инвариант НЕ входят: соседний сигнал `close_statuses_on_dismissal`
закрывает их статусы намеренно, и «в строю» уволенному — это война двух
сигналов, а не порядок.
"""
from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import transaction
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.services import (
    default_status_start,
    ensure_active_status,
)

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState


def _active(employee):
    return employee.statuses.filter(state=_STATE.ACTIVE)


@pytest.mark.django_db(transaction=True)
def test_new_employee_gets_a_status():
    """Заведение сотрудника даёт статус САМО, без участия ручки.

    🔴 `transaction=True` обязателен. Сигнал вешает работу на
    `transaction.on_commit`, а обычный `django_db` держит тест в транзакции,
    которую откатывает, — коммита не случается, колбэк не выполняется, и проба
    краснела бы на исправном коде (сначала так и было).

    Заодно это и есть доказательство, что `on_commit` выбран не зря: статус не
    появляется, пока сотрудник не зафиксирован. Откат заведения сотрудника не
    оставит статуса-сироты.
    """
    employee = Employee.objects.create(
        personnel_number="def-1", last_name="Новиков", first_name="Иван",
        hire_date=timezone.now().date() - timedelta(days=1000),
    )

    status = _active(employee).get()
    assert status.status_type == _ST.IN_SERVICE
    # С даты приёма, а не с сегодня: «в строю с сегодня» у человека, который
    # работает третий год, — неправда.
    assert status.start_date == employee.hire_date
    assert status.end_date is None, '«В строю» бессрочен'
    assert status.created_by is None, 'завела система, а не человек'


@pytest.mark.django_db
def test_dismissed_employee_gets_no_status():
    """Уволенному статус не заводится — ни сигналом, ни командой."""
    today = timezone.now().date()
    employee = Employee.objects.create(
        personnel_number="def-2", last_name="Уволенов", first_name="Пётр",
        hire_date=today - timedelta(days=500),
        employment_status=Employee.EmploymentStatus.FIRED,
        dismissal_date=today - timedelta(days=10),
        is_active=False,
    )

    assert not _active(employee).exists()
    assert ensure_active_status(employee) is None

    call_command('ensure_employee_statuses', stdout=StringIO())
    assert not _active(employee).exists(), 'уволенному вернули «в строю»'


@pytest.mark.django_db
def test_existing_status_is_left_alone():
    """Идемпотентность: у кого статус есть, тому ничего не дописывается."""
    today = timezone.now().date()
    employee = Employee.objects.create(
        personnel_number="def-3", last_name="Отпускной", first_name="Олег",
        hire_date=today - timedelta(days=500),
    )
    # Сигнал уже завёл «в строю» — меняем его на отпуск, как сделал бы человек.
    _active(employee).delete()
    EmployeeStatus.objects.create(
        employee=employee, status_type=_ST.VACATION,
        start_date=today - timedelta(days=1), end_date=today + timedelta(days=5),
    )

    assert ensure_active_status(employee) is None
    call_command('ensure_employee_statuses', stdout=StringIO())

    assert _active(employee).count() == 1
    assert _active(employee).get().status_type == _ST.VACATION, (
        'команда подменила действующий статус своим «в строю»'
    )


@pytest.mark.django_db
def test_start_follows_the_last_finished_status():
    """После завершённого статуса «в строю» начинается СО СЛЕДУЮЩЕГО дня.

    С даты приёма нельзя: `clean()` запрещает пересечение периодов, и создание
    упало бы. Здесь сторожится именно расчёт, а не «хоть что-нибудь создалось».
    """
    today = timezone.now().date()
    employee = Employee.objects.create(
        personnel_number="def-4", last_name="Историев", first_name="Илья",
        hire_date=today - timedelta(days=500),
    )
    _active(employee).delete()
    finished_end = today - timedelta(days=30)
    EmployeeStatus.objects.create(
        employee=employee, status_type=_ST.TRAINING,
        start_date=today - timedelta(days=60), end_date=finished_end,
    )
    # Гвард против вакуума: статус обязан быть именно ЗАВЕРШЁННЫМ, иначе
    # проверялась бы ветка «действующий уже есть».
    assert not _active(employee).exists()

    assert default_status_start(employee) == finished_end + timedelta(days=1)

    status = ensure_active_status(employee)
    assert status is not None
    assert status.start_date == finished_end + timedelta(days=1)


@pytest.mark.django_db
def test_command_fixes_everyone_and_repeats_cleanly():
    """Команда закрывает всех разом и при повторе не пишет ничего."""
    today = timezone.now().date()
    people = []
    for index in range(3):
        employee = Employee.objects.create(
            personnel_number=f"def-mass-{index}", last_name=f"Пустов{index}",
            first_name="Имя", hire_date=today - timedelta(days=100),
        )
        # Убираем статус, заведённый сигналом, — воспроизводим прошлое
        # состояние базы, где сотрудники приходили мимо ручки.
        _active(employee).delete()
        people.append(employee)

    assert all(not _active(person).exists() for person in people)

    out = StringIO()
    call_command('ensure_employee_statuses', stdout=out)
    assert 'Заведено статусов: 3' in out.getvalue(), out.getvalue()
    for person in people:
        assert _active(person).count() == 1

    before = EmployeeStatus.objects.count()
    repeat = StringIO()
    call_command('ensure_employee_statuses', stdout=repeat)
    assert EmployeeStatus.objects.count() == before, 'повтор дописал статусы'
    assert 'Все работающие сотрудники имеют действующий статус.' in repeat.getvalue()


@pytest.mark.django_db
def test_dry_run_writes_nothing():
    today = timezone.now().date()
    employee = Employee.objects.create(
        personnel_number="def-dry", last_name="Сухов", first_name="Сергей",
        hire_date=today - timedelta(days=100),
    )
    _active(employee).delete()
    before = EmployeeStatus.objects.count()

    out = StringIO()
    call_command('ensure_employee_statuses', '--dry-run', stdout=out)

    assert EmployeeStatus.objects.count() == before, 'сухой прогон записал'
    assert 'Сухов' in out.getvalue(), 'сухой прогон не назвал, кого коснётся'
    assert not _active(employee).exists()


@pytest.mark.django_db(transaction=True)
def test_explicit_creation_and_signal_do_not_collide():
    """Ручка, заводящая статус САМА, не получает от сигнала второй.

    🔴 Сценарий не теоретический: `_directorate_create` создаёт «в строю»
    явно, внутри своей транзакции. Сигнал вешает свою попытку на коммит той же
    транзакции — то есть выполняется ПОСЛЕ. Без проверки «действующий уже
    есть» он попытался бы создать второй, упёрся в запрет пересечения и уронил
    бы заведение сотрудника исключением уже после коммита.

    Здесь воспроизводится именно порядок «сотрудник и статус в одной
    транзакции, колбэк после неё».
    """
    today = timezone.now().date()
    with transaction.atomic():
        employee = Employee.objects.create(
            personnel_number="def-both", last_name="Двойнов", first_name="Дмитрий",
            hire_date=today - timedelta(days=200),
        )
        EmployeeStatus.objects.create(
            employee=employee,
            status_type=_ST.IN_SERVICE,
            start_date=today - timedelta(days=200),
        )

    assert _active(employee).count() == 1, 'сигнал добавил второй действующий статус'


@pytest.mark.django_db
def test_start_ignores_cancelled_and_respects_actual_end():
    """Дата дефолта считается по СОСТОЯВШЕМУСЯ концу периода.

    🔴 Оба правила поймал смоук-обход, а не мысленный разбор. Первая версия
    брала `Max(end_date)` и `Max(actual_end_date)` ПОРОЗНЬ и не отсеивала
    отменённые: у реального сотрудника стенда получалась дата в БУДУЩЕМ,
    статус создавался `planned` вместо `active`, а команда рапортовала
    «Заведено статусов: 7», не восстановив инвариант.
    """
    today = timezone.now().date()
    employee = Employee.objects.create(
        personnel_number="def-calc", last_name="Расчётов", first_name="Роман",
        hire_date=today - timedelta(days=900),
    )
    _active(employee).delete()

    # Досрочно завершённый: числился до +10, фактически закрыт -5 дней назад.
    EmployeeStatus.objects.create(
        employee=employee, status_type=_ST.VACATION,
        start_date=today - timedelta(days=20),
        end_date=today + timedelta(days=10),
        actual_end_date=today - timedelta(days=5),
    )
    # Отменённый с ДАЛЁКИМ концом: период он не занимал вовсе.
    cancelled = EmployeeStatus.objects.create(
        employee=employee, status_type=_ST.TRAINING,
        start_date=today - timedelta(days=3),
        end_date=today + timedelta(days=100),
    )
    EmployeeStatus.objects.filter(pk=cancelled.pk).update(state=_STATE.CANCELLED)

    # Гвард против вакуума: без него проба не отличала бы правило от совпадения.
    assert not _active(employee).exists()

    expected = today - timedelta(days=4)
    assert default_status_start(employee) == expected, (
        'дата взята не по фактическому концу либо испорчена отменённым статусом'
    )

    status = ensure_active_status(employee)
    assert status is not None
    assert status.start_date == expected
    # Главное следствие: статус ДЕЙСТВУЮЩИЙ, а не запланированный.
    assert status.state == _STATE.ACTIVE, (
        'статус ушёл в planned — инвариант не восстановлен'
    )
