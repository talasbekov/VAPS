"""Срез I: служебные отчёты (§22.18-22.28).

Контрактные свойства:
- работа PENDING → PROCESSING → COMPLETED продвигается на чтении; артефакт
  формируется РОВНО на переходе и больше не меняется (§22.22);
- server-side masking (§22.24): обычный экспорт не имеет sensitive-колонок
  ВООБЩЕ — отсутствующие колонки, а не пустые ячейки;
- sensitive-работа невидима без права (§22.25): список, карточка и повтор
  отвечают «не найдено», а не «нет прав»;
- параметры чужого запуска ВЫРЕЗАНЫ из ответа (§22.26), и скачивание чужого
  файла закрыто тем же правом — период написан в первой строке файла;
- ревизия считается по СЕРИИ (тип+период+режим), retry переиспользует
  пригодный артефакт, new-revision собирает заново всегда (§22.25);
- скачивание повторно проверяет право, sensitive, владельца и срок (§22.23).
"""
import datetime as dt
import importlib
import json
import threading

import pytest
from django.apps import apps as django_apps
from django.db import connection, connections, transaction
from django.core.management import call_command
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import (
    Employee,
    EmployeeTransferHistory,
)
from organization_management.apps.ops import reports
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_report import (
    OpsServiceReportArtifact,
    OpsServiceReportJob,
)
from organization_management.apps.operations.models import RolePermission, UserRole
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TYPES = "/api/ops/service-report-types/"
JOBS = "/api/ops/service-report-jobs/"


def job_path(code):
    return f"{JOBS}{code}/"


def download_path(code):
    return f"/api/ops/service-report-artifacts/{code}/download/"


@pytest.fixture
def registries(db):
    call_command("seed_operations", verbosity=0)


@pytest.fixture
def generator(registries):
    api, user = client_for(
        "report-generator", "REPORT_GEN", perms=("report.generate",),
    )
    return api, str(user.pk)


@pytest.fixture
def sensitive_api(registries):
    api, _ = client_for(
        "report-sensitive", "REPORT_SENS",
        perms=("report.generate", "report.export_sensitive"),
    )
    return api


def _shift(employee_name, days_ago, *, employee_id=None, note=None, override=None):
    return OpsDutyShift.objects.create(
        business_date=Clock.today_local() - dt.timedelta(days=days_ago),
        duty_type_code="DAY_OBJECT",
        target={"targetType": "PROTECTED_OBJECT", "objectId": None,
                "safeLabel": "Резиденция"},
        employee_name=employee_name,
        employee_id=str(employee_id) if employee_id is not None else None,
        state_code="COMPLETED",
        acknowledged_at=None,
        actual_start=None,
        actual_end=None,
        passport_binding={"sectorName": "A", "postName": "Пост 1"},
        note=note,
        cancellation=None,
        override_reason=override,
    )


@pytest.fixture
def shifts(registries):
    _shift("Абенов С.", 1, note="Личное примечание про человека")
    _shift("Беков Т.", 2, override="Обоснование обхода отдыха")
    _shift("Вне периода", 400)


def _create_body(**overrides):
    body = {
        "reportTypeCode": "PERSONNEL_EXPENSE",
        "format": "CSV",
        "from": (Clock.today_local() - dt.timedelta(days=7)).isoformat(),
        "to": Clock.today_local().isoformat(),
        "sensitive": False,
        "idempotencyKey": "report-key-1",
    }
    body.update(overrides)
    return body


def _run_to_completion(api, job_code):
    """Две ступени чтения: PENDING → PROCESSING → COMPLETED."""
    api.get(JOBS)
    return api.get(job_path(job_code)).json()


def _create_report_in_thread(user_id, body, results, index):
    """Отдельное соединение, как два одновременных HTTP-клика в Postgres."""
    try:
        from django.contrib.auth import get_user_model

        api = APIClient()
        api.force_authenticate(get_user_model().objects.get(pk=user_id))
        response = api.post(JOBS, body, format="json")
        results[index] = (response.status_code, response.json())
    except Exception as error:  # noqa: BLE001 — гонка не должна скрыть 500
        results[index] = ("EXC", error)
    finally:
        connections.close_all()


def _advance_report_in_thread(job_code, results, index, ready=None):
    """Собирает отдельную job отдельным PostgreSQL-соединением."""
    try:
        with transaction.atomic():
            job = OpsServiceReportJob.objects.get(job_code=job_code)
            if ready is not None:
                ready.wait()
            reports._advance(job)
        results[index] = "OK"
    except Exception as error:  # noqa: BLE001 — конкурентный сбой не скрывать
        results[index] = error
    finally:
        connections.close_all()


# ── Каталог типов ───────────────────────────────────────────────────────────


def test_types_carry_limits_and_masking_policy(generator):
    api, _ = generator
    data = api.get(TYPES).json()
    row = data["results"][0]
    assert row["reportTypeCode"] == "PERSONNEL_EXPENSE"
    # Предел приезжает из политики REPORT_LIMITS, не из определения типа.
    assert row["maxPeriodDays"] == 92
    assert row["unavailableReason"] is None
    assert data["retentionPolicy"]["policyVersion"] == "report-limits-v1"
    assert {f["code"] for f in data["maskedFields"]} == {
        "NOTE", "OVERRIDE_REASON",
    }
    assert data["canExportSensitive"] is False


def test_types_refuse_without_period_limit(generator):
    api, _ = generator
    OpsPolicySectionVersion.objects.filter(
        section_code="REPORT_LIMITS"
    ).delete()
    row = api.get(TYPES).json()["results"][0]
    assert row["maxPeriodDays"] is None
    assert "не задан политикой" in row["unavailableReason"]
    refused = api.post(JOBS, _create_body(), format="json")
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "PERIOD_LIMIT_UNAVAILABLE"


# ── Создание и жизненный цикл (§22.21-22.22) ────────────────────────────────


def test_job_lifecycle_builds_immutable_artifact(generator, shifts):
    api, actor = generator
    created = api.post(JOBS, _create_body(), format="json").json()
    assert created["state"] == "PENDING"
    assert created["artifactId"] is None
    detail = _run_to_completion(api, created["reportJobId"])
    job = detail["job"]
    assert job["state"] == "COMPLETED"
    assert job["progressPercent"] == 100
    artifact = detail["artifact"]
    assert artifact["revision"] == 1
    assert artifact["available"] is True
    assert artifact["calculationVersion"] == "expense-2026.07.1"
    # Метаданные без содержимого: файл едет только операцией скачивания.
    assert "content" not in artifact
    download = api.post(download_path(artifact["artifactId"]))
    content = download.json()["content"]
    assert content.startswith("# Расход личного состава за период")
    assert "Абенов С." in content
    # §22.24: обычный экспорт не имеет sensitive-колонок и значений ВООБЩЕ.
    assert "Примечание" not in content
    assert "Личное примечание" not in content
    assert "Обоснование обхода" not in content
    # Вне периода строка не попала (границы включительные, но 400 дн. назад).
    assert "Вне периода" not in content
    # Повторное чтение завершённой работы не пересобирает артефакт.
    api.get(job_path(created["reportJobId"]))
    assert OpsServiceReportArtifact.objects.count() == 1


def test_create_idempotent_and_validated(generator, shifts):
    api, _ = generator
    first = api.post(JOBS, _create_body(), format="json").json()
    repeat = api.post(JOBS, _create_body(), format="json").json()
    assert repeat["reportJobId"] == first["reportJobId"]
    assert OpsServiceReportJob.objects.count() == 1
    bad = api.post(JOBS, _create_body(**{"from": "2026-99-01"}),
                   format="json")
    assert bad.json()["error_code"] == "INVALID_PERIOD"
    long = api.post(
        JOBS,
        _create_body(**{
            "from": "2025-01-01", "to": "2026-01-01",
            "idempotencyKey": "report-key-2",
        }),
        format="json",
    )
    assert long.json()["error_code"] == "PERIOD_TOO_LONG"
    unknown = api.post(
        JOBS,
        _create_body(reportTypeCode="NOPE", idempotencyKey="report-key-3"),
        format="json",
    )
    assert unknown.json()["error_code"] == "UNKNOWN_REPORT_TYPE"
    xlsx = api.post(
        JOBS, _create_body(format="XLSX", idempotencyKey="report-key-4"),
        format="json",
    )
    assert xlsx.json()["error_code"] == "UNSUPPORTED_FORMAT"
    no_key = api.post(
        JOBS, _create_body(idempotencyKey="  "), format="json",
    )
    assert no_key.json()["error_code"] == "IDEMPOTENCY_KEY_REQUIRED"


def test_sensitive_requires_permission_before_period_check(generator):
    api, _ = generator
    # Порядок причин: sensitive-право проверяется ДО валидации периода.
    refused = api.post(
        JOBS,
        _create_body(sensitive=True, **{"from": "2026-99-01"}),
        format="json",
    )
    assert refused.status_code == 403


def test_sensitive_export_carries_masked_columns(sensitive_api, shifts):
    created = sensitive_api.post(
        JOBS, _create_body(sensitive=True), format="json",
    ).json()
    detail = _run_to_completion(sensitive_api, created["reportJobId"])
    download = sensitive_api.post(
        download_path(detail["artifact"]["artifactId"])
    )
    content = download.json()["content"]
    assert "Примечание;Обоснование обхода" in content
    assert "Личное примечание про человека" in content
    assert "Обоснование обхода отдыха" in content


# ── Видимость и права (§22.25-22.26) ────────────────────────────────────────


def test_sensitive_job_invisible_without_right(
    generator, sensitive_api, shifts,
):
    api, _ = generator
    created = sensitive_api.post(
        JOBS, _create_body(sensitive=True), format="json",
    ).json()
    listing = api.get(JOBS).json()
    # Работа со скрытыми полями невидима: её параметры сами по себе говорят,
    # кого выгружали.
    assert listing["results"] == []
    assert listing["totalVisible"] == 0
    hidden = api.get(job_path(created["reportJobId"]))
    assert hidden.status_code == 404


def test_foreign_parameters_redacted_and_download_refused(
    generator, sensitive_api, shifts,
):
    api, _ = generator
    # Чужой (не sensitive) запуск от другого пользователя.
    foreign = sensitive_api.post(JOBS, _create_body(), format="json").json()
    detail = _run_to_completion(sensitive_api, foreign["reportJobId"])
    artifact_id = detail["artifact"]["artifactId"]

    listing = api.get(JOBS).json()
    row = listing["results"][0]
    assert row["parameters"] is None
    assert row["idempotencyKey"] is None
    assert "отдельное право" in row["parametersRedactedReason"]
    # Период не приходит НИГДЕ в ответе списка.
    payload = json.dumps(listing, ensure_ascii=False)
    assert _create_body()["from"] not in payload
    # Скачивание чужого файла закрыто тем же правом: период написан в первой
    # строке файла.
    refused = api.post(download_path(artifact_id))
    assert refused.status_code == 403
    # Действие в списке тоже закрыто с причиной.
    actions = {
        a["code"]: a for a in listing["actions"][0]["actions"]
    }
    assert actions["DOWNLOAD"]["available"] is False
    assert actions["OPEN_PARAMETERS"]["available"] is False
    # Действия меняют ряд параметров и потому закрыты тем же серверным
    # правилом, что и скачивание. Один видимый state не даёт права повторить
    # чужой запуск.
    assert actions["RETRY"]["available"] is False
    assert actions["NEW_REVISION"]["available"] is False
    assert api.post(job_path(foreign["reportJobId"]) + "retry/").status_code == 403
    assert api.post(
        job_path(foreign["reportJobId"]) + "new-revision/"
    ).status_code == 403


def test_orphan_artifact_keeps_foreign_parameter_download_gate(
    generator, sensitive_api, shifts,
):
    """Удаление job не должно превратить файл в публичный для коллеги."""
    api, _ = generator
    foreign = sensitive_api.post(JOBS, _create_body(), format="json").json()
    detail = _run_to_completion(sensitive_api, foreign["reportJobId"])
    artifact_id = detail["artifact"]["artifactId"]
    OpsServiceReportJob.objects.filter(
        job_code=foreign["reportJobId"]
    ).delete()

    refused = api.post(download_path(artifact_id))
    assert refused.status_code == 403
    assert refused.json()["error_code"] == "PERMISSION_DENIED"


def test_own_parameters_always_visible(generator, shifts):
    api, _ = generator
    api.post(JOBS, _create_body(), format="json")
    row = api.get(JOBS).json()["results"][0]
    assert row["parameters"] is not None
    assert row["parametersRedactedReason"] is None


# ── Область отчёта (§22.20, Plane №1125) ──────────────────────────────────


@pytest.fixture
def scoped_report_actors(registries):
    """Два департамента с дочерними управлениями и отдельными держателями
    report.generate. У каждого один и тот же код права, различается только
    область гранта — это не позволяет подменить проверку отсутствием права.
    """
    first_department = Division.objects.create(
        name="Первый департамент отчёта",
        division_type=Division.DivisionType.DEPARTMENT,
    )
    second_department = Division.objects.create(
        name="Второй департамент отчёта",
        division_type=Division.DivisionType.DEPARTMENT,
    )
    first_unit = Division.objects.create(
        name="Первое управление отчёта",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=first_department,
    )
    second_unit = Division.objects.create(
        name="Второе управление отчёта",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=second_department,
    )
    own = Employee.objects.create(
        first_name="Свой", last_name="Отчёт", personnel_number="SR-OWN",
        iin="910000000001",
    )
    foreign = Employee.objects.create(
        first_name="Чужой", last_name="Отчёт", personnel_number="SR-FOREIGN",
        iin="910000000002",
    )
    StaffUnit.objects.create(division=first_unit, employee=own, index=1)
    StaffUnit.objects.create(division=second_unit, employee=foreign, index=1)
    own_api, _ = client_for(
        "report-department-one", "REPORT_DEPARTMENT_ONE",
        perms=("report.generate",), scope_division_id=first_department.id,
    )
    foreign_api, _ = client_for(
        "report-department-two", "REPORT_DEPARTMENT_TWO",
        perms=("report.generate", "report.view_foreign_parameters"),
        scope_division_id=second_department.id,
    )
    _shift("Свой Отчёт", 1, employee_id=own.id)
    _shift("Чужой Отчёт", 1, employee_id=foreign.id)
    return own_api, foreign_api


def test_scoped_report_contains_only_descendants_of_grant(scoped_report_actors):
    own_api, _ = scoped_report_actors

    created = own_api.post(
        JOBS, _create_body(idempotencyKey="scoped-department-report"),
        format="json",
    ).json()
    detail = _run_to_completion(own_api, created["reportJobId"])
    content = own_api.post(
        download_path(detail["artifact"]["artifactId"])
    ).json()["content"]

    assert "Свой Отчёт" in content
    assert "Чужой Отчёт" not in content


def test_scoped_csv_uses_employee_division_on_shift_business_date(
    scoped_report_actors,
):
    """Будущий перевод не переносит прошлую смену в чужой отчёт."""
    own_api, foreign_api = scoped_report_actors
    first_unit = Division.objects.get(name="Первое управление отчёта")
    second_unit = Division.objects.get(name="Второе управление отчёта")
    employee = Employee.objects.get(personnel_number="SR-OWN")
    _shift("Переведённый после смены", 1, employee_id=employee.id)

    StaffUnit.objects.filter(employee=employee).update(division=second_unit)
    EmployeeTransferHistory.objects.create(
        employee=employee,
        from_division=first_unit,
        to_division=second_unit,
        transfer_date=Clock.today_local(),
    )

    own_job = own_api.post(
        JOBS, _create_body(idempotencyKey="historic-shift-first"), format="json",
    ).json()
    own_content = own_api.post(download_path(
        _run_to_completion(own_api, own_job["reportJobId"])["artifact"]["artifactId"]
    )).json()["content"]
    foreign_job = foreign_api.post(
        JOBS, _create_body(idempotencyKey="historic-shift-second"), format="json",
    ).json()
    foreign_content = foreign_api.post(download_path(
        _run_to_completion(
            foreign_api, foreign_job["reportJobId"]
        )["artifact"]["artifactId"]
    )).json()["content"]

    assert "Переведённый после смены" in own_content
    assert "Переведённый после смены" not in foreign_content


def test_scoped_csv_unwinds_nested_temporary_transfers(
    scoped_report_actors,
):
    """После двух завершённых временных переводов смена снова относится к A."""
    own_api, foreign_api = scoped_report_actors
    first_unit = Division.objects.get(name="Первое управление отчёта")
    second_unit = Division.objects.get(name="Второе управление отчёта")
    third_unit = Division.objects.create(
        name="Третье управление отчёта",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=second_unit.parent,
    )
    employee = Employee.objects.get(personnel_number="SR-OWN")
    _shift("Вернувшийся после вложенных переводов", 1, employee_id=employee.id)
    today = Clock.today_local()
    EmployeeTransferHistory.objects.create(
        employee=employee,
        from_division=first_unit,
        to_division=second_unit,
        transfer_date=today - dt.timedelta(days=7),
        is_temporary=True,
        end_date=today - dt.timedelta(days=3),
    )
    EmployeeTransferHistory.objects.create(
        employee=employee,
        from_division=second_unit,
        to_division=third_unit,
        transfer_date=today - dt.timedelta(days=6),
        is_temporary=True,
        end_date=today - dt.timedelta(days=4),
    )

    own_job = own_api.post(
        JOBS, _create_body(idempotencyKey="nested-transfer-first"), format="json",
    ).json()
    own_content = own_api.post(download_path(
        _run_to_completion(own_api, own_job["reportJobId"])["artifact"]["artifactId"]
    )).json()["content"]
    foreign_job = foreign_api.post(
        JOBS, _create_body(idempotencyKey="nested-transfer-second"), format="json",
    ).json()
    foreign_content = foreign_api.post(download_path(
        _run_to_completion(
            foreign_api, foreign_job["reportJobId"]
        )["artifact"]["artifactId"]
    )).json()["content"]

    assert "Вернувшийся после вложенных переводов" in own_content
    assert "Вернувшийся после вложенных переводов" not in foreign_content


def test_scoped_report_is_not_addressable_from_another_department(
    scoped_report_actors,
):
    own_api, foreign_api = scoped_report_actors
    created = own_api.post(
        JOBS, _create_body(idempotencyKey="scoped-addressability"),
        format="json",
    ).json()
    detail = _run_to_completion(own_api, created["reportJobId"])
    artifact_id = detail["artifact"]["artifactId"]

    assert foreign_api.get(JOBS).json()["results"] == []
    assert foreign_api.get(job_path(created["reportJobId"])).status_code == 404
    assert foreign_api.post(download_path(artifact_id)).status_code == 404


def test_same_idempotency_key_is_independent_for_each_report_actor(
    scoped_report_actors,
):
    own_api, foreign_api = scoped_report_actors
    body = _create_body(idempotencyKey="same-key-in-two-departments")

    own = own_api.post(JOBS, body, format="json")
    foreign = foreign_api.post(JOBS, body, format="json")

    assert own.status_code == 200
    assert foreign.status_code == 200
    assert own.json()["reportJobId"] != foreign.json()["reportJobId"]
    assert OpsServiceReportJob.objects.filter(
        idempotency_key=body["idempotencyKey"]
    ).count() == 2


def test_report_scope_snapshot_does_not_follow_later_grant_change(
    scoped_report_actors,
):
    own_api, _ = scoped_report_actors
    body = _create_body(idempotencyKey="scoped-grant-change")
    created = own_api.post(JOBS, body, format="json").json()
    job = OpsServiceReportJob.objects.get(job_code=created["reportJobId"])
    second_department = Division.objects.get(name="Второй департамент отчёта")

    UserRole.objects.filter(user_id=job.created_by_user_id).update(
        scope_division_id=second_department.id,
    )

    # Готовящийся job остался снимком первого департамента: новый grant не
    # переинтерпретирует ни его данные, ни возможность открыть карточку или
    # получить её повторной отправкой того же idempotency key.
    assert own_api.get(job_path(job.job_code)).status_code == 404
    assert own_api.post(JOBS, body, format="json").status_code == 404


def test_0117_reverse_keeps_preexisting_manual_role_permission(registries):
    """У RolePermission нет provenance, поэтому rollback 0117 не вправе
    угадывать, что единственная строка создана именно этой миграцией.
    """
    assert RolePermission.objects.filter(
        role_code_id="HEAD_DEPARTMENT_LINE",
        permission_code_id="report.generate",
    ).exists()

    migration = importlib.import_module(
        "organization_management.apps.operations.migrations."
        "0117_head_department_service_reports"
    )
    migration._revoke(django_apps, None)

    assert RolePermission.objects.filter(
        role_code_id="HEAD_DEPARTMENT_LINE",
        permission_code_id="report.generate",
    ).exists()


def test_0119_keeps_preexisting_report_generate_grants(registries):
    """Убирается только глобальная добавка OM_CATEGORY_ORG."""
    client_for(
        "report-unapproved", "REPORT_UNAPPROVED",
        perms=("report.generate",),
    )
    migration = importlib.import_module(
        "organization_management.apps.operations.migrations."
        "0119_report_generate_head_department_only"
    )

    migration._revoke_global_om_category(django_apps, None)

    holders = set(RolePermission.objects.filter(
        permission_code_id="report.generate"
    ).values_list("role_code_id", flat=True))
    assert {
        "DEPARTMENT_EXPENSE_OFFICER", "DUTY_OFFICER", "ANALYST",
        "HEAD_OPS_UNIT", "EMPLOYEE_OPS_D2",
        "HEAD_DEPARTMENT_LINE", "REPORT_UNAPPROVED",
    } <= holders
    assert "OM_CATEGORY_ORG" not in holders


def test_0120_is_explicitly_irreversible():
    migration = importlib.import_module(
        "organization_management.apps.operations.migrations."
        "0120_report_job_idempotency_per_actor"
    )
    assert migration.Migration.operations[-1].reversible is False


@pytest.mark.django_db(transaction=True)
def test_concurrent_same_actor_key_returns_one_job(generator, monkeypatch):
    """Обе HTTP-транзакции проходят lookup до INSERT и ловят unique-гонку."""
    _, actor = generator
    assert connection.vendor == "postgresql"
    barrier = threading.Barrier(2, timeout=20)
    original_create = OpsServiceReportJob.objects.create

    def create_simultaneously(*args, **kwargs):
        barrier.wait()
        return original_create(*args, **kwargs)

    monkeypatch.setattr(
        OpsServiceReportJob.objects, "create", create_simultaneously
    )
    body = _create_body(idempotencyKey="concurrent-same-actor-key")
    results = [None, None]
    threads = [
        threading.Thread(
            target=_create_report_in_thread,
            args=(int(actor), body, results, index),
        )
        for index in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not thread.is_alive() for thread in threads), results

    assert [status for status, _ in results] == [200, 200], results
    assert results[0][1]["reportJobId"] == results[1][1]["reportJobId"]
    assert OpsServiceReportJob.objects.filter(
        created_by_user_id=actor, idempotency_key=body["idempotencyKey"]
    ).count() == 1


@pytest.mark.django_db(transaction=True)
def test_idempotency_race_rechecks_scope_after_integrity_error(
    scoped_report_actors, monkeypatch,
):
    """Проигравший unique-гонку не получает job после отзыва его области."""
    own_api, _ = scoped_report_actors
    actor = UserRole.objects.get(
        role_code_id="REPORT_DEPARTMENT_ONE"
    ).user_id
    second_department = Division.objects.get(name="Второй департамент отчёта")
    create_barrier = threading.Barrier(2, timeout=20)
    original_create = OpsServiceReportJob.objects.create
    original_scope_snapshot = reports.scope_snapshot_for
    snapshot_lock = threading.Lock()
    snapshot_calls = 0
    scope_rechecked = threading.Event()

    def create_simultaneously(*args, **kwargs):
        create_barrier.wait()
        return original_create(*args, **kwargs)

    def move_scope_before_recheck(user_id):
        nonlocal snapshot_calls
        with snapshot_lock:
            snapshot_calls += 1
            move_now = snapshot_calls == 3
        # Первые два снимка взяты двумя конкурирующими POST до INSERT. Третий
        # возможен только в обработчике IntegrityError — именно между ними
        # эмулируем перевод grant в соседний департамент.
        if move_now:
            UserRole.objects.filter(user_id=actor).update(
                scope_division_id=second_department.id
            )
            scope_rechecked.set()
        return original_scope_snapshot(user_id)

    monkeypatch.setattr(
        OpsServiceReportJob.objects, "create", create_simultaneously
    )
    monkeypatch.setattr(
        reports, "scope_snapshot_for", move_scope_before_recheck
    )
    body = _create_body(idempotencyKey="scope-changed-during-idempotency-race")
    results = [None, None]
    threads = [
        threading.Thread(
            target=_create_report_in_thread,
            args=(int(actor), body, results, index),
        )
        for index in range(2)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert all(not thread.is_alive() for thread in threads), results
    assert scope_rechecked.is_set()
    assert sorted(status for status, _ in results) == [200, 404]
    assert OpsServiceReportJob.objects.filter(
        created_by_user_id=actor, idempotency_key=body["idempotencyKey"]
    ).count() == 1


# ── Повтор и новая редакция (§22.25) ────────────────────────────────────────


def test_retry_reuses_artifact_new_revision_rebuilds(generator, shifts):
    api, _ = generator
    created = api.post(JOBS, _create_body(), format="json").json()
    _run_to_completion(api, created["reportJobId"])
    # RETRY: пригодный артефакт уже есть — новой работы не создаётся.
    retried = api.post(job_path(created["reportJobId"]) + "retry/").json()
    assert retried["reused"] is True
    assert retried["artifactId"] == f"artifact-{created['reportJobId']}"
    assert OpsServiceReportJob.objects.count() == 1
    # NEW_REVISION: собирает заново всегда; редакция по серии — 2.
    revision = api.post(
        job_path(created["reportJobId"]) + "new-revision/"
    ).json()
    assert revision["reused"] is False
    detail = _run_to_completion(api, revision["reportJobId"])
    assert detail["artifact"]["revision"] == 2
    assert OpsServiceReportArtifact.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_new_revisions_get_distinct_series_revisions(
    generator, shifts,
):
    """Две одновременно собранные редакции одной серии не получают r2 обе."""
    api, _ = generator
    source = api.post(
        JOBS, _create_body(idempotencyKey="revision-source"), format="json",
    ).json()
    _run_to_completion(api, source["reportJobId"])
    revisions = [
        api.post(job_path(source["reportJobId"]) + "new-revision/").json()
        for _ in range(2)
    ]
    revision_codes = [row["reportJobId"] for row in revisions]
    OpsServiceReportJob.objects.filter(job_code__in=revision_codes).update(
        state="PROCESSING", progress_percent=50
    )

    assert connection.vendor == "postgresql"
    ready = threading.Barrier(2, timeout=20)
    results = [None, None]
    threads = [
        threading.Thread(
            target=_advance_report_in_thread,
            args=(job_code, results, index, ready),
        )
        for index, job_code in enumerate(revision_codes)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert all(not thread.is_alive() for thread in threads), results
    assert results == ["OK", "OK"]
    assert set(OpsServiceReportArtifact.objects.filter(
        job_code__in=revision_codes
    ).values_list("revision", flat=True)) == {2, 3}


@pytest.mark.django_db(transaction=True)
def test_four_concurrent_revisions_all_get_a_unique_series_revision(
    generator, shifts,
):
    """Четвёртая конкурентная job не упирается в предел повторов."""
    api, _ = generator
    source = api.post(
        JOBS, _create_body(idempotencyKey="four-revision-source"), format="json",
    ).json()
    _run_to_completion(api, source["reportJobId"])
    revisions = [
        api.post(job_path(source["reportJobId"]) + "new-revision/").json()
        for _ in range(4)
    ]
    revision_codes = [row["reportJobId"] for row in revisions]
    OpsServiceReportJob.objects.filter(job_code__in=revision_codes).update(
        state="PROCESSING", progress_percent=50
    )

    assert connection.vendor == "postgresql"
    ready = threading.Barrier(4, timeout=20)
    results = [None] * 4
    threads = [
        threading.Thread(
            target=_advance_report_in_thread,
            args=(job_code, results, index, ready),
        )
        for index, job_code in enumerate(revision_codes)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert all(not thread.is_alive() for thread in threads), results
    assert results == ["OK"] * 4
    assert set(OpsServiceReportArtifact.objects.filter(
        job_code__in=revision_codes
    ).values_list("revision", flat=True)) == {2, 3, 4, 5}


def test_new_revision_requires_completed_job(generator, shifts):
    api, _ = generator
    created = api.post(JOBS, _create_body(), format="json").json()
    # Работа ещё PENDING: редакции нет, повтору не с чего.
    refused = api.post(
        job_path(created["reportJobId"]) + "new-revision/"
    )
    assert refused.json()["error_code"] == "NO_BASE_REVISION"
    running = api.post(job_path(created["reportJobId"]) + "retry/")
    assert running.json()["error_code"] == "JOB_NOT_FINISHED"


# ── Срок хранения (§22.22-22.23) ────────────────────────────────────────────


def test_expired_artifact_refuses_download(generator, shifts):
    api, _ = generator
    created = api.post(JOBS, _create_body(), format="json").json()
    detail = _run_to_completion(api, created["reportJobId"])
    artifact_id = detail["artifact"]["artifactId"]
    OpsServiceReportArtifact.objects.filter(
        artifact_code=artifact_id
    ).update(expires_at=Clock.now() - dt.timedelta(days=1))
    listing = api.get(JOBS).json()
    summary = listing["artifacts"][0]
    assert summary["available"] is False
    assert summary["unavailableReason"] == "EXPIRED"
    refused = api.post(download_path(artifact_id))
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "ARTIFACT_EXPIRED"
    # Действие в реестре называет причину, а не молчит.
    actions = {a["code"]: a for a in listing["actions"][0]["actions"]}
    assert actions["DOWNLOAD"]["available"] is False
    assert "истёк" in actions["DOWNLOAD"]["reason"]


def test_retention_failure_is_job_state_not_exception(generator, shifts):
    api, _ = generator
    created = api.post(JOBS, _create_body(), format="json").json()
    api.get(JOBS)  # PENDING → PROCESSING
    OpsPolicySectionVersion.objects.filter(
        section_code="REPORT_LIMITS"
    ).delete()
    detail = api.get(job_path(created["reportJobId"])).json()
    job = detail["job"]
    assert job["state"] == "FAILED"
    assert job["failureCode"] == "RETENTION_UNAVAILABLE"
    actions = {a["code"]: a for a in detail["actions"]}
    assert actions["VIEW_ERROR"]["available"] is True
    assert actions["NEW_REVISION"]["available"] is False


def test_reports_require_generate_permission(registries):
    api, _ = client_for("report-none", "REPORT_NONE", perms=("status.view",))
    assert api.get(TYPES).status_code == 403
    assert api.get(JOBS).status_code == 403
