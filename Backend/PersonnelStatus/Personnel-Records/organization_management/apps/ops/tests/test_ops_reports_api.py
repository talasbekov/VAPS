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
import json

import pytest
from django.core.management import call_command

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_report import (
    OpsServiceReportArtifact,
    OpsServiceReportJob,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

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


def _shift(employee_name, days_ago, *, note=None, override=None):
    return OpsDutyShift.objects.create(
        business_date=Clock.today_local() - dt.timedelta(days=days_ago),
        duty_type_code="DAY_OBJECT",
        target={"targetType": "PROTECTED_OBJECT", "objectId": None,
                "safeLabel": "Резиденция"},
        employee_name=employee_name,
        employee_id=None,
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


def test_own_parameters_always_visible(generator, shifts):
    api, _ = generator
    api.post(JOBS, _create_body(), format="json")
    row = api.get(JOBS).json()["results"][0]
    assert row["parameters"] is not None
    assert row["parametersRedactedReason"] is None


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
