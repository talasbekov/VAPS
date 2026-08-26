"""Аналитика службы и мероприятий (§22) — серверная реализация контракта
клиента (features/service-analytics): порт мок-репозитория и его чистой
модели ДОСЛОВНО.

Все числа считаются ЗДЕСЬ: §22.3 перечисляет расчёты, которых frontend делать
не должен, и «итог по видимой части таблицы» стоит в том же списке. Экран
получает готовые MetricValue и не видит исходных строк, пока не попросит
выборку явно (§22.12 drill-down со своим правом).

Снимок детерминирован своим входом (версия данных, период, scope, версия
расчёта): drill-down обязан относиться к тому же снимку, что и показатель, и
несовпадение — отказ SNAPSHOT_OUTDATED, а не молчаливая подмена выборки.

Источники — живые: смены и виды дежурств (срез C1), мероприятия и журнал
переходов ОМ (срез B1+H), пороги и допуски из «Настроек» (срез D1). Отсутствие
ПОЛИТИКИ — отдельное состояние с причиной, а не значения по умолчанию.
"""
import datetime as dt

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_analytics import (
    OpsAnalyticsMetricDefinition,
    OpsAnalyticsPeriodPreset,
    OpsAttentionDetector,
)
from organization_management.apps.operations.models_duty import (
    OpsDutyConflictPolicy,
    OpsDutyShift,
    OpsDutyType,
)
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
)

VIEW_PERMISSION = "analytics.view"
# §22.26: «drill-down», «персональная детализация» и «аналитика ОМ» — разные
# пункты списка прав, и здесь они разные права.
DRILLDOWN_PERMISSION = "analytics.drilldown"
PERSONAL_DETAIL_PERMISSION = "analytics.personal_detail"
OPS_VIEW_PERMISSION = "analytics.operations"

CALCULATION_VERSION = "service-analytics-2026.07.1"
METRIC_DEFINITION_VERSION = "metrics-2026.07.1"
POLICY_VERSION = "analytics-policy-2026.07.1"
OPS_CALCULATION_VERSION = "operations-analytics-2026.07.1"
ATTENTION_POLICY_FALLBACK_VERSION = "attention-policy-2026.07.1"

TIMEZONE = "Asia/Almaty"
DRILLDOWN_PAGE_SIZE = 25

METRIC_ON_DUTY = "DUTY_ACTIVE"
METRIC_PLANNED = "DUTY_PLANNED"
METRIC_REST = "REST_AFTER_DUTY"
METRIC_UNFINISHED = "UNFINISHED_PAST_DUTIES"
METRIC_HARD = "CONFLICT_HARD"
METRIC_SOFT = "CONFLICT_SOFT"
METRIC_UNCONFIRMED = "UNCONFIRMED_PARTICIPATION"

# Идентификатор корзины ОМ без объекта в реестре: свести их по имени значило
# бы сделать ровно ту склейку по названию, которую запрещает §22.15.
UNBOUND_OBJECT_ID = "object:unbound"

_SCOPE = {
    # RBAC живого бэка плоский (области видимости нет — открытый вопрос
    # владельца объекта в оргструктуре): scope один и назван честно.
    "scopeType": "DEMO_FLAT",
    "scopeId": "demo",
    "safeLabel": "Единственная область видимости demo-режима",
}

_CUSTOM_PERIOD_UNAVAILABLE_REASON = (
    "Предел произвольного периода не задан политикой — период по датам не "
    "принимается. Выберите именованный период."
)

_PERSONAL_DETAIL_REASON = (
    "У вас нет права на персональную детализацию: строки показаны без "
    "сотрудника (§22.26). Сервер их не присылает — скрывать ФИО в вёрстке "
    "значило бы всё равно отдать его браузеру."
)

_NO_FUNNEL_AT_LEVEL = (
    "Воронка §22.14 строится по множеству мероприятий: на уровне направления "
    "и поста множества нет, и повторять здесь воронку ОМ значило бы показать "
    "её под чужим заголовком."
)

# §22.11 «Используй формулировки» — РОВНО пять разрешённых заголовков.
ATTENTION_TITLES = {
    "VERIFICATION_REQUIRED": "Требуется проверка",
    "DATA_UNCONFIRMED": "Данные не подтверждены",
    "THRESHOLD_EXCEEDED": "Обнаружено превышение серверного порога",
    "UNFINISHED_PROCESSES": "Есть незавершённые процессы",
    "SOURCE_NOT_UPDATED": "Источник не обновлён",
}

_SEVERITY_RANK = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}

_STATE_LABEL = {
    "PLANNED": "Запланировано",
    "ACKNOWLEDGED": "Ознакомлен",
    "ACTIVE": "На посту",
    "COMPLETED": "Завершено",
    "CANCELLED": "Отменено",
}

# ── §35-блоки: чего нет и почему (тексты мок-контракта дословно) ────────────

UNAVAILABLE_METRICS = [
    {
        "code": "HEADCOUNT",
        "label": "Активный личный состав в scope",
        "reason": (
            "Численность приходит из кадрового источника, которого у "
            "аналитики службы нет: §22.7 сам исключает кадровые KPI и "
            "разрешает списочную численность только как read-only значение "
            "ВНЕШНЕГО источника, если оно есть в контракте. Его нет — и "
            "выводить число из числа сотрудников, попавших в смены, значило "
            "бы назвать личным составом тех, кого поставили в наряд."
        ),
    },
    {
        "code": "AVAILABILITY",
        "label": "Доступно для назначения",
        "reason": (
            "Доступность складывается из кадровой недоступности (отпуск, "
            "больничный, командировка), которой в модели дежурств нет "
            "(§21.30 называет эти слои недоступными по той же причине). "
            "Разница «все минус дежурящие» — не доступность, а её видимость."
        ),
    },
    {
        "code": "SECURITY_EVENT_ENGAGED",
        "label": "Участвует в ОМ",
        "reason": (
            "Расстановка охранного мероприятия ведёт назначения в СВОЁМ "
            "пространстве идентификаторов, а дежурства — в своём; связь "
            "между ними только по ФИО, и склейка по строке дала бы ложные "
            "совпадения. Число, посчитанное такой склейкой, нельзя "
            "перепроверить."
        ),
    },
]

UNAVAILABLE_HEADER_BLOCKS = [
    {
        "code": "SCOPE_FILTER",
        "label": "Выбор scope и подразделения",
        "reason": (
            "RBAC раздела плоский, без организационного scope: выбирать не "
            "из чего, а список из одного пункта «вся организация» изображал "
            "бы выбор, которого нет. §22.26 при этом требует, чтобы "
            "недоступный scope не появлялся даже в списке фильтров, — здесь "
            "его и нет."
        ),
    },
    {
        "code": "EXPORT",
        "label": "Экспорт аналитики из шапки",
        "reason": (
            "Выгрузка живёт отдельным разделом с собственной очередью, "
            "артефактом и сроком хранения (§22.18-22.25): вторая кнопка "
            "экспорта здесь создала бы второй путь к тем же файлам мимо "
            "истории отчётов."
        ),
    },
]

UNAVAILABLE_DETECTORS = [
    {
        "code": "WORKLOAD_EXCESS",
        "label": "Превышение нормы нагрузки",
        "reason": (
            "Пороги нагрузки живут в «Настройках» (LOAD_POLICY), и блок "
            "«Нагрузка» считается по ним, — но наблюдение §22.11 требует "
            "СВОЕГО детектора со своей политикой внимания и формулировкой "
            "словаря. Такого детектора нет; дублировать сюда состояние "
            "блока значило бы выдать перестановку показателя за наблюдение."
        ),
    },
    {
        "code": "ABSENCE_PATTERN",
        "label": "Отклонения по кадровой недоступности",
        "reason": (
            "Кадровой недоступности (отпуск, больничный, командировка) в "
            "модели дежурств нет — той же причиной закрыты слои матрицы "
            "§21.30. А наблюдение о больничных без источника было бы ровно "
            "тем обвинительным выводом, который §22.11 запрещает."
        ),
    },
]

LOAD_UNAVAILABLE = [
    {
        "code": "NIGHT_MINUTES",
        "label": "Ночные часы",
        "reason": (
            "Граница дневной и ночной работы — открытый вопрос самого "
            "промпта (NIGHT-WINDOW-001): источника окна нет, и завести его "
            "решением сервера значило бы закрыть чужой вопрос молча. Ночные "
            "минуты едут null, а не нулём."
        ),
    },
    {
        "code": "SECURITY_EVENT_LOAD",
        "label": "Нагрузка от охранных мероприятий",
        "reason": (
            "Назначения расстановки ОМ не несут интервалов времени (пост "
            "расчёта — строка без часов), складывать их с минутами смен не "
            "из чего. Слагаемое отсутствует, а не подменено допущением."
        ),
    },
    {
        "code": "REST_AND_REPLACEMENTS",
        "label": "Отдых, замены и неподтверждённые факты",
        "reason": (
            "Отдельных read model отдыха и замен нет (§21.35 живёт правилом "
            "конфликтов, а не журналом интервалов). Считать их из смен "
            "косвенно значило бы выдать вывод за данные."
        ),
    },
]

UNAVAILABLE_OPS_MEASURES = [
    {
        "code": "OVERDUE_ACTIONS",
        "label": "Просроченные действия",
        "reason": (
            "Сроков у действий ОМ модель не хранит: у мероприятия есть дата "
            "проведения, но нет ни плановых сроков этапов, ни дедлайнов "
            "согласования. Просрочка без срока — не измерение."
        ),
    },
    {
        "code": "CANCELLED_COUNT",
        "label": "Количество отменённых ОМ (§22.14)",
        "reason": (
            "Состояний «отменено» и «приостановлено» у мероприятия нет: "
            "отменить ОМ через UI нельзя, и журнал переходов такого события "
            "не содержит. Показать ноль значило бы утверждать, что отмен не "
            "было, — а мы утверждаем лишь, что их негде записать."
        ),
    },
    {
        "code": "OPEN_INCIDENTS",
        "label": "Открытые инциденты",
        "reason": (
            "Записи журнала штаба типа «инцидент» не имеют состояния "
            "«открыт/закрыт» — их можно посчитать, но нельзя разделить. "
            "Показывать все записи как открытые значило бы объявить "
            "незакрытым то, что могло быть разобрано."
        ),
    },
    {
        "code": "ACTUAL_PARTICIPATION",
        "label": "Фактическое участие",
        "reason": (
            "Факт участия в ОМ не фиксируется: отмечается только "
            "ознакомление. Приравнять факт к назначению — записать в "
            "участники того, кто мог не выйти."
        ),
    },
]

FUNNEL_MEASURES = [
    {"code": "REACHED", "safeLabel": "ОМ, достигших этапа", "unit": "ОМ"},
    {"code": "CURRENT", "safeLabel": "ОМ, находящихся на этапе", "unit": "ОМ"},
    {"code": "TRANSITIONS", "safeLabel": "Переходов", "unit": "переходов"},
    {"code": "RETURNS", "safeLabel": "Возвратов", "unit": "переходов"},
    {"code": "AVERAGE_HOURS", "safeLabel": "Среднее время этапа", "unit": "ч"},
    {"code": "MEDIAN_HOURS", "safeLabel": "Медиана времени этапа", "unit": "ч"},
]

OPS_COLUMNS = {
    "events": {"code": "EVENTS", "safeLabel": "ОМ"},
    "demandNeed": {
        "code": "DEMAND_NEED", "safeLabel": "Утверждённая потребность",
    },
    "requested": {"code": "REQUESTED", "safeLabel": "Запрошено"},
    "allocated": {"code": "ALLOCATED", "safeLabel": "Выделено"},
    "assigned": {"code": "ASSIGNED", "safeLabel": "Назначено"},
    "acknowledged": {"code": "ACKNOWLEDGED", "safeLabel": "Ознакомлено"},
    "conflicts": {"code": "CONFLICTS", "safeLabel": "Конфликты"},
    "incidents": {"code": "INCIDENTS", "safeLabel": "Записи об инцидентах"},
    "posts": {"code": "POSTS", "safeLabel": "Постов"},
    "need": {"code": "NEED", "safeLabel": "Требуется по расчёту"},
}


def has_perm(perms, code):
    return "*" in perms or code in perms


def _permission_denied(code):
    return DomainError(
        "PERMISSION_DENIED", 403, detail={"permission": code},
        message="Недостаточно прав.",
    )


# ── Политики из «Настроек» ──────────────────────────────────────────────────


def _section_version(section_code):
    row = OpsPolicySectionVersion.objects.filter(
        section_code=section_code
    ).first()
    return row.version if row is not None and row.version else None


def _numeric_settings(section_code):
    return {
        row.setting_code: int(row.value)
        for row in OpsPolicySetting.objects.filter(section_code=section_code)
        if isinstance(row.value, (int, float))
        and not isinstance(row.value, bool)
    }


def read_custom_period_limit():
    """§22.5 предел произвольного периода. `None` — политика не прочитана, и
    это НЕ «ограничения нет»: молча принять период любой глубины значило бы
    снять предел из-за отсутствия его владельца."""
    version = _section_version("ANALYTICS_LIMITS")
    if version is None:
        return None
    values = _numeric_settings("ANALYTICS_LIMITS")
    max_days = values.get("LIMITS.ANALYTICS_CUSTOM_PERIOD.PARAMETER")
    if max_days is None:
        return None
    return {"maxDays": max_days, "policyVersion": version}


def read_rest_mode():
    """Режим нарушения отдыха §21.35 — ТА ЖЕ политика, что у планирования
    дежурств (синглтон-потребитель настроек): два владельца одного факта
    разошлись бы, и один конфликт был бы жёстким на плане и мягким здесь.
    Дефолт строгий — HARD_BLOCK."""
    policy = OpsDutyConflictPolicy.objects.filter(singleton_key=1).first()
    if policy is None:
        return "HARD_BLOCK"
    return (
        "SOFT_OVERRIDE"
        if policy.rest_after_duty_mode == "SOFT_OVERRIDE"
        else "HARD_BLOCK"
    )


def read_attention_policy():
    """§22.11: администрируемые числа детекторов из ATTENTION_POLICY.
    `None` — политика не загружена, и это не «замечаний нет». Значения
    раскладываются по коду `ATTENTION.<ДЕТЕКТОР>.<ПОЛЕ>`."""
    version = _section_version("ATTENTION_POLICY")
    if version is None:
        return None
    by_detector = {}
    for code, value in _numeric_settings("ATTENTION_POLICY").items():
        parts = code.split(".")
        if len(parts) != 3 or parts[0] != "ATTENTION":
            continue
        detector, field = parts[1], parts[2]
        bucket = by_detector.setdefault(detector, {})
        if field == "PARAMETER":
            bucket["parameter"] = value
        if field == "WARNING_FROM":
            bucket["warningFrom"] = value
        if field == "CRITICAL_FROM":
            bucket["criticalFrom"] = value
    return {"policyVersion": version, "byDetector": by_detector}


def read_load_policy():
    """§22.9 пороги нагрузки. `None` — методика не задана ИЛИ неполна:
    посчитать по половине политики и подписать её версией значило бы соврать
    о том, как получено состояние."""
    version = _section_version("LOAD_POLICY")
    if version is None:
        return None
    values = _numeric_settings("LOAD_POLICY")
    period = values.get("LOAD.PERIOD.PARAMETER")
    warning = values.get("LOAD.WARNING_MINUTES.PARAMETER")
    overload = values.get("LOAD.OVERLOAD_MINUTES.PARAMETER")
    if period is None or warning is None or overload is None:
        return None
    return {
        "periodDays": period,
        "warningMinutes": warning,
        "overloadMinutes": overload,
        "policyVersion": version,
    }


# ── Источник смен ───────────────────────────────────────────────────────────


class _SourceShift:
    """Узкая проекция живой смены — ровно поля контракта аналитики."""

    __slots__ = (
        "id", "business_date", "employee_name", "employee_id", "unit_id",
        "object_label", "state_code", "duty_type_code", "actual_start",
        "actual_end", "updated_at",
    )

    def __init__(self, shift, unit_id):
        self.id = str(shift.pk)
        self.business_date = shift.business_date
        self.employee_name = shift.employee_name
        self.employee_id = shift.employee_id
        self.unit_id = unit_id
        target = shift.target or {}
        self.object_label = str(target.get("safeLabel") or "")
        self.state_code = shift.state_code
        self.duty_type_code = shift.duty_type_code
        self.actual_start = shift.actual_start
        self.actual_end = shift.actual_end
        self.updated_at = shift.updated_at


def read_source():
    """Источник аналитики: живые смены + виды + режим отдыха + подписи
    подразделений. Связь смены с подразделением — через живого Employee
    (§22.9 «устойчивая связь»; ФИО связью не является)."""
    from organization_management.apps.employees.models import Employee

    shifts = list(OpsDutyShift.objects.all())
    employee_ids = {
        int(s.employee_id) for s in shifts
        if s.employee_id is not None and str(s.employee_id).isdigit()
    }
    unit_by_employee = {}
    unit_labels = {}
    for employee in Employee.objects.filter(
        pk__in=employee_ids
    ).select_related("staff_unit__division"):
        try:
            staff_unit = employee.staff_unit
        except Employee.staff_unit.RelatedObjectDoesNotExist:
            staff_unit = None
        division = staff_unit.division if staff_unit is not None else None
        if division is None:
            continue
        unit_by_employee[str(employee.pk)] = str(division.pk)
        unit_labels[str(division.pk)] = division.name

    return {
        "shifts": [
            _SourceShift(shift, unit_by_employee.get(shift.employee_id))
            for shift in shifts
        ],
        "dutyTypes": {
            t.duty_type_code: t for t in OpsDutyType.objects.all()
        },
        "restMode": read_rest_mode(),
        "unitLabels": unit_labels,
    }


def _data_revision():
    """Версия данных для детерминированного snapshotId: меняется с каждой
    правкой источника или политики, стабильна между ними. Часы сюда не
    входят — случайный или временной id различал бы два одинаковых снимка."""
    stamps = []
    for model in (OpsDutyShift, OpsDutyType, OpsPolicySetting,
                  OpsDutyConflictPolicy):
        latest = model.objects.order_by("-updated_at").values_list(
            "updated_at", flat=True
        ).first()
        stamps.append(
            f"{model.objects.count()}:"
            f"{latest.isoformat() if latest is not None else '-'}"
        )
    return "|".join(stamps)


def build_snapshot_id(*, revision, from_date, to_date, scope_id):
    return f"snap-{revision}-{from_date}-{to_date}-{scope_id}"


# ── Период (§22.5) ──────────────────────────────────────────────────────────


def resolve_period(request):
    """Период считает СЕРВЕР: экран присылает код пресета либо даты, но не то
    и другое — «текущая неделя» не должна означать разные интервалы у разных
    вкладок."""
    business_date = Clock.today_local()
    preset_code = request.get("presetCode")
    if preset_code:
        preset = OpsAnalyticsPeriodPreset.objects.filter(
            preset_code=preset_code
        ).first()
        if preset is None:
            raise DomainError(
                "UNKNOWN_PERIOD_PRESET", 422, message="Неизвестный период.",
            )
        start = business_date + dt.timedelta(days=preset.offset_days)
        return {
            "from": start.isoformat(),
            "to": (
                start + dt.timedelta(days=preset.length_days - 1)
            ).isoformat(),
            "presetCode": preset.preset_code,
        }
    # Параметра НЕ ПРИСЛАЛИ ВОВСЕ — это ошибка запроса (400), а не негодное
    # значение (422). Разница не формальная: до этой правки обе беды отвечали
    # одинаково, и клиент, вообще не знавший про период (а схема о нём
    # молчала — Plane №151), получал «укажите период в формате ГГГГ-ММ-ДД» на
    # запрос, в котором формата не было вовсе.
    if not str(request.get("from") or "") and not str(request.get("to") or ""):
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"from": ["Укажите период."], "to": ["Укажите период."]},
            message="Проверьте заполнение формы.",
        )
    try:
        from_date = dt.date.fromisoformat(str(request.get("from") or ""))
        to_date = dt.date.fromisoformat(str(request.get("to") or ""))
    except ValueError:
        raise DomainError(
            "INVALID_PERIOD", 422,
            message="Укажите период в формате ГГГГ-ММ-ДД.",
        )
    if from_date > to_date:
        raise DomainError(
            "INVALID_PERIOD", 422, message="Начало периода позже его конца.",
        )
    # §22.5: предел произвольного периода приходит из «Настроек» — аналитика
    # его читает, но не задаёт: ограничение принадлежит не тому, кого связывает.
    limit = read_custom_period_limit()
    if limit is None:
        raise DomainError(
            "PERIOD_LIMIT_UNAVAILABLE", 422,
            message=_CUSTOM_PERIOD_UNAVAILABLE_REASON,
        )
    if (to_date - from_date).days + 1 > limit["maxDays"]:
        raise DomainError(
            "PERIOD_TOO_LONG", 422,
            message=(
                "Период аналитики не может превышать "
                f"{limit['maxDays']} дней."
            ),
        )
    return {
        "from": from_date.isoformat(),
        "to": to_date.isoformat(),
        "presetCode": None,
    }


# ── Правила показателей (§22.7) ─────────────────────────────────────────────


def _in_period(date, period):
    return period["from"] <= date.isoformat() <= period["to"]


def is_unfinished_past(shift, business_date):
    """Прошедшее — строго ДО бизнес-даты: сегодняшняя смена ещё не обязана
    быть закрытой, и записать её в просрочку значило бы обвинить человека
    раньше срока (§22.11 запрещает обвинительные выводы)."""
    if shift.business_date >= business_date:
        return False
    return shift.state_code not in ("COMPLETED", "CANCELLED")


def is_unconfirmed(shift):
    """Смена дошла до несения службы, но факта нет. Отменённые не попадают —
    у них подтверждать нечего."""
    if shift.state_code == "ACTIVE":
        return shift.actual_start is None
    if shift.state_code == "COMPLETED":
        return shift.actual_start is None or shift.actual_end is None
    return False


def rest_days(duty_type):
    """Длина отдыха — у ВИДА (§21.35), в сутках с округлением ВВЕРХ: неполные
    сутки отдыха — всё ещё отдых."""
    if duty_type is None:
        return 0
    return -(-duty_type.rest_after_minutes // (24 * 60))


def is_resting(shift, duty_type, on_date):
    if shift.state_code != "COMPLETED":
        return False
    days = rest_days(duty_type)
    if days == 0:
        return False
    return (
        shift.business_date < on_date
        <= shift.business_date + dt.timedelta(days=days)
    )


def detect_conflict_shift_ids(shifts, types_by_code, rest_mode):
    """Конфликты §21.34/§22.7 — ТЕМ ЖЕ способом, что в плане дежурств:
    пересечение в один день всегда жёсткое; нарушение отдыха — по режиму
    политики. Нарушение принадлежит ВТОРОЙ смене пары. Смена в обоих наборах
    остаётся жёсткой. Возвращаются идентификаторы, а не количество: за каждым
    числом обязана стоять выборка (§22.12)."""
    active = [s for s in shifts if s.state_code != "CANCELLED"]
    by_employee = {}
    for shift in active:
        by_employee.setdefault(shift.employee_name, []).append(shift)

    hard, soft = set(), set()
    for group in by_employee.values():
        ordered = sorted(group, key=lambda s: s.business_date)
        for i, first in enumerate(ordered):
            for second in ordered[i + 1:]:
                if first.business_date == second.business_date:
                    hard.add(first.id)
                    hard.add(second.id)
                    continue
                days = rest_days(types_by_code.get(first.duty_type_code))
                if days == 0:
                    continue
                if second.business_date <= (
                    first.business_date + dt.timedelta(days=days)
                ):
                    (hard if rest_mode == "HARD_BLOCK" else soft).add(
                        second.id
                    )
    soft -= hard
    return {"hard": sorted(hard), "soft": sorted(soft)}


def build_selections(source, period, business_date):
    """Выборки, стоящие за показателями (§22.12): число показателя — длина
    выборки, иначе KPI и его расшифровка разошлись бы при первой правке."""
    in_range = [
        s for s in source["shifts"] if _in_period(s.business_date, period)
    ]
    conflicts = detect_conflict_shift_ids(
        in_range, source["dutyTypes"], source["restMode"]
    )
    return {
        METRIC_ON_DUTY: [
            s.id for s in in_range if s.state_code == "ACTIVE"
        ],
        METRIC_PLANNED: [
            s.id for s in in_range
            if s.state_code in ("PLANNED", "ACKNOWLEDGED")
        ],
        # Отдых считается по ВСЕМУ набору смен: дежурство перед началом
        # периода продолжает давать отдых внутри него.
        METRIC_REST: [
            s.id for s in source["shifts"]
            if is_resting(
                s, source["dutyTypes"].get(s.duty_type_code), business_date
            )
        ],
        METRIC_UNFINISHED: [
            s.id for s in in_range if is_unfinished_past(s, business_date)
        ],
        METRIC_HARD: conflicts["hard"],
        METRIC_SOFT: conflicts["soft"],
        METRIC_UNCONFIRMED: [s.id for s in in_range if is_unconfirmed(s)],
    }


def _metric_state(value, definition):
    if value is None:
        return "UNKNOWN"
    if (
        definition.critical_from is not None
        and value >= definition.critical_from
    ):
        return "CRITICAL"
    if (
        definition.warning_from is not None
        and value >= definition.warning_from
    ):
        return "WARNING"
    return "NORMAL"


def _display_value(value, unit):
    if value is None:
        return "нет данных"
    if unit == "PERCENT":
        return f"{value}%"
    if unit == "MINUTES":
        return f"{value} мин"
    if unit == "HOURS":
        return f"{value} ч"
    return str(value)


def build_metric(definition, value):
    """`value is None` — «посчитать не удалось», и это НЕ ноль (§35)."""
    return {
        "metricCode": definition.metric_code,
        "safeLabel": definition.safe_label,
        "value": value,
        "displayValue": _display_value(value, definition.unit),
        "unit": definition.unit,
        "state": _metric_state(value, definition),
        # Раскрывать нечего, если значение неизвестно.
        "drilldownAvailable": (
            definition.drilldown_available and value is not None
        ),
        "metricDefinitionVersion": METRIC_DEFINITION_VERSION,
    }


def _source_updated_at(source):
    stamps = [s.updated_at for s in source["shifts"]]
    return max(stamps).isoformat() if stamps else None


def _base_envelope(*, snapshot_id, period, calculation_version,
                   policy_version):
    return {
        "snapshotId": snapshot_id,
        "businessDate": Clock.today_local().isoformat(),
        "timezone": TIMEZONE,
        "period": period,
        "scope": dict(_SCOPE),
        "generatedAt": Clock.now().isoformat(),
        "sourceUpdatedAt": None,
        # Водяного знака источника нет — поле есть в контракте §22.4, и
        # врать в него нечем.
        "sourceWatermark": None,
        "freshnessState": "CURRENT",
        "completenessState": "COMPLETE",
        "calculationVersion": calculation_version,
        "policyVersion": policy_version,
    }


# ── Ресурсы ─────────────────────────────────────────────────────────────────


def list_presets():
    presets = list(OpsAnalyticsPeriodPreset.objects.all())
    limit = read_custom_period_limit()
    return {
        "results": [
            {
                "presetCode": p.preset_code,
                "safeLabel": p.safe_label,
                "offsetDays": p.offset_days,
                "lengthDays": p.length_days,
            }
            for p in presets
        ],
        "maxCustomPeriodDays": (
            limit["maxDays"] if limit is not None else None
        ),
        "limitPolicyVersion": (
            limit["policyVersion"] if limit is not None else None
        ),
        "customPeriodUnavailableReason": (
            None if limit is not None else _CUSTOM_PERIOD_UNAVAILABLE_REASON
        ),
        "defaultPresetCode": (
            presets[0].preset_code if presets else "TODAY"
        ),
    }


def service_analytics(perms, request):
    period = resolve_period(request)
    source = read_source()
    business_date = Clock.today_local()
    selections = build_selections(source, period, business_date)
    metrics = [
        build_metric(
            definition, len(selections.get(definition.metric_code, []))
        )
        for definition in OpsAnalyticsMetricDefinition.objects.all()
    ]
    drilldown_allowed = has_perm(perms, DRILLDOWN_PERMISSION)
    envelope = _base_envelope(
        snapshot_id=build_snapshot_id(
            revision=_data_revision(), from_date=period["from"],
            to_date=period["to"], scope_id=_SCOPE["scopeId"],
        ),
        period=period,
        calculation_version=CALCULATION_VERSION,
        policy_version=POLICY_VERSION,
    )
    envelope["sourceUpdatedAt"] = _source_updated_at(source)
    envelope["data"] = {
        "metrics": metrics,
        "unavailableMetrics": UNAVAILABLE_METRICS,
    }
    envelope["unavailableHeaderBlocks"] = UNAVAILABLE_HEADER_BLOCKS
    envelope["drilldownAllowed"] = drilldown_allowed
    envelope["drilldownDeniedReason"] = (
        None
        if drilldown_allowed
        else "Раскрытие показателя до строк — отдельное право (§22.26): "
             "дашборд показывает агрегаты, выборка показывает людей и смены."
    )
    return envelope


def _decode_cursor(cursor):
    if not cursor:
        return 0
    if not str(cursor).startswith("offset:"):
        return 0
    tail = str(cursor)[len("offset:"):]
    return int(tail) if tail.isdigit() else 0


def drilldown(perms, query):
    """§22.12: право проверяется ЗАНОВО и своё — переход со своего же дашборда
    доступа не подтверждает. Строки обязаны принадлежать ТОМУ ЖЕ снимку."""
    if not has_perm(perms, DRILLDOWN_PERMISSION):
        raise _permission_denied(DRILLDOWN_PERMISSION)
    period = resolve_period(query)
    revision = _data_revision()
    snapshot_id = build_snapshot_id(
        revision=revision, from_date=period["from"], to_date=period["to"],
        scope_id=_SCOPE["scopeId"],
    )
    if query.get("snapshotId") != snapshot_id:
        raise DomainError(
            "SNAPSHOT_OUTDATED", 422,
            message="Данные изменились с момента показа показателя. "
                    "Обновите аналитику и раскройте показатель заново.",
        )
    source = read_source()
    business_date = Clock.today_local()
    selections = build_selections(source, period, business_date)
    ids = selections.get(query.get("metricCode"))
    if ids is None:
        raise DomainError(
            "UNKNOWN_METRIC", 422, message="Неизвестный показатель.",
        )
    by_id = {s.id: s for s in source["shifts"]}
    personal = has_perm(perms, PERSONAL_DETAIL_PERMISSION)
    offset = _decode_cursor(query.get("cursor"))
    page_ids = ids[offset:offset + DRILLDOWN_PAGE_SIZE]
    next_offset = offset + DRILLDOWN_PAGE_SIZE

    envelope = _base_envelope(
        snapshot_id=snapshot_id, period=period,
        calculation_version=CALCULATION_VERSION,
        policy_version=POLICY_VERSION,
    )
    envelope["data"] = {
        "metricCode": query.get("metricCode"),
        # Персональная детализация вырезается ЗДЕСЬ, на сервере (§22.26):
        # скрыть ФИО в вёрстке значит всё равно отдать его браузеру.
        "rows": [
            {
                "rowId": shift.id,
                "businessDate": shift.business_date.isoformat(),
                "objectLabel": shift.object_label,
                "stateLabel": _STATE_LABEL.get(
                    shift.state_code, shift.state_code
                ),
                "employeeLabel": shift.employee_name if personal else None,
            }
            for shift in (by_id.get(i) for i in page_ids)
            if shift is not None
        ],
        "nextCursor": (
            f"offset:{next_offset}" if next_offset < len(ids) else None
        ),
        "totalCount": len(ids),
        "personalDetailSuppressed": not personal,
        "personalDetailReason": None if personal else _PERSONAL_DETAIL_REASON,
    }
    return envelope


# ── Блок «Требует внимания» (§22.11) ────────────────────────────────────────


def _apply_attention_policy(detectors, policy):
    """Методика остаётся в определении; допуски и пороги — из «Настроек».
    Политики нет — детекторов нет: наблюдать по методике, которую никто не
    администрирует, значило бы выдать результат за действующую политику."""
    if policy is None:
        return []
    applied = []
    for detector in detectors:
        values = policy["byDetector"].get(detector.category_code, {})
        applied.append({
            "categoryCode": detector.category_code,
            "measure": detector.measure,
            "titleCode": detector.title_code,
            "template": detector.safe_description_template,
            "parameter": values.get("parameter", detector.parameter),
            "warningFrom": values.get("warningFrom", detector.warning_from),
            "criticalFrom": values.get(
                "criticalFrom", detector.critical_from
            ),
            "baseSeverity": detector.base_severity,
            "targetRoute": detector.target_route,
            "targetPermission": detector.target_permission,
        })
    return applied


def _measure_attention(detector, source, period, business_date,
                       generated_at):
    """Свои предикаты — ни один детектор не читает MetricValue: иначе блок был
    бы перестановкой показателей экрана, выданной за серверное наблюдение."""
    in_range = [
        s for s in source["shifts"] if _in_period(s.business_date, period)
    ]
    measure = detector["measure"]
    if measure == "ACKNOWLEDGEMENT_MISSING":
        # Наблюдение о БЛИЖАЙШИХ заступлениях: смена через месяц без отметки
        # — не повод «требовать проверки».
        horizon = business_date + dt.timedelta(days=detector["parameter"])
        hits = [
            s for s in in_range
            if s.state_code == "PLANNED"
            and business_date <= s.business_date <= horizon
        ]
        return {"value": len(hits), "count": len(hits)}
    if measure == "CONFLICT_SHARE":
        # ДОЛЯ, а не количество; при пустом периоде наблюдения нет вовсе
        # (0/0 — не «ноль процентов»).
        if not in_range:
            return None
        conflicts = detect_conflict_shift_ids(
            in_range, source["dutyTypes"], source["restMode"]
        )
        affected = len(conflicts["hard"]) + len(conflicts["soft"])
        return {
            "value": round(affected / len(in_range) * 100),
            "count": affected,
        }
    if measure == "UNFINISHED_OVERDUE":
        deadline = business_date - dt.timedelta(days=detector["parameter"])
        hits = [
            s for s in in_range
            if s.business_date < deadline
            and s.state_code not in ("COMPLETED", "CANCELLED")
        ]
        return {"value": len(hits), "count": len(hits)}
    if measure == "UNCONFIRMED_OVERDUE":
        deadline = business_date - dt.timedelta(days=detector["parameter"])
        hits = [
            s for s in in_range
            if s.business_date < deadline and is_unconfirmed(s)
        ]
        return {"value": len(hits), "count": len(hits)}
    if measure == "SOURCE_AGE":
        # Утверждение об ИСТОЧНИКЕ, а не о людях.
        stamps = [s.updated_at for s in source["shifts"]]
        if not stamps:
            return None
        age = generated_at - max(stamps)
        return {
            "value": max(0, int(age.total_seconds() // 3600)),
            "count": None,
        }
    return None


def _attention_fires(detector, value):
    thresholds = [
        t for t in (detector["warningFrom"], detector["criticalFrom"])
        if t is not None
    ]
    if not thresholds:
        return value > 0
    return value >= min(thresholds)


def _attention_severity(detector, value):
    if (
        detector["criticalFrom"] is not None
        and value >= detector["criticalFrom"]
    ):
        return "CRITICAL"
    if (
        detector["warningFrom"] is not None
        and value >= detector["warningFrom"]
    ):
        return "WARNING"
    return detector["baseSeverity"]


def attention(request):
    period = resolve_period(request)
    source = read_source()
    business_date = Clock.today_local()
    generated_at = Clock.now()
    snapshot_id = build_snapshot_id(
        revision=_data_revision(), from_date=period["from"],
        to_date=period["to"], scope_id=_SCOPE["scopeId"],
    )
    policy = read_attention_policy()
    detectors = _apply_attention_policy(
        list(OpsAttentionDetector.objects.all()), policy
    )
    unavailable_reason = (
        "Политика наблюдений §22.11 не загружена: раздел «Настройки» не "
        "отдал допуски и пороги, а без них детекторы не запускались."
        if policy is None or not detectors
        else None
    )
    policy_version = (
        policy["policyVersion"]
        if policy is not None
        else ATTENTION_POLICY_FALLBACK_VERSION
    )

    items = []
    if unavailable_reason is None:
        for detector in detectors:
            measurement = _measure_attention(
                detector, source, period, business_date, generated_at
            )
            if measurement is None:
                continue
            if not _attention_fires(detector, measurement["value"]):
                continue
            count = measurement["count"]
            description = (
                detector["template"]
                .replace("{count}", "—" if count is None else str(count))
                .replace("{parameter}", str(detector["parameter"]))
                .replace("{value}", str(measurement["value"]))
            )
            items.append({
                # Идентификатор ДЕТЕРМИНИРОВАН снимком и категорией: один и
                # тот же снимок обязан давать те же элементы.
                "attentionId": (
                    f"att-{snapshot_id}-{detector['categoryCode']}"
                ),
                "categoryCode": detector["categoryCode"],
                "severity": _attention_severity(
                    detector, measurement["value"]
                ),
                "safeTitle": ATTENTION_TITLES[detector["titleCode"]],
                "safeDescription": description,
                "count": count,
                "scopeLabel": _SCOPE["safeLabel"],
                "targetRoute": detector["targetRoute"],
                "targetPermission": detector["targetPermission"],
                "detectedAt": generated_at.isoformat(),
                "policyVersion": policy_version,
            })
        # Порядок задаёт СЕРВЕР: severity, затем код категории.
        items.sort(
            key=lambda item: (
                _SEVERITY_RANK[item["severity"]], item["categoryCode"],
            )
        )

    envelope = _base_envelope(
        snapshot_id=snapshot_id, period=period,
        calculation_version=CALCULATION_VERSION,
        # Версия политики НАБЛЮДЕНИЙ, а не порогов показателей: методики
        # независимы, и общая версия соврала бы про обе сразу.
        policy_version=policy_version,
    )
    envelope["completenessState"] = (
        "COMPLETE" if unavailable_reason is None else "INCOMPLETE"
    )
    envelope["data"] = {
        "items": items,
        "detectionState": (
            "COMPLETE" if unavailable_reason is None else "UNAVAILABLE"
        ),
        "detectionUnavailableReason": unavailable_reason,
        "unavailableDetectors": UNAVAILABLE_DETECTORS,
    }
    return envelope


# ── Нагрузка (§22.9) ────────────────────────────────────────────────────────


def load_analytics():
    """ДВЕ СУММЫ, КОТОРЫЕ НЕ СМЕШИВАЮТСЯ (§22.9): план — по назначениям, факт
    — по подтверждённому участию; `loadState` красится ТОЛЬКО по плановой."""
    source = read_source()
    policy = read_load_policy()
    business_date = Clock.today_local()

    duration_by_type = {
        code: t.default_duration_minutes
        for code, t in source["dutyTypes"].items()
    }
    window_from = (
        business_date - dt.timedelta(days=policy["periodDays"] - 1)
        if policy is not None
        else None
    )
    unit_buckets = {}
    employee_buckets = {}
    unlinked = 0
    for shift in source["shifts"]:
        if shift.state_code == "CANCELLED":
            continue
        # Политики нет — окна нет: фильтровать «за последние N суток» было
        # бы выдумыванием N.
        if window_from is not None and not (
            window_from <= shift.business_date <= business_date
        ):
            continue
        planned = (
            duration_by_type.get(shift.duty_type_code, 0)
            if policy is not None
            else 0
        )
        actual = 0
        if (
            policy is not None
            and shift.state_code == "COMPLETED"
            and shift.actual_start is not None
            and shift.actual_end is not None
            and shift.actual_end > shift.actual_start
        ):
            actual = round(
                (shift.actual_end - shift.actual_start).total_seconds() / 60
            )
        if shift.employee_id is None or shift.unit_id is None:
            # Связь §22.9 не установлена: сумма без владельца поехала бы в
            # чужую строку — смена видна счётчиком, а не теряется.
            unlinked += 1
            continue
        unit = unit_buckets.setdefault(shift.unit_id, {
            "employeeId": None,
            "safeLabel": source["unitLabels"].get(
                shift.unit_id, shift.unit_id
            ),
            "organizationUnitId": shift.unit_id,
            "planned": 0,
            "actual": 0,
        })
        unit["planned"] += planned
        unit["actual"] += actual
        employee = employee_buckets.setdefault(shift.employee_id, {
            "employeeId": shift.employee_id,
            "safeLabel": shift.employee_name,
            "organizationUnitId": shift.unit_id,
            "planned": 0,
            "actual": 0,
        })
        employee["planned"] += planned
        employee["actual"] += actual

    def to_metric(bucket):
        if policy is None:
            return {
                "employeeId": bucket["employeeId"],
                "safeLabel": bucket["safeLabel"],
                "organizationUnitId": bucket["organizationUnitId"],
                # Неизвестность не превращается в ноль.
                "plannedMinutes": None,
                "actualMinutes": None,
                "nightMinutes": None,
                "loadState": "UNKNOWN",
                "safeReasonCodes": ["POLICY_UNDEFINED"],
                "policyVersion": None,
            }
        if bucket["planned"] >= policy["overloadMinutes"]:
            state, reasons = "OVERLOADED", ["PLANNED_OVERLOAD"]
        elif bucket["planned"] >= policy["warningMinutes"]:
            state, reasons = "WARNING", ["PLANNED_WARNING"]
        else:
            state, reasons = "NORMAL", []
        return {
            "employeeId": bucket["employeeId"],
            "safeLabel": bucket["safeLabel"],
            "organizationUnitId": bucket["organizationUnitId"],
            "plannedMinutes": bucket["planned"],
            "actualMinutes": bucket["actual"],
            "nightMinutes": None,
            "loadState": state,
            "safeReasonCodes": reasons,
            "policyVersion": policy["policyVersion"],
        }

    # Порядок — ПО ПОДПИСИ: сортировка по величине была бы таблицей «кто
    # перегружен», собранной без запроса.
    units = sorted(
        (to_metric(b) for b in unit_buckets.values()),
        key=lambda m: m["safeLabel"],
    )
    employees = sorted(
        (to_metric(b) for b in employee_buckets.values()),
        key=lambda m: m["safeLabel"],
    )
    return {
        "businessDate": business_date.isoformat(),
        "generatedAt": Clock.now().isoformat(),
        "view": {
            "units": units,
            "employees": employees,
            "unlinkedShiftsCount": unlinked,
            "policy": policy,
        },
        "unavailable": LOAD_UNAVAILABLE,
    }


# ── Аналитика ОМ (§22.13-22.15) ─────────────────────────────────────────────


class _OpsPost:
    __slots__ = (
        "post_id", "sector_label", "source_sector_id", "post_label", "need",
        "assigned", "acknowledged",
    )


class _OpsEvent:
    __slots__ = (
        "id", "code", "title", "object_id", "object_name", "business_date",
        "stage_code", "readiness_percent", "conflicts_count",
        "demand_approved", "demand_need_total", "requested_total",
        "allocated_total", "incidents_count", "closed_at", "posts",
    )


def _project_event(event):
    projected = _OpsEvent()
    projected.id = str(event.pk)
    projected.code = event.code
    projected.title = event.title
    projected.object_id = (
        str(event.security_object_id)
        if event.security_object_id is not None
        else None
    )
    projected.object_name = event.object_name
    projected.business_date = event.business_date.isoformat()
    projected.stage_code = event.stage
    projected.readiness_percent = event.readiness_percent
    projected.conflicts_count = event.conflicts_count
    projected.demand_approved = event.demand_approved
    projected.demand_need_total = sum(
        int(row.get("need") or 0) for row in (event.demand_rows or [])
    )
    requests = event.force_requests or []
    projected.requested_total = sum(
        int(r.get("requestedCount") or 0) for r in requests
    )
    projected.allocated_total = sum(
        int(r.get("allocatedCount") or 0) for r in requests
    )
    projected.incidents_count = len([
        entry for entry in (event.journal_entries or [])
        if entry.get("type") == "INCIDENT"
    ])
    projected.closed_at = event.closed_at
    assignments = event.placement_assignments or []
    posts = []
    for row in event.recon_sector_posts or []:
        post = _OpsPost()
        post.post_id = str(row.get("id") or "")
        post.sector_label = str(row.get("sector") or "")
        source_sector = row.get("sourceSectorId")
        post.source_sector_id = (
            source_sector if isinstance(source_sector, str) else None
        )
        post.post_label = str(row.get("post") or "")
        post.need = int(row.get("need") or 0)
        own = [
            a for a in assignments
            if str(a.get("postId") or "") == post.post_id
        ]
        post.assigned = len(own)
        # Ознакомление — СВОЙ счёт, а не доля от назначенных: §22.15
        # запрещает смешивать назначенное с подтверждённым.
        post.acknowledged = len([
            a for a in own if isinstance(a.get("acknowledgedAt"), str)
        ])
        posts.append(post)
    projected.posts = posts
    return projected


def _lifecycle_registry():
    """§22.13 Lifecycle Registry — подписи стадий у их ВЛАДЕЛЬЦА (модель ОМ
    того же пакета): дубль-строка в аналитике разошлась бы молча."""
    return [
        {"stateCode": code, "safeLabel": label}
        for code, label in OpsSecurityEvent.Stage.choices
    ]


def _lifecycle_distribution(events, registry):
    counts = {}
    for event in events:
        counts[event.stage_code] = counts.get(event.stage_code, 0) + 1
    buckets = [
        {
            "stateCode": state["stateCode"],
            "safeLabel": state["safeLabel"],
            "count": counts.get(state["stateCode"], 0),
        }
        for state in registry
    ]
    known = {state["stateCode"] for state in registry}
    unknown = sorted(code for code in counts if code not in known)
    return buckets, unknown


def _cell(column, value):
    return {
        "code": column["code"], "value": value, "unavailableReason": None,
    }


def _event_cells(events):
    posts = [post for event in events for post in event.posts]
    return [
        _cell(OPS_COLUMNS["events"], len(events)),
        # Только УТВЕРЖДЁННАЯ потребность: черновые строки — ещё не
        # обязательство.
        _cell(OPS_COLUMNS["demandNeed"], sum(
            e.demand_need_total for e in events if e.demand_approved
        )),
        _cell(OPS_COLUMNS["requested"], sum(
            e.requested_total for e in events
        )),
        _cell(OPS_COLUMNS["allocated"], sum(
            e.allocated_total for e in events
        )),
        _cell(OPS_COLUMNS["assigned"], sum(p.assigned for p in posts)),
        _cell(OPS_COLUMNS["acknowledged"], sum(
            p.acknowledged for p in posts
        )),
        _cell(OPS_COLUMNS["conflicts"], sum(
            e.conflicts_count for e in events
        )),
        _cell(OPS_COLUMNS["incidents"], sum(
            e.incidents_count for e in events
        )),
    ]


def _columns_for(level):
    """§22.15: набор колонок принадлежит УРОВНЮ — на уровне поста «запрошено»
    неизвестно, и пустая колонка читалась бы как ноль."""
    if level in ("ALL", "OBJECT"):
        return [
            OPS_COLUMNS["events"], OPS_COLUMNS["demandNeed"],
            OPS_COLUMNS["requested"], OPS_COLUMNS["allocated"],
            OPS_COLUMNS["assigned"], OPS_COLUMNS["acknowledged"],
            OPS_COLUMNS["conflicts"], OPS_COLUMNS["incidents"],
        ]
    if level == "EVENT":
        return [
            OPS_COLUMNS["posts"], OPS_COLUMNS["need"],
            OPS_COLUMNS["assigned"], OPS_COLUMNS["acknowledged"],
        ]
    if level == "DIRECTION":
        return [
            OPS_COLUMNS["need"], OPS_COLUMNS["assigned"],
            OPS_COLUMNS["acknowledged"],
        ]
    return [OPS_COLUMNS["assigned"], OPS_COLUMNS["acknowledged"]]


def _direction_id(event_id, post):
    """Всегда содержит id ОМ: одинаково названный сектор в двух мероприятиях
    — ДВА разных направления (§22.15). Строка, заведённая руками, связи с
    сектором паспорта не имеет — и мы её не изображаем."""
    if post.source_sector_id is None:
        return f"{event_id}::local:{post.sector_label}"
    return f"{event_id}::{post.source_sector_id}"


def _direction_label(post):
    if post.source_sector_id is None:
        return f"Сектор {post.sector_label} (расчёт ОМ, без связи с паспортом)"
    return f"Сектор {post.sector_label}"


def _object_rows(events):
    groups = {}
    for event in events:
        key = event.object_id or UNBOUND_OBJECT_ID
        groups.setdefault(key, []).append(event)
    rows = [
        {
            "rowId": object_id,
            "safeLabel": (
                "Объект вне реестра (связь по названию не выводится)"
                if object_id == UNBOUND_OBJECT_ID
                else group[0].object_name
            ),
            "childLevel": "OBJECT",
            "cells": _event_cells(group),
        }
        for object_id, group in groups.items()
    ]
    rows.sort(key=lambda row: row["safeLabel"])
    return rows


def _event_rows(events):
    ordered = sorted(events, key=lambda e: (e.business_date, e.code))
    return [
        {
            "rowId": event.id,
            "safeLabel": f"{event.code} · {event.title}",
            "childLevel": "EVENT",
            "cells": _event_cells([event]),
        }
        for event in ordered
    ]


def _direction_rows(event):
    groups = {}
    for post in event.posts:
        groups.setdefault(_direction_id(event.id, post), []).append(post)
    rows = [
        {
            "rowId": direction,
            "safeLabel": _direction_label(posts[0]),
            "childLevel": "DIRECTION",
            "cells": [
                _cell(OPS_COLUMNS["posts"], len(posts)),
                _cell(OPS_COLUMNS["need"], sum(p.need for p in posts)),
                _cell(OPS_COLUMNS["assigned"], sum(
                    p.assigned for p in posts
                )),
                _cell(OPS_COLUMNS["acknowledged"], sum(
                    p.acknowledged for p in posts
                )),
            ],
        }
        for direction, posts in groups.items()
    ]
    rows.sort(key=lambda row: row["safeLabel"])
    return rows


def _post_rows(event, direction):
    return [
        {
            "rowId": post.post_id,
            "safeLabel": post.post_label,
            "childLevel": "POST",
            "cells": [
                _cell(OPS_COLUMNS["need"], post.need),
                _cell(OPS_COLUMNS["assigned"], post.assigned),
                _cell(OPS_COLUMNS["acknowledged"], post.acknowledged),
            ],
        }
        for post in event.posts
        if _direction_id(event.id, post) == direction
    ]


def _participation_rows(post):
    """Последний уровень §22.15 — АГРЕГИРОВАННЫЕ данные участия, не список
    людей: поимённая детализация требует своего права и здесь не выдаётся."""
    return [
        {
            "rowId": post.post_id,
            "safeLabel": "Участие по посту (агрегированно)",
            "childLevel": None,
            "cells": [
                _cell(OPS_COLUMNS["assigned"], post.assigned),
                _cell(OPS_COLUMNS["acknowledged"], post.acknowledged),
            ],
        }
    ]


def _fact(code, safe_label, display_value, unavailable_reason=None):
    return {
        "code": code,
        "safeLabel": safe_label,
        "displayValue": display_value,
        "unavailableReason": unavailable_reason,
    }


def _event_card(event, registry):
    """§22.15 карточка уровня ОМ: отсутствующие поля приходят С ПРИЧИНОЙ, а
    не нулём и не пустой строкой (§35)."""
    state = next(
        (s for s in registry if s["stateCode"] == event.stage_code), None
    )
    assigned = sum(post.assigned for post in event.posts)
    acknowledged = sum(post.acknowledged for post in event.posts)
    return {
        "eventId": event.id,
        "code": event.code,
        "safeLabel": event.title,
        "facts": [
            _fact("CODE", "Код", event.code),
            _fact(
                "OBJECT", "Объект",
                event.object_name
                if event.object_id is not None
                else f"{event.object_name} — объекта нет в реестре",
            ),
            _fact("PERIOD", "Период", event.business_date),
            _fact(
                "LIFECYCLE", "Состояние жизненного цикла",
                state["safeLabel"]
                if state is not None
                else f"{event.stage_code} — состояния нет в Lifecycle "
                     "Registry",
            ),
            _fact(
                "REVISION", "Revision", "нет данных",
                "Формальной редакции у ОМ в модели нет: изменения пишутся в "
                "саму карточку, версии не нумеруются. Показать «1» значило "
                "бы придумать номер.",
            ),
            _fact(
                "READINESS", "Готовность",
                "нет данных"
                if event.readiness_percent is None
                else f"{event.readiness_percent}%",
            ),
            _fact(
                "DEMAND", "Утверждённая потребность",
                str(event.demand_need_total)
                if event.demand_approved
                else "потребность не утверждена",
            ),
            _fact("REQUESTED", "Запрошено", str(event.requested_total)),
            _fact("ALLOCATED", "Выделено", str(event.allocated_total)),
            _fact("ASSIGNED", "Назначено", str(assigned)),
            _fact(
                "ACTUAL", "Фактически участвовало", "нет данных",
                "Факта участия в ОМ модель не ведёт: отмечается только "
                "ознакомление, а заступление и завершение есть у дежурств, "
                "но не у мероприятий. Приравнять факт к назначению значило "
                "бы записать в участники того, кто мог не выйти.",
            ),
            _fact("ACKNOWLEDGED", "Ознакомлено", str(acknowledged)),
            _fact("CONFLICTS", "Конфликты", str(event.conflicts_count)),
            _fact(
                "INCIDENTS", "Записи об инцидентах",
                str(event.incidents_count),
            ),
            _fact(
                "CLOSURE_READY", "Готовность к закрытию",
                "мероприятие не закрыто"
                if event.closed_at is None
                else "закрыто",
                "Правила «можно ли закрыть» в модели нет — есть только факт "
                "закрытия. Вывести готовность из заполненности итогов "
                "значило бы придумать проверку, которой сервер не делает.",
            ),
        ],
    }


def _breadcrumb_for(level, parts):
    trail = [{"level": "ALL", "id": None, "safeLabel": "Все ОМ"}]
    if level == "ALL":
        return trail
    trail.append({
        "level": "OBJECT", "id": parts.get("objectId"),
        "safeLabel": parts.get("objectLabel", ""),
    })
    if level == "OBJECT":
        return trail
    trail.append({
        "level": "EVENT", "id": parts.get("eventId"),
        "safeLabel": parts.get("eventLabel", ""),
    })
    if level == "EVENT":
        return trail
    trail.append({
        "level": "DIRECTION", "id": parts.get("directionId"),
        "safeLabel": parts.get("directionLabel", ""),
    })
    if level == "DIRECTION":
        return trail
    trail.append({
        "level": "POST", "id": parts.get("postId"),
        "safeLabel": parts.get("postLabel", ""),
    })
    return trail


def _median(values):
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return round((ordered[middle - 1] + ordered[middle]) / 2 * 10) / 10


def _build_funnel(transitions, events, registry):
    """§22.14: воронка ТОЛЬКО по журналу переходов. Интервал этапа — от входа
    в стадию до СЛЕДУЮЩЕГО перехода того же ОМ; незакрытый интервал в среднее
    не попадает — иначе среднее падало бы тем сильнее, чем дольше мероприятие
    висит."""
    by_event = {}
    for transition in transitions:
        by_event.setdefault(str(transition.event_id), []).append(transition)
    for group in by_event.values():
        group.sort(key=lambda t: (t.occurred_at, t.pk))

    current_by_stage = {}
    for event in events:
        current_by_stage[event.stage_code] = (
            current_by_stage.get(event.stage_code, 0) + 1
        )

    stages = []
    for state in registry:
        arrivals = [
            t for t in transitions if t.to_stage == state["stateCode"]
        ]
        durations = []
        for group in by_event.values():
            for index, transition in enumerate(group):
                if transition.to_stage != state["stateCode"]:
                    continue
                if index + 1 >= len(group):
                    continue
                hours = (
                    group[index + 1].occurred_at - transition.occurred_at
                ).total_seconds() / 3600
                if hours >= 0:
                    durations.append(round(hours * 10) / 10)
        average = (
            round(sum(durations) / len(durations) * 10) / 10
            if durations
            else None
        )
        stages.append({
            "stateCode": state["stateCode"],
            "safeLabel": state["safeLabel"],
            "values": {
                # «Достигших» — по РАЗНЫМ ОМ: вернувшееся и снова дошедшее
                # мероприятие достигло этапа один раз, переходов сделало два.
                "REACHED": len({str(t.event_id) for t in arrivals}),
                "CURRENT": current_by_stage.get(state["stateCode"], 0),
                "TRANSITIONS": len(arrivals),
                "RETURNS": len([
                    t for t in arrivals if t.kind == "RETURN"
                ]),
                # §22.14: среднее и медиана — только при готовых серверных
                # значениях; нет ни одного закрытого интервала — null.
                "AVERAGE_HOURS": average,
                "MEDIAN_HOURS": _median(durations),
            },
        })
    return {
        "stages": stages,
        "measures": FUNNEL_MEASURES,
        # Состояний «отменено»/«приостановлено» в модели нет вовсе — сказано
        # вслух, а не изображено пустым фильтром.
        "excludedEventIds": [],
        "exclusionNote": (
            "Состояний «отменено» и «приостановлено» в модели ОМ нет: "
            "исключать из конверсии нечего. Появятся — исключение обязано "
            "считаться здесь, а не на экране."
        ),
        "transitionCount": len(transitions),
    }


def operations_analytics(query):
    """§22.13/§22.15: уровень разрешает СЕРВЕР — он собирает breadcrumb и
    решает, какие колонки сопоставимы на этом уровне."""
    registry = _lifecycle_registry()
    source = [
        _project_event(event) for event in OpsSecurityEvent.objects.all()
    ]
    business_date = Clock.today_local().isoformat()
    level = query.get("level") or "ALL"
    period = {"from": business_date, "to": business_date, "presetCode": None}
    envelope = _base_envelope(
        snapshot_id=build_snapshot_id(
            revision=_ops_revision(), from_date=business_date,
            to_date=business_date,
            scope_id=f"{_SCOPE['scopeId']}:ops:{level}",
        ),
        period=period,
        calculation_version=OPS_CALCULATION_VERSION,
        policy_version=POLICY_VERSION,
    )
    unavailable = list(UNAVAILABLE_OPS_MEASURES)
    transitions = list(OpsSecurityEventTransition.objects.all())

    def funnel_for(events):
        ids = {event.id for event in events}
        return _build_funnel(
            [t for t in transitions if str(t.event_id) in ids],
            events,
            registry,
        )

    if level == "ALL":
        buckets, unknown = _lifecycle_distribution(source, registry)
        envelope["data"] = {
            "level": "ALL",
            "breadcrumb": _breadcrumb_for("ALL", {}),
            "columns": _columns_for("ALL"),
            "rows": _object_rows(source),
            "lifecycleDistribution": buckets,
            "unknownLifecycleCodes": unknown,
            "eventCard": None,
            "funnel": funnel_for(source),
            "funnelUnavailableReason": None,
            "unavailableMeasures": unavailable,
        }
        return envelope

    if level == "OBJECT":
        object_id = query.get("objectId") or ""
        events = [
            e for e in source
            if (e.object_id or UNBOUND_OBJECT_ID) == object_id
        ]
        if not events:
            raise DomainError(
                "UNKNOWN_LEVEL_TARGET", 422, message="Объект не найден.",
            )
        buckets, unknown = _lifecycle_distribution(events, registry)
        envelope["data"] = {
            "level": "OBJECT",
            "breadcrumb": _breadcrumb_for("OBJECT", {
                "objectId": object_id,
                "objectLabel": (
                    "Объект вне реестра (связь по названию не выводится)"
                    if object_id == UNBOUND_OBJECT_ID
                    else events[0].object_name
                ),
            }),
            "columns": _columns_for("OBJECT"),
            "rows": _event_rows(events),
            "lifecycleDistribution": buckets,
            "unknownLifecycleCodes": unknown,
            "eventCard": None,
            "funnel": funnel_for(events),
            "funnelUnavailableReason": None,
            "unavailableMeasures": unavailable,
        }
        return envelope

    event = next(
        (e for e in source if e.id == (query.get("eventId") or "")), None
    )
    if event is None:
        raise DomainError(
            "UNKNOWN_LEVEL_TARGET", 422, message="Мероприятие не найдено.",
        )
    object_key = event.object_id or UNBOUND_OBJECT_ID
    parts = {
        "objectId": object_key,
        "objectLabel": (
            "Объект вне реестра (связь по названию не выводится)"
            if object_key == UNBOUND_OBJECT_ID
            else event.object_name
        ),
        "eventId": event.id,
        "eventLabel": f"{event.code} · {event.title}",
    }

    if level == "EVENT":
        buckets, unknown = _lifecycle_distribution([event], registry)
        envelope["data"] = {
            "level": "EVENT",
            "breadcrumb": _breadcrumb_for("EVENT", parts),
            "columns": _columns_for("EVENT"),
            "rows": _direction_rows(event),
            "lifecycleDistribution": buckets,
            "unknownLifecycleCodes": unknown,
            "eventCard": _event_card(event, registry),
            "funnel": funnel_for([event]),
            "funnelUnavailableReason": None,
            "unavailableMeasures": unavailable,
        }
        return envelope

    direction = query.get("directionId") or ""
    direction_posts = [
        post for post in event.posts
        if _direction_id(event.id, post) == direction
    ]
    if not direction_posts:
        raise DomainError(
            "UNKNOWN_LEVEL_TARGET", 422, message="Направление не найдено.",
        )
    direction_row = next(
        (
            row for row in _direction_rows(event)
            if row["rowId"] == direction
        ),
        None,
    )
    direction_label = (
        direction_row["safeLabel"] if direction_row is not None else direction
    )

    if level == "DIRECTION":
        envelope["data"] = {
            "level": "DIRECTION",
            "breadcrumb": _breadcrumb_for("DIRECTION", {
                **parts,
                "directionId": direction,
                "directionLabel": direction_label,
            }),
            "columns": _columns_for("DIRECTION"),
            "rows": _post_rows(event, direction),
            "lifecycleDistribution": [],
            "unknownLifecycleCodes": [],
            "eventCard": None,
            # Воронка принадлежит МНОЖЕСТВУ мероприятий.
            "funnel": None,
            "funnelUnavailableReason": _NO_FUNNEL_AT_LEVEL,
            "unavailableMeasures": unavailable,
        }
        return envelope

    post = next(
        (
            p for p in direction_posts
            if p.post_id == (query.get("postId") or "")
        ),
        None,
    )
    if post is None:
        raise DomainError(
            "UNKNOWN_LEVEL_TARGET", 422, message="Пост не найден.",
        )
    envelope["data"] = {
        "level": "POST",
        "breadcrumb": _breadcrumb_for("POST", {
            **parts,
            "directionId": direction,
            "directionLabel": direction_label,
            "postId": post.post_id,
            "postLabel": post.post_label,
        }),
        "columns": _columns_for("POST"),
        "rows": _participation_rows(post),
        "lifecycleDistribution": [],
        "unknownLifecycleCodes": [],
        "eventCard": None,
        "funnel": None,
        "funnelUnavailableReason": _NO_FUNNEL_AT_LEVEL,
        "unavailableMeasures": unavailable,
    }
    return envelope


def _ops_revision():
    """Версия данных снимка ОМ: карточки + журнал переходов."""
    stamps = []
    for model in (OpsSecurityEvent, OpsSecurityEventTransition):
        latest = model.objects.order_by("-updated_at").values_list(
            "updated_at", flat=True
        ).first()
        stamps.append(
            f"{model.objects.count()}:"
            f"{latest.isoformat() if latest is not None else '-'}"
        )
    return "|".join(stamps)
