"""Служебные отчёты (§22.18-22.28) — серверная реализация контракта клиента
(features/service-reports): порт мок-репозитория и его чистой модели ДОСЛОВНО.

Асинхронная генерация (§22.21): работа создаётся В ОЖИДАНИИ и продвигается на
чтении (PENDING → PROCESSING → COMPLETED|FAILED); сбой сборки и отсутствие
политики удержания — СОСТОЯНИЯ работы, а не исключения наружу: одна неудачная
работа не роняет чтение всего реестра.

Server-side masking (§22.24): обычный экспорт не имеет колонок с исключёнными
полями ВООБЩЕ — не пустые ячейки, а отсутствующие колонки. Выборка строк,
маскирование и сборка выполняются здесь; экран получает готовый артефакт.

Скачивание (§22.23) — отдельная операция, ПОВТОРНО проверяющая право,
sensitive-право, владельца параметров и срок хранения; отдаётся содержимое,
а не ссылка: постоянной ссылки не существует вовсе, ей неоткуда утечь.
"""
import datetime as dt
import uuid

from django.db import transaction

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_duty import OpsDutyShift
from organization_management.apps.operations.models_report import (
    OpsServiceReportArtifact,
    OpsServiceReportJob,
    OpsServiceReportType,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
)

# §22.26: запуск отчёта — своё право, отдельное от аналитики; sensitive
# export (§20.32) и просмотр параметров чужого отчёта — свои права.
GENERATE_PERMISSION = "report.generate"
SENSITIVE_PERMISSION = "report.export_sensitive"
FOREIGN_PARAMETERS_PERMISSION = "report.view_foreign_parameters"

MASKING_POLICY_VERSION = "masking-2026.07.1"
CALCULATION_VERSION = "expense-2026.07.1"

_PROGRESS_STEP = 50

_BASE_COLUMNS = ["Дата", "Сотрудник", "Объект", "Пост", "Состояние"]
_SENSITIVE_COLUMNS = ["Примечание", "Обоснование обхода"]

NO_PERIOD_LIMIT_REASON = (
    "Предел периода для этого типа отчёта не задан политикой — отчёт не "
    "формируется. Задайте его в разделе «Настройки» → «Пределы отчётности»."
)
NO_RETENTION_REASON = (
    "Срок хранения файлов не задан политикой — отчёт не формируется: у "
    "файла не было бы срока доступности."
)
FOREIGN_PARAMETERS_REASON = (
    "Это чужой запуск: просмотр параметров чужого отчёта — отдельное право "
    "(§22.26), и его у вас нет."
)
FOREIGN_DOWNLOAD_REASON = (
    "Файл называет свой период в первой строке: скрыть параметры на экране "
    "и отдать их файлом значило бы скрыть только на вид."
)
ASSEMBLY_FAILURE_CODE = "ASSEMBLY_FAILED"
ASSEMBLY_FAILURE_MESSAGE = (
    "Не удалось собрать отчёт: источник данных недоступен. Запустите отчёт "
    "повторно; если ошибка повторится, обратитесь к администратору."
)

MASKED_FIELDS = [
    {
        "code": "NOTE",
        "label": "Примечание к дежурству",
        "reason": (
            "§22.24 «персональные комментарии»: свободный текст пишется для "
            "внутренней работы и может содержать сведения о человеке, "
            "которых отчёт не требует."
        ),
    },
    {
        "code": "OVERRIDE_REASON",
        "label": "Обоснование обхода конфликта",
        "reason": (
            "§22.24 «скрытые ограничения»: обоснование обхода обязательного "
            "отдыха — внутреннее решение, а не факт несения службы."
        ),
    },
]

UNAVAILABLE_FORMATS = [
    {
        "code": "XLSX",
        "label": "XLSX",
        "reason": (
            "Формирование книги Excel требует отдельной библиотеки и "
            "серверной генерации; кнопка без артефакта — ровно то «фальшивое "
            "действие», которое §22.23 запрещает."
        ),
    },
    {
        "code": "PDF",
        "label": "PDF",
        "reason": (
            "PDF в проекте формируется печатью браузера по печатному канону "
            "(§8.8), а не серверным артефактом — это другой механизм, и "
            "выдавать его за экспорт нельзя."
        ),
    },
    {
        "code": "DOCX",
        "label": "DOCX",
        "reason": "Генератора DOCX в проекте нет.",
    },
]

UNAVAILABLE_ARTIFACT_FIELDS = [
    {
        "code": "SCOPE_SNAPSHOT",
        "label": "Снимок scope",
        "reason": (
            "RBAC раздела плоский, без организационного scope — снимать "
            "нечего; тот же разрыв, что у раскрытия ИИН (§20.27)."
        ),
    },
    {
        "code": "SOURCE_WATERMARK",
        "label": "Водяной знак источника",
        "reason": (
            "Водяной знак наносится генератором документа; CSV его не несёт, "
            "а приписывать поле, которого нет в файле, значило бы описывать "
            "несуществующее свойство артефакта."
        ),
    },
    {
        "code": "POLICY_VERSION",
        "label": "Версия политики доступа",
        "reason": (
            "Версионируемой политики доступа в разделе нет: права — плоский "
            "список кодов. Версии РАСЧЁТА и МАСКИРОВАНИЯ при этом реальные "
            "и хранятся в артефакте."
        ),
    },
]

UNAVAILABLE_HISTORY_COLUMNS = [
    {
        "code": "SCOPE",
        "label": "Scope",
        "reason": (
            "RBAC раздела плоский, без организационного scope: у работы нет "
            "области, которую можно было бы показать в колонке. Пустая "
            "колонка «Scope» читалась бы как «область не ограничена», а это "
            "утверждение, а не факт."
        ),
    },
]

UNAVAILABLE_JOB_CARD_BLOCKS = [
    {
        "code": "SCOPE",
        "label": "Scope запуска",
        "reason": (
            "RBAC раздела плоский, без организационного scope: §22.27 "
            "требует перепроверять на маршруте и permission, и scope — "
            "перепроверяется то, что есть, право; scope перепроверять не на "
            "чем, и пустой блок «вся организация» был бы утверждением, а не "
            "фактом."
        ),
    },
    {
        "code": "ARTIFACT_ROUTE",
        "label": "Отдельный маршрут артефакта",
        "reason": (
            "§22.27 называет `/reports/artifacts/:artifactId`, но у работы "
            "ровно один артефакт, и все его метаданные показаны здесь: "
            "второй маршрут стал бы вторым владельцем одного представления, "
            "а постоянной ссылки на сам файл не существует вовсе (§22.23)."
        ),
    },
]


def has_perm(perms, code):
    return "*" in perms or code in perms


def _permission_denied(code):
    return DomainError(
        "PERMISSION_DENIED", 403, detail={"permission": code},
        message="Недостаточно прав.",
    )


def _not_found(entity_id):
    # Одно сообщение и на артефакт, и на работу: разные тексты подсказывали
    # бы, существует ли скрытая от смотрящего выгрузка.
    return DomainError(
        "ENTITY_NOT_FOUND", 404, detail={"id": str(entity_id)},
        message="Запись не найдена.",
    )


def _stamp_code(obj, field, prefix):
    setattr(obj, field, f"{prefix}-{obj.pk}")
    obj.save(update_fields=[field, "updated_at"])
    return getattr(obj, field)


# ── Пределы из «Настроек» (REPORT_LIMITS) ───────────────────────────────────


def read_report_limits():
    """Отсутствие раздела даёт ПУСТУЮ карту и None, а не значения по
    умолчанию: подставить «привычные» 90 дней значило бы вернуть тот самый
    хардкод, ради переноса которого политика и заведена."""
    version_row = OpsPolicySectionVersion.objects.filter(
        section_code="REPORT_LIMITS"
    ).first()
    if version_row is None or not version_row.version:
        return {
            "maxPeriodDaysByType": {}, "retentionDays": None,
            "policyVersion": None,
        }
    max_by_type = {}
    retention = None
    prefix = "LIMITS.REPORT_PERIOD."
    for row in OpsPolicySetting.objects.filter(section_code="REPORT_LIMITS"):
        if isinstance(row.value, bool) or not isinstance(
            row.value, (int, float)
        ):
            continue
        if row.setting_code.startswith(prefix):
            type_code = row.setting_code[len(prefix):]
            if type_code:
                max_by_type[type_code] = int(row.value)
        if row.setting_code == "LIMITS.REPORT_RETENTION.PARAMETER":
            retention = int(row.value)
    return {
        "maxPeriodDaysByType": max_by_type,
        "retentionDays": retention,
        "policyVersion": version_row.version,
    }


# ── Источник и сборка содержимого (§22.20/§22.24) ───────────────────────────


def read_source_rows():
    """Строки «Расхода личного состава» из живых смен. Пост — из СНИМКА
    привязки паспорта, а не резолвится сейчас: отчёт обязан показать то, что
    было зафиксировано при планировании (§9.6)."""
    rows = []
    for shift in OpsDutyShift.objects.all():
        binding = shift.passport_binding or {}
        sector = str(binding.get("sectorName") or "")
        post = str(binding.get("postName") or "")
        target = shift.target or {}
        rows.append({
            "businessDate": shift.business_date.isoformat(),
            "employeeName": shift.employee_name,
            "objectLabel": str(target.get("safeLabel") or ""),
            "postLabel": (
                None if sector == "" and post == "" else f"{sector} · {post}"
            ),
            "stateCode": shift.state_code,
            "note": shift.note or None,
            "overrideReason": shift.override_reason or None,
        })
    return rows


def select_rows(rows, param_from, param_to):
    """Границы ВКЛЮЧИТЕЛЬНЫЕ: «с 1-го по 31-е» человек понимает именно так —
    полуинтервал молча терял бы последний день."""
    selected = [
        row for row in rows
        if param_from <= row["businessDate"] <= param_to
    ]
    selected.sort(key=lambda row: (row["businessDate"], row["employeeName"]))
    return selected


def csv_field(value):
    if not any(char in value for char in ('"', ";", "\n", "\r")):
        return value
    return '"' + value.replace('"', '""') + '"'


def build_report_content(rows, param_from, param_to, sensitive):
    """§22.24: обычный экспорт не имеет колонок с исключёнными полями ВООБЩЕ
    — не пустые ячейки, а отсутствующие колонки, иначе отчёт сообщал бы «у
    этих смен примечаний не было»."""
    header = (
        _BASE_COLUMNS + _SENSITIVE_COLUMNS if sensitive else _BASE_COLUMNS
    )
    lines = [
        f"# Расход личного состава за период {param_from} — {param_to}",
        ";".join(csv_field(column) for column in header),
    ]
    for row in rows:
        values = [
            row["businessDate"], row["employeeName"], row["objectLabel"],
            row["postLabel"] or "", row["stateCode"],
        ]
        if sensitive:
            values += [row["note"] or "", row["overrideReason"] or ""]
        lines.append(";".join(csv_field(value) for value in values))
    return "\n".join(lines) + "\n"


def content_hash(content):
    """Детерминированная контрольная сумма (FNV-1a, 32 бита) — тот же
    алгоритм, что в мок-контракте (по кодовым точкам строки): одинаковое
    содержимое обязано давать одинаковый hash в обоих режимах."""
    value = 0x811C9DC5
    for char in content:
        value ^= ord(char)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return format(value, "08x")


def content_size(content):
    """Размер в БАЙТАХ UTF-8, а не длина строки: кириллица занимает два
    байта, и len() показал бы размер вдвое меньше настоящего."""
    return len(content.encode("utf-8"))


def _series_key(report_type_code, param_from, param_to, sensitive):
    """§22.25: серия — отчёт ОДНОГО типа за ОДИН период в ОДНОМ режиме.
    Режим входит в ключ намеренно: обычная и чувствительная выгрузки содержат
    разные колонки — это разные документы, а не редакции одного."""
    mode = "S" if sensitive else "N"
    return f"{report_type_code}|{param_from}|{param_to}|{mode}"


def _artifact_series_key(artifact):
    return _series_key(
        artifact.report_type_code,
        artifact.param_from.isoformat(),
        artifact.param_to.isoformat(),
        artifact.sensitive,
    )


def _next_revision(series_key):
    """По МАКСИМУМУ, а не по количеству: артефакт может исчезнуть по сроку
    хранения, и счёт по длине выдал бы второй артефакт с номером 1."""
    revisions = [
        artifact.revision
        for artifact in OpsServiceReportArtifact.objects.all()
        if _artifact_series_key(artifact) == series_key
    ]
    return max(revisions) + 1 if revisions else 1


def _find_reusable_artifact(series_key, now):
    """§22.25: пригодный — той же серии и ещё не истёкший; последняя
    редакция — повтор обязан отдавать самое свежее прочтение данных."""
    suitable = [
        artifact
        for artifact in OpsServiceReportArtifact.objects.all()
        if _artifact_series_key(artifact) == series_key
        and now < artifact.expires_at
    ]
    if not suitable:
        return None
    return max(suitable, key=lambda artifact: artifact.revision)


# ── Продвижение работы (§22.21) ─────────────────────────────────────────────


def _advance(job):
    """Ступень выполняется на ЧТЕНИИ. Артефакт формируется РОВНО на переходе
    в COMPLETED и больше не меняется (§22.22): повторное чтение завершённой
    работы ничего не пересчитывает."""
    if job.state in ("COMPLETED", "FAILED"):
        return
    if job.state == "PENDING":
        job.state = "PROCESSING"
        job.progress_percent = _PROGRESS_STEP
        job.save(update_fields=["state", "progress_percent", "updated_at"])
        return

    # Срок хранения — ДЕЙСТВУЮЩИЙ на момент сборки, и здесь же
    # замораживается в артефакте: политику могли изменить между запуском и
    # сборкой. Сбой политики — состояние работы, а не исключение наружу.
    limits = read_report_limits()
    if limits["retentionDays"] is None or limits["policyVersion"] is None:
        job.state = "FAILED"
        job.progress_percent = None
        job.completed_at = Clock.now()
        job.failure_code = "RETENTION_UNAVAILABLE"
        job.safe_failure_message = NO_RETENTION_REASON
        job.save(update_fields=[
            "state", "progress_percent", "completed_at", "failure_code",
            "safe_failure_message", "updated_at",
        ])
        return
    try:
        rows = select_rows(
            read_source_rows(),
            job.param_from.isoformat(),
            job.param_to.isoformat(),
        )
        content = build_report_content(
            rows, job.param_from.isoformat(), job.param_to.isoformat(),
            job.sensitive,
        )
    except Exception:
        # §22.21: сбой сборки — состояние работы; текст исключения (путь,
        # стек) наружу не едет — только safeFailureMessage (§22.22).
        job.state = "FAILED"
        job.progress_percent = None
        job.completed_at = Clock.now()
        job.failure_code = ASSEMBLY_FAILURE_CODE
        job.safe_failure_message = ASSEMBLY_FAILURE_MESSAGE
        job.save(update_fields=[
            "state", "progress_percent", "completed_at", "failure_code",
            "safe_failure_message", "updated_at",
        ])
        return

    generated_at = Clock.now()
    report_type = OpsServiceReportType.objects.filter(
        report_type_code=job.report_type_code
    ).first()
    artifact = OpsServiceReportArtifact.objects.create(
        artifact_code=f"artifact-{job.job_code}",
        job_code=job.job_code,
        report_type_code=job.report_type_code,
        safe_title=(
            report_type.safe_title
            if report_type is not None
            else job.report_type_code
        ),
        format=job.format,
        # §22.25: редакция считается по серии — «новая revision» обязана
        # давать 2 там, где уже есть 1.
        revision=_next_revision(_series_key(
            job.report_type_code, job.param_from.isoformat(),
            job.param_to.isoformat(), job.sensitive,
        )),
        generated_at=generated_at,
        generated_by=job.created_by_user_id,
        param_from=job.param_from,
        param_to=job.param_to,
        calculation_version=CALCULATION_VERSION,
        masking_policy_version=MASKING_POLICY_VERSION,
        retention_policy_version=limits["policyVersion"],
        sensitive=job.sensitive,
        file_size=content_size(content),
        hash=content_hash(content),
        expires_at=generated_at + dt.timedelta(days=limits["retentionDays"]),
        content=content,
    )
    job.state = "COMPLETED"
    job.progress_percent = 100
    job.completed_at = generated_at
    job.artifact_code = artifact.artifact_code
    job.save(update_fields=[
        "state", "progress_percent", "completed_at", "artifact_code",
        "updated_at",
    ])


def _advance_all():
    """Продвигаются ВСЕ работы, а не только видимые/отфильтрованные: работа,
    скрытая фильтром экрана, иначе застревала бы в очереди навсегда."""
    with transaction.atomic():
        for job in OpsServiceReportJob.objects.select_for_update():
            _advance(job)


# ── Проекции ────────────────────────────────────────────────────────────────


def _can_see_parameters(job, actor, perms):
    """§22.26: свой запуск — всегда; чужой — только по отдельному праву.
    Считает СЕРВЕР: сравнение на клиенте означало бы, что параметры уже
    приехали в браузер, и запрет остался бы вёрсткой."""
    if actor is not None and job.created_by_user_id == actor:
        return True
    return has_perm(perms, FOREIGN_PARAMETERS_PERMISSION)


def _project_job(job, parameters_visible):
    """Параметры чужого запуска ВЫРЕЗАНЫ, а не скрыты. Ключ идемпотентности
    — производное параметров, и вырезается вместе с ними."""
    parameters = {
        "from": job.param_from.isoformat(),
        "to": job.param_to.isoformat(),
    }
    return {
        "reportJobId": job.job_code,
        "reportTypeCode": job.report_type_code,
        "format": job.format,
        "state": job.state,
        "progressPercent": job.progress_percent,
        "createdAt": job.requested_at.isoformat(),
        "createdBy": {
            "userId": job.created_by_user_id,
            "safeLabel": job.created_by_label,
        },
        "completedAt": (
            job.completed_at.isoformat()
            if job.completed_at is not None else None
        ),
        "failureCode": job.failure_code,
        "safeFailureMessage": job.safe_failure_message,
        "artifactId": job.artifact_code,
        "idempotencyKey": (
            job.idempotency_key if parameters_visible else None
        ),
        "sensitive": job.sensitive,
        "parameters": parameters if parameters_visible else None,
        "parametersRedactedReason": (
            None if parameters_visible else FOREIGN_PARAMETERS_REASON
        ),
    }


def _summarize_artifact(artifact, now, parameters_visible):
    """§22.24 «безопасная проекция»: наружу едут МЕТАДАННЫЕ, но не содержимое
    и не ссылка на файл. Доступность считается сервером по своему времени."""
    available = now < artifact.expires_at
    return {
        "artifactId": artifact.artifact_code,
        "reportJobId": artifact.job_code,
        "safeTitle": artifact.safe_title,
        "format": artifact.format,
        "revision": artifact.revision,
        "generatedAt": artifact.generated_at.isoformat(),
        "generatedBy": artifact.generated_by,
        # Снимок параметров — это те же параметры: вырезать надо ОБА места.
        "parameterSnapshot": (
            {
                "from": artifact.param_from.isoformat(),
                "to": artifact.param_to.isoformat(),
            }
            if parameters_visible else None
        ),
        "calculationVersion": artifact.calculation_version,
        "maskingPolicyVersion": artifact.masking_policy_version,
        "sensitive": artifact.sensitive,
        "fileSize": artifact.file_size,
        "hash": artifact.hash,
        "expiresAt": artifact.expires_at.isoformat(),
        "available": available,
        "unavailableReason": None if available else "EXPIRED",
    }


def _build_job_actions(job, artifact_available, parameters_visible):
    """§22.25: действия считает сервер — экран не выводит их из состояния;
    на каждый отказ называется причина. Чужая невидимость параметров
    проверяется ПЕРВОЙ: сказать «срок истёк» тому, кому вообще нельзя видеть
    выгрузку, значит подменить причину отказа."""
    terminal = job.state in ("COMPLETED", "FAILED")
    running = "Работа ещё выполняется — дождитесь её завершения."
    if not parameters_visible:
        download = {
            "code": "DOWNLOAD", "available": False,
            "reason": FOREIGN_DOWNLOAD_REASON,
        }
    elif job.state == "FAILED":
        download = {
            "code": "DOWNLOAD", "available": False,
            "reason": "Работа завершилась ошибкой — файла нет.",
        }
    elif artifact_available is None:
        download = {
            "code": "DOWNLOAD", "available": False,
            "reason": "Артефакт ещё не сформирован.",
        }
    elif artifact_available:
        download = {"code": "DOWNLOAD", "available": True, "reason": None}
    else:
        download = {
            "code": "DOWNLOAD", "available": False,
            "reason": "Срок хранения артефакта истёк — файла больше нет на "
                      "сервере.",
        }
    return [
        {
            "code": "OPEN_PARAMETERS",
            "available": parameters_visible,
            "reason": (
                None if parameters_visible else FOREIGN_PARAMETERS_REASON
            ),
        },
        download,
        {
            "code": "RETRY",
            "available": terminal,
            "reason": None if terminal else running,
        },
        {
            "code": "NEW_REVISION",
            "available": job.state == "COMPLETED",
            "reason": (
                None
                if job.state == "COMPLETED"
                else (
                    "Редакция бывает у собранного отчёта: у упавшей работы "
                    "её нет — используйте «Повторить»."
                    if job.state == "FAILED"
                    else running
                )
            ),
        },
        {
            "code": "VIEW_ERROR",
            "available": job.state == "FAILED",
            "reason": (
                None
                if job.state == "FAILED"
                else "Работа не завершалась ошибкой."
            ),
        },
    ]


def _is_job_visible(job, can_export_sensitive):
    """§22.25: работа со скрытыми полями невидима без права на sensitive
    export — её параметры, автор и время сами по себе говорят, кого и за
    какой период выгружали. Фильтрация СЕРВЕРНАЯ."""
    return can_export_sensitive or not job.sensitive


# ── Ресурсы ─────────────────────────────────────────────────────────────────


def list_report_types(perms):
    limits = read_report_limits()
    results = []
    for report_type in OpsServiceReportType.objects.all():
        max_days = limits["maxPeriodDaysByType"].get(
            report_type.report_type_code
        )
        results.append({
            "reportTypeCode": report_type.report_type_code,
            "safeTitle": report_type.safe_title,
            "description": report_type.description,
            "formats": report_type.formats,
            # Предел приезжает к типу из ПОЛИТИКИ, а не лежит в определении:
            # отредактированное значение обязано побеждать сеяное.
            "maxPeriodDays": max_days,
            "unavailableReason": (
                NO_PERIOD_LIMIT_REASON
                if max_days is None
                else (
                    NO_RETENTION_REASON
                    if limits["retentionDays"] is None
                    else None
                )
            ),
        })
    return {
        "results": results,
        "retentionPolicy": {
            "retentionDays": limits["retentionDays"],
            "policyVersion": limits["policyVersion"],
        },
        "maskedFields": MASKED_FIELDS,
        "unavailableFormats": UNAVAILABLE_FORMATS,
        "unavailableArtifactFields": UNAVAILABLE_ARTIFACT_FIELDS,
        "canExportSensitive": has_perm(perms, SENSITIVE_PERMISSION),
    }


def list_report_jobs(actor, perms, filters):
    can_sensitive = has_perm(perms, SENSITIVE_PERMISSION)
    _advance_all()
    now = Clock.now()
    visible = [
        job for job in OpsServiceReportJob.objects.all()
        if _is_job_visible(job, can_sensitive)
    ]
    matched = []
    for job in visible:
        if filters.get("state") and job.state != filters["state"]:
            continue
        if filters.get("mine") and job.created_by_user_id != (actor or ""):
            continue
        matched.append(job)
    # §22.26: право на параметры — по КАЖДОЙ работе своё.
    visible_by_job = {
        job.job_code: _can_see_parameters(job, actor, perms)
        for job in matched
    }
    matched_codes = set(visible_by_job)
    artifacts = [
        artifact for artifact in OpsServiceReportArtifact.objects.all()
        if artifact.job_code in matched_codes
    ]
    summaries = [
        _summarize_artifact(
            artifact, now, visible_by_job.get(artifact.job_code, False)
        )
        for artifact in artifacts
    ]
    available_by_job = {
        summary["reportJobId"]: summary["available"] for summary in summaries
    }
    return {
        "results": [
            _project_job(job, visible_by_job[job.job_code])
            for job in matched
        ],
        "artifacts": summaries,
        "actions": [
            {
                "reportJobId": job.job_code,
                "actions": _build_job_actions(
                    job,
                    available_by_job.get(job.job_code),
                    visible_by_job[job.job_code],
                ),
            }
            for job in matched
        ],
        "unavailableColumns": UNAVAILABLE_HISTORY_COLUMNS,
        # «Ничего не нашлось» и «отчётов ещё не запускали» — разные сообщения.
        "totalVisible": len(visible),
        "serverTime": now.isoformat(),
    }


def get_report_job(actor, perms, job_code):
    """§22.27: право проверяется ЗАНОВО и полностью — карточка не доверяет
    ни маршруту, ни тому, что работа была в чьём-то списке. Работа
    продвигается на чтении, как в списке."""
    can_sensitive = has_perm(perms, SENSITIVE_PERMISSION)
    with transaction.atomic():
        job = (
            OpsServiceReportJob.objects.select_for_update()
            .filter(job_code=job_code)
            .first()
        )
        # Невидимая работа отвечает «не найдено», а не «нет прав»: 403 сам
        # подтвердил бы, что такая выгрузка существует.
        if job is None or not _is_job_visible(job, can_sensitive):
            raise _not_found(job_code)
        _advance(job)
    now = Clock.now()
    parameters_visible = _can_see_parameters(job, actor, perms)
    artifact = OpsServiceReportArtifact.objects.filter(
        job_code=job.job_code
    ).first()
    summary = (
        _summarize_artifact(artifact, now, parameters_visible)
        if artifact is not None
        else None
    )
    report_type = OpsServiceReportType.objects.filter(
        report_type_code=job.report_type_code
    ).first()
    return {
        "job": _project_job(job, parameters_visible),
        "artifact": summary,
        "actions": _build_job_actions(
            job,
            summary["available"] if summary is not None else None,
            parameters_visible,
        ),
        "reportTypeTitle": (
            report_type.safe_title
            if report_type is not None
            else job.report_type_code
        ),
        # «Свой» решает сервер, который знает актора запроса.
        "isOwn": actor is not None and job.created_by_user_id == actor,
        "unavailableBlocks": UNAVAILABLE_JOB_CARD_BLOCKS,
        "unavailableArtifactFields": UNAVAILABLE_ARTIFACT_FIELDS,
        "serverTime": now.isoformat(),
    }


def create_report_job(actor, perms, body):
    """§22.21. Порядок проверок: право → sensitive-право → параметры.
    Sensitive-право ДО валидации периода намеренно: «неверный период» у
    того, кому вообще нельзя выгружать скрытые поля, — подмена причины."""
    sensitive = bool(body.get("sensitive"))
    if sensitive and not has_perm(perms, SENSITIVE_PERMISSION):
        raise _permission_denied(SENSITIVE_PERMISSION)
    try:
        param_from = dt.date.fromisoformat(str(body.get("from") or ""))
        param_to = dt.date.fromisoformat(str(body.get("to") or ""))
    except ValueError:
        raise DomainError(
            "INVALID_PERIOD", 422,
            message="Укажите период в формате ГГГГ-ММ-ДД.",
        )
    if param_from > param_to:
        raise DomainError(
            "INVALID_PERIOD", 422, message="Начало периода позже его конца.",
        )
    idempotency_key = str(body.get("idempotencyKey") or "").strip()
    if idempotency_key == "":
        raise DomainError(
            "IDEMPOTENCY_KEY_REQUIRED", 422,
            message="Запуск отчёта требует ключа идемпотентности.",
        )
    with transaction.atomic():
        report_type = OpsServiceReportType.objects.filter(
            report_type_code=body.get("reportTypeCode") or ""
        ).first()
        if report_type is None:
            raise DomainError(
                "UNKNOWN_REPORT_TYPE", 422,
                message="Неизвестный тип отчёта.",
            )
        if body.get("format") not in report_type.formats:
            raise DomainError(
                "UNSUPPORTED_FORMAT", 422,
                message="Этот формат для отчёта не формируется.",
            )
        # Предел читается ЗАНОВО на мутации: между открытием формы и
        # запуском политику могли изменить — решает действующее значение.
        limits = read_report_limits()
        max_days = limits["maxPeriodDaysByType"].get(
            report_type.report_type_code
        )
        if max_days is None:
            raise DomainError(
                "PERIOD_LIMIT_UNAVAILABLE", 422,
                message=NO_PERIOD_LIMIT_REASON,
            )
        if limits["retentionDays"] is None:
            raise DomainError(
                "RETENTION_UNAVAILABLE", 422, message=NO_RETENTION_REASON,
            )
        if (param_to - param_from).days + 1 > max_days:
            raise DomainError(
                "PERIOD_TOO_LONG", 422,
                message=f"Период отчёта не может превышать {max_days} дней.",
            )
        # §22.21 идемпотентность: тот же ключ возвращает ТУ ЖЕ работу.
        existing = OpsServiceReportJob.objects.filter(
            idempotency_key=idempotency_key
        ).first()
        if existing is not None:
            return _project_job(existing, True)
        # Работа создаётся В ОЖИДАНИИ: §22.21 «success показывай только
        # после COMPLETED и получения artifactId».
        job = OpsServiceReportJob.objects.create(
            job_code=f"tmp-{uuid.uuid4().hex}",
            report_type_code=report_type.report_type_code,
            format=body.get("format"),
            state="PENDING",
            progress_percent=None,
            requested_at=Clock.now(),
            created_by_user_id=actor or "",
            created_by_label=actor or "",
            completed_at=None,
            failure_code=None,
            safe_failure_message=None,
            artifact_code=None,
            idempotency_key=idempotency_key,
            sensitive=sensitive,
            param_from=param_from,
            param_to=param_to,
        )
        _stamp_code(job, "job_code", "report-job")
        return _project_job(job, True)


def rerun_report_job(actor, perms, job_code, mode):
    """§22.25. Параметры повтора берутся из САМОЙ РАБОТЫ на сервере. RETRY
    возвращает уже готовый пригодный артефакт, если он есть; NEW_REVISION
    собирает заново ВСЕГДА — иначе новая редакция не появлялась бы никогда."""
    can_sensitive = has_perm(perms, SENSITIVE_PERMISSION)
    with transaction.atomic():
        source = OpsServiceReportJob.objects.filter(
            job_code=job_code
        ).first()
        if source is None or not _is_job_visible(source, can_sensitive):
            raise _not_found(job_code)
        if mode == "NEW_REVISION" and source.state != "COMPLETED":
            raise DomainError(
                "NO_BASE_REVISION", 422,
                message="Новая редакция бывает у собранного отчёта: эта "
                        "работа ещё не завершилась успехом.",
            )
        if mode == "RETRY" and source.state not in ("COMPLETED", "FAILED"):
            raise DomainError(
                "JOB_NOT_FINISHED", 422,
                message="Работа ещё выполняется — дождитесь её завершения.",
            )
        series_key = _series_key(
            source.report_type_code, source.param_from.isoformat(),
            source.param_to.isoformat(), source.sensitive,
        )
        if mode == "RETRY":
            reusable = _find_reusable_artifact(series_key, Clock.now())
            if reusable is not None:
                return {
                    "reused": True,
                    "reportJobId": reusable.job_code,
                    "artifactId": reusable.artifact_code,
                }
        # §22.25 «новый job с новым idempotencyKey»: ключ исходной вернул бы
        # её саму вместо повтора. Автор новой работы — тот, кто её запустил.
        job = OpsServiceReportJob.objects.create(
            job_code=f"tmp-{uuid.uuid4().hex}",
            report_type_code=source.report_type_code,
            format=source.format,
            state="PENDING",
            progress_percent=None,
            requested_at=Clock.now(),
            created_by_user_id=actor or "",
            created_by_label=actor or "",
            completed_at=None,
            failure_code=None,
            safe_failure_message=None,
            artifact_code=None,
            idempotency_key=f"{mode.lower()}:{job_code}:{uuid.uuid4().hex}",
            sensitive=source.sensitive,
            param_from=source.param_from,
            param_to=source.param_to,
        )
        _stamp_code(job, "job_code", "report-job")
        return {
            "reused": False,
            "reportJobId": job.job_code,
            "artifactId": None,
        }


def download_artifact(actor, perms, artifact_code):
    """§22.23: скачивание ПОВТОРНО проверяет пользователя, право, состояние
    артефакта, срок хранения и masking policy. Отдаётся содержимое, а не
    ссылка."""
    artifact = OpsServiceReportArtifact.objects.filter(
        artifact_code=artifact_code
    ).first()
    if artifact is None:
        raise _not_found(artifact_code)
    # Право на sensitive проверяется СНОВА: право могли отозвать после
    # генерации, а артефакт остался.
    if artifact.sensitive and not has_perm(perms, SENSITIVE_PERMISSION):
        raise _permission_denied(SENSITIVE_PERMISSION)
    # §22.26: чужой артефакт скачивает тот, кому разрешены параметры чужого
    # отчёта — период выгрузки написан в ПЕРВОЙ СТРОКЕ файла.
    owner = OpsServiceReportJob.objects.filter(
        job_code=artifact.job_code
    ).first()
    if owner is not None and not _can_see_parameters(owner, actor, perms):
        raise _permission_denied(FOREIGN_PARAMETERS_PERMISSION)
    if Clock.now() >= artifact.expires_at:
        raise DomainError(
            "ARTIFACT_EXPIRED", 422,
            message="Срок хранения артефакта истёк.",
        )
    file_name = (
        f"{artifact.report_type_code.lower()}-"
        f"{artifact.param_from.isoformat()}_{artifact.param_to.isoformat()}"
        ".csv"
    )
    return {"fileName": file_name, "content": artifact.content}
