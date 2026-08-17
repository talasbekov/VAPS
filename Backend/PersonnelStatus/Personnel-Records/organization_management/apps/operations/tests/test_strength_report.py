"""Расход раздела ОМ: чистое ядро, ORM-обёртка и эндпоинт.

Чистая часть гоняется БЕЗ базы — она и должна оставаться такой. Отдельно
проверяется главное отличие от источника: приоритеты и колонки берутся из
справочника, а не из литералов рядом с ним, поэтому правка каталога меняет
расход (и не требует синхронизации двух списков).
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    StatusType,
)
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.strength_report import (
    DERIVED_IN_SERVICE,
    StatusCatalog,
    StrengthReportService,
    derive_report,
    resolve_status,
)
from organization_management.apps.staff_unit.models import StaffUnit

TODAY = date(2026, 8, 4)
REPORT_URL = "/api/operations/strength-report/"

CATALOG_ROWS = [
    {
        "code": "SICK_LEAVE",
        "priority": 10,
        "report_column_code": "SICK",
        "counts_in_staff": True,
    },
    {
        "code": "VACATION",
        "priority": 20,
        "report_column_code": "VACATION",
        "counts_in_staff": True,
    },
    {
        "code": "ATTACHED",
        "priority": 50,
        "report_column_code": "ATTACHED",
        "counts_in_staff": False,
    },
    {
        "code": "DUTY",
        "priority": 70,
        "report_column_code": "ON_DUTY",
        "counts_in_staff": True,
    },
    {
        "code": DERIVED_IN_SERVICE,
        "priority": 999,
        "report_column_code": "IN_SERVICE",
        "counts_in_staff": True,
    },
]


def catalog():
    return StatusCatalog.from_rows(CATALOG_ROWS)


def fact(code, start=TODAY, end=TODAY + timedelta(days=1), employee_id=1):
    return {
        "employee_id": employee_id,
        "status_type_code": code,
        "date_start": start,
        "date_end": end,
    }


# ── Чистое ядро (без БД) ─────────────────────────────────────────────────

class TestResolveStatus:
    def test_no_facts_is_derived_in_service(self):
        assert resolve_status([], TODAY, catalog()) == DERIVED_IN_SERVICE

    def test_lowest_priority_wins(self):
        winner = resolve_status(
            [fact("DUTY"), fact("SICK_LEAVE"), fact("VACATION")], TODAY, catalog()
        )
        assert winner == "SICK_LEAVE"

    def test_half_open_end_day_does_not_act(self):
        # [start, end): в день end факт уже не действует.
        rows = [fact("DUTY", start=TODAY - timedelta(days=1), end=TODAY)]
        assert resolve_status(rows, TODAY, catalog()) == DERIVED_IN_SERVICE
        assert resolve_status(rows, TODAY - timedelta(days=1), catalog()) == "DUTY"

    def test_tie_break_is_deterministic(self):
        # Одинаковый приоритет → код по возрастанию: результат не зависит от
        # порядка строк, пришедших из БД.
        rows = [fact("A"), fact("B")]
        tied = StatusCatalog.from_rows(
            CATALOG_ROWS
            + [
                {
                    "code": "A",
                    "priority": 5,
                    "report_column_code": "X",
                    "counts_in_staff": True,
                },
                {
                    "code": "B",
                    "priority": 5,
                    "report_column_code": "X",
                    "counts_in_staff": True,
                },
            ]
        )
        assert resolve_status(rows, TODAY, tied) == "A"
        assert resolve_status(list(reversed(rows)), TODAY, tied) == "A"

    def test_unknown_code_raises(self):
        with pytest.raises(ValueError):
            resolve_status([fact("NO_SUCH")], TODAY, catalog())

    def test_catalog_without_in_service_is_rejected(self):
        rows = [r for r in CATALOG_ROWS if r["code"] != DERIVED_IN_SERVICE]
        with pytest.raises(ValueError):
            StatusCatalog.from_rows(rows)

    def test_columns_order_follows_priority_and_excludes_attached(self):
        # Порядок выводится из каталога, а не задан списком: SICK(10) →
        # VACATION(20) → ON_DUTY(70) → IN_SERVICE(999); ATTACHED вне штата.
        assert catalog().columns_in_order() == (
            "SICK",
            "VACATION",
            "ON_DUTY",
            "IN_SERVICE",
        )


class TestDeriveReport:
    def _slots(self, *occupants, division_id=1):
        return [
            {"division_id": division_id, "employee_id": eid} for eid in occupants
        ]

    def test_empty_slot_is_a_vacancy(self):
        result = derive_report(self._slots(1, None, None), [], TODAY, catalog())
        row = result.rows[0]
        assert (row.staff_total, row.list_total, row.vacancies) == (3, 1, 2)
        assert row.columns["IN_SERVICE"] == 1

    def test_occupant_outside_staff_leaves_the_list(self):
        # НАШ слот занят НАШИМ человеком, который сегодня не по нашему списку:
        # он в знаменателе (Штат == Список + Вне списка + Вакансии), но ни в
        # одну колонку списка не попадает. Это не «+N» — см. соседний тест.
        rows = [fact("ATTACHED", employee_id=2)]
        result = derive_report(self._slots(1, 2), rows, TODAY, catalog())
        row = result.rows[0]
        assert row.off_list == 1
        assert row.attached == 0
        assert row.list_total == 1
        assert row.staff_total == row.list_total + row.off_list + row.vacancies
        assert sum(row.columns.values()) == 1

    def test_attached_is_added_on_top_of_the_staff(self):
        # «+N» приходит проекцией пар, а не из слотов: он не занимает штат, не
        # входит в список и не попадает в колонки.
        result = derive_report(
            self._slots(1, None), [], TODAY, catalog(), attached_by_division={1: 2}
        )
        row = result.rows[0]
        assert row.attached == 2
        assert (row.staff_total, row.list_total, row.vacancies) == (2, 1, 1)
        assert row.staff_total == row.list_total + row.off_list + row.vacancies
        assert sum(row.columns.values()) == row.list_total
        assert result.totals.attached == 2

    def test_division_with_only_attached_still_appears(self):
        # Иначе приданные исчезли бы из расхода вовсе: у принимающего своих
        # слотов под них нет по определению.
        result = derive_report(
            self._slots(1, division_id=1),
            [],
            TODAY,
            catalog(),
            attached_by_division={2: 3},
        )
        rows = {row.division_id: row for row in result.rows}
        assert set(rows) == {1, 2}
        assert (rows[2].staff_total, rows[2].list_total, rows[2].attached) == (0, 0, 3)

    def test_totals_sum_across_divisions(self):
        slots = self._slots(1, None, division_id=1) + self._slots(
            2, division_id=2
        )
        result = derive_report(slots, [fact("DUTY", employee_id=2)], TODAY, catalog())
        assert result.totals.staff_total == 3
        assert result.totals.list_total == 2
        assert result.totals.vacancies == 1
        assert result.totals.columns["ON_DUTY"] == 1
        assert result.totals.columns["IN_SERVICE"] == 1

    def test_rows_ordered_by_division_name(self):
        slots = self._slots(1, division_id=1) + self._slots(2, division_id=2)
        result = derive_report(
            slots, [], TODAY, catalog(), division_names={1: "Я", 2: "А"}
        )
        assert [row.name for row in result.rows] == ["А", "Я"]

    def test_status_of_a_slotless_employee_is_ignored(self):
        # Факт сотрудника, которого нет ни в одном слоте, не должен ни во что
        # попасть: расход считается по слотам.
        result = derive_report(
            self._slots(1), [fact("VACATION", employee_id=777)], TODAY, catalog()
        )
        assert result.rows[0].columns["IN_SERVICE"] == 1
        assert result.rows[0].columns["VACATION"] == 0


# ── ORM-обёртка ──────────────────────────────────────────────────────────

@pytest.fixture
def seeded_catalog(db):
    for row in CATALOG_ROWS:
        StatusType.objects.create(
            code=row["code"],
            name=row["code"],
            priority=row["priority"],
            report_column_code=row["report_column_code"],
            counts_in_staff=row["counts_in_staff"],
        )


@pytest.fixture
def division(db):
    return Division.objects.create(name="Управление 1")


def make_employee(division=None, **overrides):
    seq = Employee.objects.count() + 1
    fields = {
        "first_name": "Иван",
        "last_name": "Иванов",
        "personnel_number": f"P{seq:05d}",
        "iin": f"{seq:012d}",
        "hire_date": date(2020, 1, 1),
    }
    fields.update(overrides)
    employee = Employee.objects.create(**fields)
    if division is not None:
        StaffUnit.objects.create(division=division, employee=employee, index=seq)
    return employee


def empty_slot(division):
    StaffUnit.objects.create(
        division=division, employee=None, index=StaffUnit.objects.count() + 1
    )


def live_status(employee, code, start=TODAY, end=TODAY + timedelta(days=2)):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
    )


@pytest.mark.django_db
class TestStrengthReportService:
    def test_counts_slots_statuses_and_vacancies(self, seeded_catalog, division):
        on_duty = make_employee(division)
        make_employee(division)  # без статуса → выводится «в строю»
        empty_slot(division)
        live_status(on_duty, "DUTY")
        result = StrengthReportService.compute(TODAY)
        row = result.rows[0]
        assert (row.staff_total, row.list_total, row.vacancies) == (3, 2, 1)
        assert row.columns["ON_DUTY"] == 1
        assert row.columns["IN_SERVICE"] == 1

    def test_cancelled_status_does_not_count(self, seeded_catalog, division):
        employee = make_employee(division)
        status = live_status(employee, "VACATION")
        status.cancelled_at = clock.Clock.now()
        status.save(update_fields=["cancelled_at"])
        result = StrengthReportService.compute(TODAY)
        assert result.rows[0].columns["VACATION"] == 0
        assert result.rows[0].columns["IN_SERVICE"] == 1

    def test_report_is_computed_on_the_given_date(self, seeded_catalog, division):
        employee = make_employee(division)
        live_status(
            employee, "VACATION", start=TODAY + timedelta(days=5),
            end=TODAY + timedelta(days=9),
        )
        # Дата приходит аргументом, а не из часов: на сегодня отпуска ещё нет,
        # на дату внутри интервала — есть.
        assert StrengthReportService.compute(TODAY).rows[0].columns["VACATION"] == 0
        later = StrengthReportService.compute(TODAY + timedelta(days=6))
        assert later.rows[0].columns["VACATION"] == 1

    def test_dismissed_occupant_is_a_vacancy_with_warning(
        self, seeded_catalog, division
    ):
        fired = make_employee(
            division, employment_status=Employee.EmploymentStatus.FIRED
        )
        make_employee(division)
        result = StrengthReportService.compute(TODAY)
        row = result.rows[0]
        assert (row.staff_total, row.list_total, row.vacancies) == (2, 1, 1)
        assert result.warnings == [
            {"reason": "dismissed_in_slot", "employee_ids": [fired.id]}
        ]

    def test_scope_limits_divisions(self, seeded_catalog, division):
        other = Division.objects.create(name="Управление 2")
        make_employee(division)
        make_employee(other)
        result = StrengthReportService.compute(TODAY, division_ids={division.id})
        assert [row.division_id for row in result.rows] == [division.id]
        assert result.totals.staff_total == 1

    def test_deactivated_type_still_resolves(self, seeded_catalog, division):
        # Тип деактивирован ПОСЛЕ того, как статус написан: расход обязан
        # остаться разрешимым, а не упасть на «неизвестном коде».
        employee = make_employee(division)
        live_status(employee, "VACATION")
        StatusType.objects.filter(code="VACATION").update(is_active=False)
        result = StrengthReportService.compute(TODAY)
        assert result.rows[0].columns["VACATION"] == 1

    def test_catalog_edit_changes_the_report(self, seeded_catalog, division):
        # Справочник — единственный источник правды: перевод дежурства в
        # колонку больничного меняет расход без правки кода.
        employee = make_employee(division)
        live_status(employee, "DUTY")
        StatusType.objects.filter(code="DUTY").update(report_column_code="SICK")
        result = StrengthReportService.compute(TODAY)
        assert result.rows[0].columns["SICK"] == 1
        # Колонка, на которую больше не ссылается ни один тип, из расхода
        # ИСЧЕЗАЕТ: набор колонок выводится из каталога, а не задан списком.
        assert "ON_DUTY" not in result.rows[0].columns

    def test_query_count_is_constant(self, seeded_catalog, division):
        for _ in range(3):
            make_employee(division)
        with CaptureQueriesContext(connection) as few:
            StrengthReportService.compute(TODAY)
        for _ in range(30):
            make_employee(division)
        with CaptureQueriesContext(connection) as many:
            StrengthReportService.compute(TODAY)
        assert len(few) == len(many), (
            f"N+1: 3 сотрудника — {len(few)} запросов, 33 — {len(many)}"
        )
        assert len(many) <= 6


# ── Эндпоинт ─────────────────────────────────────────────────────────────

def seed_role(code, perms):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
    for perm in perms:
        permission, _ = Permission.objects.get_or_create(
            code=perm, defaults={"name": perm}
        )
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    return role


def client_for(username, role_code=None, perms=(), scope_division_id=None):
    user = User.objects.create_user(username=username, password="x")
    if role_code is not None:
        seed_role(role_code, perms)
        RoleAdminService.assign_role(
            str(user.pk), role_code, scope_division_id, actor="test"
        )
    api = APIClient()
    api.force_authenticate(user)
    return api, user


@pytest.mark.django_db
class TestStrengthReportEndpoint:
    def test_requires_status_view(self, seeded_catalog, division):
        api, _ = client_for("no-view", "OPERATOR_X", ["status.manage"])
        response = api.get(REPORT_URL)
        # Гейт права, а не пустой отчёт: форма отказа — DRF-detail.
        assert response.status_code == 403
        assert response.data["detail"] == "PERMISSION_DENIED"

    def test_anonymous_403(self, seeded_catalog, division):
        assert APIClient().get(REPORT_URL).status_code == 403

    def test_returns_rows_and_totals(self, seeded_catalog, division):
        api, _ = client_for("viewer", "VIEWER", ["status.view"])
        employee = make_employee(division)
        empty_slot(division)
        live_status(employee, "DUTY")
        with clock.override(TODAY):
            response = api.get(REPORT_URL)
        assert response.status_code == 200
        assert response.data["business_date"] == TODAY
        assert response.data["columns"][0] == "SICK"
        row = response.data["rows"][0]
        assert row["division_id"] == division.id
        assert (row["staff_total"], row["list_total"], row["vacancies"]) == (2, 1, 1)
        assert row["columns"]["ON_DUTY"] == 1
        assert response.data["totals"]["staff_total"] == 2

    def test_column_labels_come_from_the_document_owner(
        self, seeded_catalog, division
    ):
        """Подписи колонок — из владельца шапки расхода, не из своего словаря.

        Экран аналитики службы печатает статусы словами; свой словарь на
        клиенте разошёлся бы с выгрузками, а сличают их как раз тогда, когда
        что-то пошло не так.
        """
        from organization_management.apps.operations.expense_layout import (
            COLUMN_LABELS,
        )

        api, _ = client_for("viewer-labels", "VIEWER", ["status.view"])
        make_employee(division)
        with clock.override(TODAY):
            response = api.get(REPORT_URL)

        labels = response.data["column_labels"]
        # Подпись есть у КАЖДОЙ отданной колонки: колонка без подписи молча
        # исчезла бы из легенды доната.
        assert set(labels) == set(response.data["columns"])
        assert labels["ON_DUTY"] == COLUMN_LABELS["ON_DUTY"]
        assert labels["IN_SERVICE"] == COLUMN_LABELS["IN_SERVICE"]

    def test_an_unknown_column_is_labelled_by_its_own_code(
        self, seeded_catalog, division
    ):
        """Справочник статусов открыт: колонка без подписи — норма.

        Пустая подпись скрыла бы от читателя, что колонка вообще есть, —
        поэтому незнакомый код печатается сам собой (правило владельца).
        """
        StatusType.objects.create(
            code="SPACE_WATCH",
            name="Наблюдение за небом",
            priority=5,
            report_column_code="SPACE_WATCH",
            counts_in_staff=True,
        )
        api, _ = client_for("viewer-unknown", "VIEWER", ["status.view"])
        make_employee(division)
        with clock.override(TODAY):
            response = api.get(REPORT_URL)

        assert "SPACE_WATCH" in response.data["columns"]
        assert response.data["column_labels"]["SPACE_WATCH"] == "SPACE_WATCH"

    def test_business_date_param_is_honoured(self, seeded_catalog, division):
        api, _ = client_for("viewer-date", "VIEWER", ["status.view"])
        employee = make_employee(division)
        target = TODAY + timedelta(days=6)
        live_status(
            employee, "VACATION", start=target, end=target + timedelta(days=2)
        )
        with clock.override(TODAY):
            today_response = api.get(REPORT_URL)
            future = api.get(REPORT_URL, {"business_date": target.isoformat()})
        assert today_response.data["totals"]["columns"]["VACATION"] == 0
        assert future.data["totals"]["columns"]["VACATION"] == 1

    def test_bad_date_is_400(self, seeded_catalog, division):
        api, _ = client_for("viewer-bad", "VIEWER", ["status.view"])
        assert api.get(REPORT_URL, {"business_date": "вчера"}).status_code == 400

    def test_bad_division_id_is_400(self, seeded_catalog, division):
        api, _ = client_for("viewer-baddiv", "VIEWER", ["status.view"])
        assert api.get(REPORT_URL, {"division_id": "abc"}).status_code == 400

    def test_scoped_actor_sees_only_own_subtree(self, seeded_catalog, division):
        other = Division.objects.create(name="Управление 2")
        make_employee(division)
        make_employee(other)
        api, _ = client_for(
            "scoped", "DIVISION_OPERATOR", ["status.view"],
            scope_division_id=division.id,
        )
        with clock.override(TODAY):
            response = api.get(REPORT_URL)
        # Без division_id область всё равно сужает выборку.
        assert [r["division_id"] for r in response.data["rows"]] == [division.id]

    def test_foreign_division_is_403_not_empty(self, seeded_catalog, division):
        other = Division.objects.create(name="Управление 2")
        make_employee(other)
        api, _ = client_for(
            "scoped-403", "DIVISION_OPERATOR", ["status.view"],
            scope_division_id=division.id,
        )
        with clock.override(TODAY):
            response = api.get(REPORT_URL, {"division_id": other.id})
        # Пустой отчёт неотличим от «там никого нет» и прятал бы отказ.
        assert response.status_code == 403

    def test_subtree_of_scope_is_included(self, seeded_catalog, division):
        child = Division.objects.create(name="Отдел 1", parent=division)
        make_employee(child)
        api, _ = client_for(
            "scoped-tree", "DIVISION_OPERATOR", ["status.view"],
            scope_division_id=division.id,
        )
        with clock.override(TODAY):
            response = api.get(REPORT_URL, {"division_id": division.id})
        assert [r["division_id"] for r in response.data["rows"]] == [child.id]

    def test_post_is_not_served(self, seeded_catalog, division):
        api, _ = client_for("viewer-post", "VIEWER", ["status.view"])
        assert api.post(REPORT_URL, {}, format="json").status_code == 405


# ── Проекция «+N» ────────────────────────────────────────────────────────

def second(employee, host_division, start=TODAY, end=TODAY + timedelta(days=10)):
    """Пара прикомандирования через сервис — так же, как её создаст оператор."""
    from organization_management.apps.operations.secondment_service import (
        initiate_secondment,
    )

    with clock.override(TODAY):
        return initiate_secondment(
            employee.id,
            to_division_id=host_division.id,
            date_start=start,
            date_end=end,
            actor="7",
        )


@pytest.fixture
def secondment_catalog(seeded_catalog):
    """Каталог расхода плюс тип DETACHED: пара пишет обе ноги, и без второго
    типа сервис откомандирования не прошёл бы справочник."""
    StatusType.objects.create(
        code="DETACHED",
        name="DETACHED",
        priority=40,
        report_column_code="DETACHED",
        counts_in_staff=True,
    )


@pytest.mark.django_db
class TestAttachedProjection:
    def test_host_sees_plus_n_and_home_keeps_the_person(
        self, secondment_catalog, division
    ):
        host = Division.objects.create(name="Управление 2")
        make_employee(host)  # у принимающего есть свой штат
        employee = make_employee(division)
        second(employee, host)

        result = StrengthReportService.compute(TODAY)
        rows = {row.division_id: row for row in result.rows}
        # Принимающий: «+N» сверх своего штата, знаменатель не тронут.
        assert rows[host.id].attached == 1
        assert (rows[host.id].staff_total, rows[host.id].list_total) == (1, 1)
        # Штатное: человек остался ПО СПИСКУ, но в колонке «откомандирован».
        assert rows[division.id].attached == 0
        assert rows[division.id].list_total == 1
        assert rows[division.id].columns["DETACHED"] == 1
        assert result.totals.attached == 1

    def test_attached_follows_the_leg_not_the_confirmation(
        self, secondment_catalog, division
    ):
        # Счёт идёт по ЖИВОЙ ноге: подтверждённый возврат закрывает её
        # завтрашним днём, поэтому сегодня человек ещё «+N», а завтра уже нет.
        from organization_management.apps.operations.secondment_service import (
            confirm_return,
            request_return,
        )

        host = Division.objects.create(name="Управление 2")
        employee = make_employee(division)
        secondment = second(employee, host)
        with clock.override(TODAY):
            request_return(secondment, actor="7")
            confirm_return(secondment, actor="8")

        today_rows = {
            row.division_id: row for row in StrengthReportService.compute(TODAY).rows
        }
        tomorrow_rows = {
            row.division_id: row
            for row in StrengthReportService.compute(TODAY + timedelta(days=1)).rows
        }
        assert today_rows[host.id].attached == 1
        # Своих слотов у принимающего нет: без «+N» строки не будет вовсе.
        assert host.id not in tomorrow_rows

    def test_not_started_pair_is_not_counted_yet(self, secondment_catalog, division):
        host = Division.objects.create(name="Управление 2")
        employee = make_employee(division)
        second(
            employee,
            host,
            start=TODAY + timedelta(days=3),
            end=TODAY + timedelta(days=5),
        )
        rows = {row.division_id: row for row in StrengthReportService.compute(TODAY).rows}
        assert host.id not in rows
        # Внутри интервала — считается: отсутствие выше это дата, а не поломка.
        later = {
            row.division_id: row
            for row in StrengthReportService.compute(TODAY + timedelta(days=3)).rows
        }
        assert later[host.id].attached == 1

    def test_cancelled_leg_is_not_counted(self, secondment_catalog, division):
        host = Division.objects.create(name="Управление 2")
        employee = make_employee(division)
        secondment = second(employee, host)
        before = {
            row.division_id: row for row in StrengthReportService.compute(TODAY).rows
        }
        assert before[host.id].attached == 1

        OpsEmployeeStatus.objects.filter(pk=secondment.in_status_id).update(
            cancelled_at=clock.Clock.now()
        )
        after = {
            row.division_id: row for row in StrengthReportService.compute(TODAY).rows
        }
        # Отменённая нога — «записи нет»: строки принимающего не остаётся.
        assert host.id not in after

    def test_scope_hides_foreign_attached(self, secondment_catalog, division):
        # Расход ОДНОГО подразделения не показывает приданных соседа.
        host = Division.objects.create(name="Управление 2")
        employee = make_employee(division)
        second(employee, host)
        result = StrengthReportService.compute(TODAY, division_ids={division.id})
        assert [row.division_id for row in result.rows] == [division.id]
        assert result.totals.attached == 0
        # Тому же принимающему его «+N» виден.
        host_result = StrengthReportService.compute(TODAY, division_ids={host.id})
        assert host_result.totals.attached == 1

    def test_query_count_stays_constant_with_attached(
        self, secondment_catalog, division
    ):
        host = Division.objects.create(name="Управление 2")
        for _ in range(3):
            second(make_employee(division), host)
        with CaptureQueriesContext(connection) as few:
            StrengthReportService.compute(TODAY)
        for _ in range(20):
            second(make_employee(division), host)
        with CaptureQueriesContext(connection) as many:
            StrengthReportService.compute(TODAY)
        assert len(few) == len(many), (
            f"N+1 на приданных: 3 пары — {len(few)} запросов, 23 — {len(many)}"
        )
        assert len(many) <= 7


@pytest.mark.django_db
class TestAttachedInEndpoint:
    def test_response_carries_attached_and_off_list(
        self, secondment_catalog, division
    ):
        api, _ = client_for("viewer-attached", "VIEWER", ["status.view"])
        host = Division.objects.create(name="Управление 2")
        make_employee(host)
        second(make_employee(division), host)
        with clock.override(TODAY):
            response = api.get(REPORT_URL)
        assert response.status_code == 200
        rows = {row["division_id"]: row for row in response.data["rows"]}
        assert rows[host.id]["attached"] == 1
        assert rows[host.id]["off_list"] == 0
        assert response.data["totals"]["attached"] == 1
        assert response.data["totals"]["off_list"] == 0
