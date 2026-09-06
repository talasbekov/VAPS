// Мок-слой аналитики службы (§22): числа считаются ЗДЕСЬ и только здесь —
// экран печатает готовые `state` и `displayValue`. Источник смен — стор плана
// дежурств (узкая проекция), источник ОМ — стор реестра ОМ, политики (пределы
// периода, пороги нагрузки, политика наблюдений, режим отдыха) — общий стор
// «Настроек»: правка порога там меняет исход расчёта здесь.
//
// Демо-персона хоста — wildcard: серверные проверки прав проходят, drill-down
// и персональная детализация разрешены. Закрытость обеспечивается ФОРМОЙ
// ответов: KPI-ответ не несёт исходных строк, выборка приезжает отдельным
// запросом с проверкой snapshotId.
import { http, HttpResponse } from "msw";
import {
  ANALYTICS_ATTENTION_PATH,
  ANALYTICS_DRILLDOWN_PATH,
  ANALYTICS_PRESETS_PATH,
  ANALYTICS_SNAPSHOT_PATH,
  ATTENTION_POLICY_VERSION,
  CALCULATION_VERSION,
  LOAD_ANALYTICS_PATH,
  METRIC_CODES,
  OPERATIONS_ANALYTICS_PATH,
  OPS_CALCULATION_VERSION,
  POLICY_VERSION,
  UNBOUND_OBJECT_ID,
  applyAttentionPolicy,
  breadcrumbFor,
  buildAttentionItems,
  buildEventCard,
  buildLoadAnalytics,
  buildMetric,
  buildSnapshotId,
  columnsFor,
  decodeCursor,
  detectConflictShiftIds,
  directionId,
  directionRows,
  encodeCursor,
  eventRows,
  inPeriod,
  isResting,
  isUnconfirmed,
  isUnfinishedPast,
  lifecycleDistribution,
  objectRows,
  participationRows,
  postRows,
  resolvePreset,
  toDrilldownRow,
} from "@/entities/service-analytics";
import type {
  AnalyticsPeriod,
  AnalyticsScope,
  AnalyticsSource,
  AnalyticsSourceShift,
  AttentionDetectorDefinition,
  LifecycleStateDefinition,
  MetricDefinition,
  MetricValue,
  OpsLevel,
  OpsSourceEvent,
  PeriodPreset,
} from "@/entities/service-analytics";
import {
  readAnalyticsCustomPeriodLimit,
  readAttentionPolicy,
  readConflictPolicy,
  readLoadPolicy,
} from "./settings-store";
import { readDutyShiftsStore, readDutyTypesRegistry } from "./duties-handlers";
import { readSecurityEventsStore } from "./security-events-handlers";
import { findPersonnel } from "./fixtures/personnel";

const TIMEZONE = "Asia/Almaty";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const DRILLDOWN_PAGE_SIZE = 4;

/** §8.9: RBAC demo-режима плоский — scope один и назван честно. */
const DEMO_SCOPE: AnalyticsScope = {
  scopeType: "DEMO_FLAT",
  scopeId: "demo",
  safeLabel: "Единственная область видимости demo-режима",
};

const CUSTOM_PERIOD_UNAVAILABLE_REASON =
  "Предел произвольного периода не задан политикой — период по датам не принимается. Выберите именованный период.";

// ── Определения (данные «с сервера», не хардкод страницы) ────────────────

/** §22.7 KPI: пороги намеренно не круглые — совпадение с «привычным» числом
 * скрыло бы захардкоженный порог, если бы он где-то остался. */
const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    metricCode: METRIC_CODES.onDuty,
    safeLabel: "На дежурстве",
    unit: "COUNT",
    // Справочный показатель: выдуманный порог сделал бы обычную работу
    // «предупреждением».
    warningFrom: null,
    criticalFrom: null,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.planned,
    safeLabel: "Запланировано смен",
    unit: "COUNT",
    warningFrom: null,
    criticalFrom: null,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.rest,
    safeLabel: "Отдых после дежурства",
    unit: "COUNT",
    warningFrom: null,
    criticalFrom: null,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.unfinished,
    safeLabel: "Незакрытые прошедшие дежурства",
    unit: "COUNT",
    warningFrom: 1,
    criticalFrom: 4,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.hardConflicts,
    safeLabel: "Жёсткие конфликты",
    unit: "COUNT",
    warningFrom: 1,
    criticalFrom: 3,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.softConflicts,
    safeLabel: "Мягкие конфликты",
    unit: "COUNT",
    warningFrom: 2,
    criticalFrom: 6,
    drilldownAvailable: true,
  },
  {
    metricCode: METRIC_CODES.unconfirmed,
    safeLabel: "Неподтверждённое участие",
    unit: "COUNT",
    warningFrom: 1,
    criticalFrom: 5,
    drilldownAvailable: true,
  },
];

/** §22.5 пресеты — «произвольный период» пресетом не является. */
const PERIOD_PRESETS: readonly PeriodPreset[] = [
  { presetCode: "TODAY", safeLabel: "Сегодня", offsetDays: 0, lengthDays: 1 },
  {
    presetCode: "PREV_BUSINESS_DAY",
    safeLabel: "Предыдущий рабочий день",
    offsetDays: -1,
    lengthDays: 1,
  },
  { presetCode: "CURRENT_WEEK", safeLabel: "Текущая неделя", offsetDays: 0, lengthDays: 7 },
  { presetCode: "CURRENT_MONTH", safeLabel: "Текущий месяц", offsetDays: 0, lengthDays: 30 },
];

/** §22.11 методика наблюдений: меры, тексты и маршруты — здесь; ЧИСЛА
 * (допуски и пороги) приходят из раздела «Настройки». */
const ATTENTION_DETECTORS: readonly AttentionDetectorDefinition[] = [
  {
    categoryCode: "ACKNOWLEDGEMENT_MISSING",
    measure: "ACKNOWLEDGEMENT_MISSING",
    titleCode: "VERIFICATION_REQUIRED",
    safeDescriptionTemplate:
      "Записей с ближайшим заступлением без отметки об ознакомлении: {count}. Срок упреждения — {parameter} дн.",
    parameter: 3,
    warningFrom: 1,
    criticalFrom: 4,
    baseSeverity: "INFO",
    targetRoute: "/security-ops/duties",
    targetPermission: "ops.duty.view",
  },
  {
    categoryCode: "CONFLICT_SHARE",
    measure: "CONFLICT_SHARE",
    titleCode: "THRESHOLD_EXCEEDED",
    safeDescriptionTemplate:
      "Доля записей периода с конфликтом планирования — {value}% при серверном пороге. Записей с конфликтом: {count}.",
    parameter: 0,
    warningFrom: 18,
    criticalFrom: 34,
    baseSeverity: "INFO",
    targetRoute: "/security-ops/duties",
    targetPermission: "ops.duty.view",
  },
  {
    categoryCode: "UNFINISHED_OVERDUE",
    measure: "UNFINISHED_OVERDUE",
    titleCode: "UNFINISHED_PROCESSES",
    safeDescriptionTemplate:
      "Записей, не переведённых в завершённое состояние дольше допуска ({parameter} дн.): {count}.",
    parameter: 2,
    warningFrom: 1,
    criticalFrom: 5,
    baseSeverity: "INFO",
    targetRoute: "/security-ops/duties",
    targetPermission: "ops.duty.view",
  },
  {
    categoryCode: "UNCONFIRMED_OVERDUE",
    measure: "UNCONFIRMED_OVERDUE",
    titleCode: "DATA_UNCONFIRMED",
    safeDescriptionTemplate:
      "Записей без подтверждённых отметок фактического времени дольше допуска ({parameter} дн.): {count}.",
    parameter: 2,
    warningFrom: 1,
    criticalFrom: 4,
    baseSeverity: "INFO",
    targetRoute: "/security-ops/duties",
    targetPermission: "ops.duty.view",
  },
  {
    // Утверждение об ИСТОЧНИКЕ: перехода нет намеренно.
    categoryCode: "SOURCE_AGE",
    measure: "SOURCE_AGE",
    titleCode: "SOURCE_NOT_UPDATED",
    safeDescriptionTemplate:
      "Последнее изменение источника — {value} ч назад при допуске {parameter} ч.",
    parameter: 53,
    warningFrom: 53,
    criticalFrom: null,
    baseSeverity: "INFO",
    targetRoute: null,
    targetPermission: null,
  },
];

/** §22.13 Lifecycle Registry ОМ — в данных, а не строкой в коде: код вне
 * реестра приезжает клиенту списком, а не растворяется в корзинах. */
const OPS_LIFECYCLE_REGISTRY: readonly LifecycleStateDefinition[] = [
  { stateCode: "BULLETIN", safeLabel: "Бюллетень" },
  { stateCode: "RECON", safeLabel: "Рекогносцировка" },
  { stateCode: "DEMAND", safeLabel: "Потребность" },
  { stateCode: "FORCES", safeLabel: "Запрос сил" },
  { stateCode: "PLACEMENT", safeLabel: "Расстановка" },
  { stateCode: "APPROVAL", safeLabel: "Согласование" },
  { stateCode: "ACKNOWLEDGEMENT", safeLabel: "Ознакомление" },
  { stateCode: "CONDUCT", safeLabel: "Проведение" },
  { stateCode: "CLOSED", safeLabel: "Закрыто" },
];

// ── §35-блоки ────────────────────────────────────────────────────────────

const UNAVAILABLE_METRICS = [
  {
    code: "HEADCOUNT",
    label: "Активный личный состав в scope",
    reason:
      "Численность приходит из кадрового источника, которого у раздела ОМ нет. Выводить число из числа сотрудников, попавших в смены, значило бы назвать личным составом тех, кого поставили в наряд.",
  },
  {
    code: "AVAILABILITY",
    label: "Доступно для назначения",
    reason:
      "Доступность складывается из кадровой недоступности (отпуск, больничный, командировка), которой в demo-модели нет. Разница «все минус дежурящие» — не доступность, а её видимость.",
  },
  {
    code: "SECURITY_EVENT_ENGAGED",
    label: "Участвует в ОМ",
    reason:
      "Расстановка ОМ ведёт назначения в своём пространстве идентификаторов, а дежурства — в своём; склейка по ФИО дала бы ложные совпадения, и число нельзя было бы перепроверить.",
  },
];

const UNAVAILABLE_HEADER_BLOCKS = [
  {
    code: "SCOPE_FILTER",
    label: "Выбор scope и подразделения",
    reason:
      "RBAC demo-режима плоский, без организационного scope: выбирать не из чего, а список из одного пункта «вся организация» изображал бы выбор, которого нет.",
  },
  {
    code: "EXPORT",
    label: "Экспорт аналитики из шапки",
    reason:
      "Выгрузка — отдельный раздел со своей очередью и артефактами (отчёты службы — следующая очередь порта): вторая кнопка экспорта создала бы второй путь к тем же файлам мимо истории.",
  },
];

const UNAVAILABLE_DETECTORS = [
  {
    code: "WORKLOAD_EXCESS",
    label: "Превышение нормы нагрузки",
    reason:
      "Пороги нагрузки живут в «Настройках» (LOAD_POLICY), и блок «Нагрузка» считается по ним, — но наблюдение §22.11 требует СВОЕГО детектора со своей политикой внимания. Дублировать состояние блока значило бы выдать перестановку показателя за наблюдение.",
  },
  {
    code: "ABSENCE_PATTERN",
    label: "Отклонения по кадровой недоступности",
    reason:
      "Кадровой недоступности (отпуск, больничный, командировка) в модели нет, а наблюдение о больничных без источника было бы обвинительным выводом, который §22.11 запрещает.",
  },
];

const LOAD_UNAVAILABLE = [
  {
    code: "NIGHT_MINUTES",
    label: "Ночные часы",
    reason:
      "Граница дневной и ночной работы — открытый вопрос промпта (NIGHT-WINDOW-001): источника окна нет, и завести его решением фронта значило бы закрыть чужой вопрос молча. Ночные минуты едут null, а не нулём.",
  },
  {
    code: "SECURITY_EVENT_LOAD",
    label: "Нагрузка от охранных мероприятий",
    reason:
      "Назначения расстановки ОМ не несут интервалов времени — складывать их с минутами смен не из чего. Слагаемое отсутствует, а не подменено допущением.",
  },
  {
    code: "REST_AND_REPLACEMENTS",
    label: "Отдых, замены и неподтверждённые факты",
    reason:
      "Отдельных read model отдыха и замен в demo-срезе нет. Считать их из смен косвенно значило бы выдать вывод за данные.",
  },
];

const UNAVAILABLE_OPS_MEASURES = [
  {
    code: "OVERDUE_ACTIONS",
    label: "Просроченные действия",
    reason:
      "Сроков у действий ОМ модель не хранит: есть дата проведения, но нет плановых сроков этапов. Просрочка без срока — не измерение.",
  },
  {
    code: "CANCELLED_COUNT",
    label: "Количество отменённых ОМ (§22.14)",
    reason:
      "Состояний «отменено» и «приостановлено» у мероприятия нет. Показать ноль значило бы утверждать, что отмен не было, — а мы утверждаем лишь, что их негде записать.",
  },
  {
    code: "OPEN_INCIDENTS",
    label: "Открытые инциденты",
    reason:
      "Записи журнала штаба типа «инцидент» не имеют состояния «открыт/закрыт» — их можно посчитать, но нельзя разделить.",
  },
  {
    code: "ACTUAL_PARTICIPATION",
    label: "Фактическое участие",
    reason:
      "Факт участия в ОМ не фиксируется: отмечается только ознакомление. Приравнять факт к назначению — записать в участники того, кто мог не выйти.",
  },
];

const NO_FUNNEL_AT_LEVEL =
  "Воронка §22.14 строится по множеству мероприятий: на уровне направления и поста множества нет.";

// ── Источники (узкие проекции чужих сторов) ──────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Бизнес-дата — локальная (машины в +05 прячут UTC-полночь баги). */
function businessDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Смены из стора плана дежурств. Подразделение — из кадрового снимка ростера
 * (имя подразделения служит и ключом, и подписью: своего справочника
 * подразделений у demo-среза нет). */
function readSource(): AnalyticsSource | null {
  let shiftsRaw;
  try {
    shiftsRaw = readDutyShiftsStore();
  } catch {
    return null;
  }
  const unitLabels: Record<string, string> = {};
  const shifts: AnalyticsSourceShift[] = shiftsRaw.map((shift) => {
    const person = shift.employeeId === null ? undefined : findPersonnel(shift.employeeId);
    const unitId = person?.unit ?? null;
    if (unitId !== null) unitLabels[unitId] = unitId;
    return {
      id: shift.id,
      businessDate: shift.businessDate,
      employeeName: shift.employeeName,
      employeeId: shift.employeeId,
      unitId,
      objectLabel: shift.target.safeLabel,
      stateCode: shift.stateCode,
      dutyTypeCode: shift.dutyTypeCode,
      actualStart: shift.actualStart,
      actualEnd: shift.actualEnd,
      updatedAt: shift.updatedAt,
    };
  });
  return {
    shifts,
    dutyTypes: readDutyTypesRegistry().map((type) => ({
      dutyTypeCode: type.dutyTypeCode,
      restAfterMinutes: type.restAfterMinutes,
      defaultDurationMinutes: type.defaultDurationMinutes,
    })),
    // Режим отдыха — ТА ЖЕ политика, что у плана дежурств: один конфликт не
    // должен быть жёстким на плане и мягким в аналитике.
    restMode: readConflictPolicy().restAfterDutyMode,
    unitLabels,
  };
}

/** ОМ из стора реестра. */
function readOpsSource(): OpsSourceEvent[] | null {
  try {
    const events = readSecurityEventsStore();
    return events.map((event) => ({
      id: event.id,
      code: event.code,
      title: event.title,
      objectId: event.objectId,
      objectName: event.objectName,
      businessDate: event.businessDate,
      stageCode: event.stage,
      readinessPercent: event.readinessPercent ?? null,
      conflictsCount: event.conflictsCount,
      demandApproved: event.demandApproved === true,
      demandNeedTotal: event.demandRows.reduce((total, row) => total + row.need, 0),
      requestedTotal: event.forceRequests.reduce(
        (total, request) => total + request.requestedCount,
        0
      ),
      allocatedTotal: event.forceRequests.reduce(
        (total, request) => total + request.allocatedCount,
        0
      ),
      incidentsCount: event.journalEntries.filter((entry) => entry.type === "INCIDENT")
        .length,
      closedAt: event.closedAt,
      posts: event.reconSectorPosts.map((post) => {
        const own = event.placementAssignments.filter(
          (assignment) => assignment.postId === post.id
        );
        return {
          postId: post.id,
          sectorLabel: post.sector,
          sourceSectorId: post.sourceSectorId,
          postLabel: post.post,
          need: post.need,
          assigned: own.length,
          // Ознакомление — СВОЙ счёт, не доля от назначенных (§22.15).
          acknowledged: own.filter((assignment) => assignment.acknowledgedAt !== null)
            .length,
        };
      }),
    }));
  } catch {
    return null;
  }
}

/** «Ревизия» данных для детерминированного snapshotId: последний updatedAt
 * источника — изменение смен даёт новый снимок, и устаревший drill-down
 * честно получает отказ. */
function sourceRevision(source: AnalyticsSource | null): string {
  if (source === null) return "no-source";
  const latest = source.shifts.reduce(
    (max, shift) => (shift.updatedAt > max ? shift.updatedAt : max),
    ""
  );
  return latest === "" ? "empty" : latest.replace(/[:.]/g, "");
}

function errorEnvelope(errorCode: string, message: string, status: number) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details: {},
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

function periodDays(from: string, to: string): number {
  const toUtc = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Пустая строка и отсутствующий параметр — одно и то же. */
function param(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

class PeriodError extends Error {
  readonly errorCode: string;
  constructor(errorCode: string, message: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

/** §22.5: период считает СЕРВЕР — код пресета либо даты, но не то и другое. */
function resolvePeriod(request: {
  presetCode: string | null;
  from: string;
  to: string;
}): AnalyticsPeriod {
  if (request.presetCode !== null) {
    const preset = PERIOD_PRESETS.find(
      (item) => item.presetCode === request.presetCode
    );
    if (preset === undefined) {
      throw new PeriodError("UNKNOWN_PERIOD_PRESET", "Неизвестный период.");
    }
    const { from, to } = resolvePreset(preset, businessDate());
    return { from, to, presetCode: preset.presetCode };
  }
  const { from, to } = request;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new PeriodError("INVALID_PERIOD", "Укажите период в формате ГГГГ-ММ-ДД.");
  }
  if (from > to) {
    throw new PeriodError("INVALID_PERIOD", "Начало периода позже его конца.");
  }
  // §22.5: предел произвольного периода приходит из «Настроек» — аналитика его
  // читает, но не задаёт.
  const limit = readAnalyticsCustomPeriodLimit();
  if (limit === null) {
    throw new PeriodError("PERIOD_LIMIT_UNAVAILABLE", CUSTOM_PERIOD_UNAVAILABLE_REASON);
  }
  if (periodDays(from, to) > limit.maxDays) {
    throw new PeriodError(
      "PERIOD_TOO_LONG",
      `Период аналитики не может превышать ${limit.maxDays} дней.`
    );
  }
  return { from, to, presetCode: null };
}

/**
 * Выборки за показателями: возвращаются ИДЕНТИФИКАТОРЫ смен — число
 * показателя получается длиной выборки, а не считается отдельно (§22.12).
 */
function buildSelections(
  source: AnalyticsSource,
  period: AnalyticsPeriod,
  date: string
): Map<string, string[]> {
  const inRange = source.shifts.filter((shift) =>
    inPeriod(shift.businessDate, period.from, period.to)
  );
  const typeByCode = new Map(source.dutyTypes.map((type) => [type.dutyTypeCode, type]));
  const conflicts = detectConflictShiftIds(inRange, source.dutyTypes, source.restMode);

  return new Map<string, string[]>([
    [METRIC_CODES.onDuty, inRange.filter((s) => s.stateCode === "ACTIVE").map((s) => s.id)],
    [
      METRIC_CODES.planned,
      inRange
        .filter((s) => s.stateCode === "PLANNED" || s.stateCode === "ACKNOWLEDGED")
        .map((s) => s.id),
    ],
    [
      METRIC_CODES.rest,
      // Отдых — по ВСЕМУ набору смен: дежурство перед началом периода
      // продолжает давать отдых внутри него.
      source.shifts
        .filter((s) => isResting(s, typeByCode.get(s.dutyTypeCode), date))
        .map((s) => s.id),
    ],
    [
      METRIC_CODES.unfinished,
      inRange.filter((s) => isUnfinishedPast(s, date)).map((s) => s.id),
    ],
    [METRIC_CODES.hardConflicts, conflicts.hard],
    [METRIC_CODES.softConflicts, conflicts.soft],
    [METRIC_CODES.unconfirmed, inRange.filter(isUnconfirmed).map((s) => s.id)],
  ]);
}

// ── Handlers ─────────────────────────────────────────────────────────────

//: Ветка §22.26 «персональная детализация подавлена» — включается окружением.
/**
 * Подавлять ли персональную детализацию в выборке (§22.26, Plane №839).
 *
 * 🔴 ЗАЧЕМ ПЕРЕКЛЮЧАТЕЛЬ, А НЕ ПРАВО. На сервере ветка решается правом
 * `analytics.personal_detail` (`apps/ops/analytics.py`): нет права — строки
 * приходят БЕЗ сотрудника, и это делает СЕРВЕР, а не вёрстка. Мок прав не
 * знает вовсе: ручка `/api/operations/my-permissions/` в мок-слое не
 * реализована намеренно, права приезжают с живого бэка. Поэтому мок берёт
 * ветку из окружения — тем же приёмом, что и выбор доменов
 * (`NEXT_PUBLIC_OPS_MOCK_DOMAINS`).
 *
 * До №839 здесь стояло жёсткое `false`, и ветка подавления не воспроизводилась
 * НИКОГДА: мок был зелен и тогда, когда живой сервер детализацию подавляет, а
 * проба, снятая с мок-стенда, запинила бы выдуманную полноту как факт.
 *
 * Поднять ветку: `NEXT_PUBLIC_OPS_MOCK_PERSONAL_DETAIL=suppressed`.
 */
const PERSONAL_DETAIL_SUPPRESSED =
  process.env.NEXT_PUBLIC_OPS_MOCK_PERSONAL_DETAIL === "suppressed";

/** Текст причины — ДОСЛОВНО серверный (`_PERSONAL_DETAIL_REASON`): экран
 *  печатает его как есть, и расхождение здесь было бы расхождением контракта. */
const PERSONAL_DETAIL_REASON =
  "У вас нет права на персональную детализацию: строки показаны без " +
  "сотрудника (§22.26). Сервер их не присылает — скрывать ФИО в вёрстке " +
  "значило бы всё равно отдать его браузеру.";

export const analyticsHandlers = [
  // §22.5 пресеты и предел произвольного периода.
  http.get(`*${ANALYTICS_PRESETS_PATH}`, () => {
    const limit = readAnalyticsCustomPeriodLimit();
    return HttpResponse.json({
      results: PERIOD_PRESETS.map((preset) => ({ ...preset })),
      maxCustomPeriodDays: limit?.maxDays ?? null,
      limitPolicyVersion: limit?.policyVersion ?? null,
      customPeriodUnavailableReason:
        limit === null ? CUSTOM_PERIOD_UNAVAILABLE_REASON : null,
      defaultPresetCode: PERIOD_PRESETS[0].presetCode,
    });
  }),

  // §22.4 снимок показателей.
  http.get(`*${ANALYTICS_SNAPSHOT_PATH}`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    let period: AnalyticsPeriod;
    try {
      period = resolvePeriod({
        presetCode: param(params.get("preset")),
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
      });
    } catch (error) {
      if (error instanceof PeriodError)
        return errorEnvelope(error.errorCode, error.message, 422);
      throw error;
    }
    const source = readSource();
    const date = businessDate();

    let metrics: MetricValue[];
    if (source === null) {
      // §35: отсутствие источника — UNKNOWN и null, а НЕ ноль.
      metrics = METRIC_DEFINITIONS.map((definition) => buildMetric(definition, null));
    } else {
      const selections = buildSelections(source, period, date);
      metrics = METRIC_DEFINITIONS.map((definition) =>
        buildMetric(definition, selections.get(definition.metricCode)?.length ?? null)
      );
    }

    const sourceUpdatedAt =
      source === null || source.shifts.length === 0
        ? null
        : source.shifts.reduce(
            (latest, shift) => (shift.updatedAt > latest ? shift.updatedAt : latest),
            ""
          );

    return HttpResponse.json({
      snapshotId: buildSnapshotId({
        revision: sourceRevision(source),
        from: period.from,
        to: period.to,
        scopeId: DEMO_SCOPE.scopeId,
      }),
      businessDate: date,
      timezone: TIMEZONE,
      period,
      scope: DEMO_SCOPE,
      generatedAt: nowIso(),
      sourceUpdatedAt: sourceUpdatedAt === "" ? null : sourceUpdatedAt,
      // Водяного знака источника в demo-срезе нет — врать в поле нечем.
      sourceWatermark: null,
      freshnessState: source === null ? "UNKNOWN" : "CURRENT",
      completenessState: source === null ? "INCOMPLETE" : "COMPLETE",
      calculationVersion: CALCULATION_VERSION,
      policyVersion: POLICY_VERSION,
      data: {
        metrics,
        unavailableMetrics: UNAVAILABLE_METRICS.map((metric) => ({ ...metric })),
      },
      unavailableHeaderBlocks: UNAVAILABLE_HEADER_BLOCKS.map((block) => ({ ...block })),
      // Демо-персона wildcard: раскрытие разрешено. Право отдельное (§22.26),
      // и решает его сервер — поле остаётся в контракте.
      drilldownAllowed: true,
      drilldownDeniedReason: null,
    });
  }),

  // §22.12 выборка показателя: snapshotId сверяется со снимком «сейчас».
  http.get(`*${ANALYTICS_DRILLDOWN_PATH}`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    let period: AnalyticsPeriod;
    try {
      period = resolvePeriod({
        presetCode: param(params.get("preset")),
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
      });
    } catch (error) {
      if (error instanceof PeriodError)
        return errorEnvelope(error.errorCode, error.message, 422);
      throw error;
    }
    const source = readSource();
    if (source === null) {
      return errorEnvelope(
        "CALCULATION_UNAVAILABLE",
        "Источник данных недоступен — показатель не рассчитан, раскрывать нечего.",
        422
      );
    }
    const date = businessDate();
    const snapshotId = buildSnapshotId({
      revision: sourceRevision(source),
      from: period.from,
      to: period.to,
      scopeId: DEMO_SCOPE.scopeId,
    });
    // Данные могли измениться между показом KPI и раскрытием — молча подменять
    // выборку нельзя.
    if ((params.get("snapshot_id") ?? "") !== snapshotId) {
      return errorEnvelope(
        "SNAPSHOT_OUTDATED",
        "Данные изменились с момента показа показателя. Обновите аналитику и раскройте показатель заново.",
        422
      );
    }
    const metricCode = params.get("metric_code") ?? "";
    const selections = buildSelections(source, period, date);
    const ids = selections.get(metricCode);
    if (ids === undefined) {
      return errorEnvelope("UNKNOWN_METRIC", "Неизвестный показатель.", 422);
    }
    const byId = new Map(source.shifts.map((shift) => [shift.id, shift]));
    const offset = decodeCursor(param(params.get("cursor")));
    const pageIds = ids.slice(offset, offset + DRILLDOWN_PAGE_SIZE);
    const rows = pageIds
      .map((id) => byId.get(id))
      .filter((shift): shift is AnalyticsSourceShift => shift !== undefined)
      // Персональная детализация — та же ветка, что у сервера: при подавлении
      // ФИО не «скрывается», а НЕ ПРИСЫЛАЕТСЯ (`employeeLabel: null`).
      .map((shift) => toDrilldownRow(shift, !PERSONAL_DETAIL_SUPPRESSED));
    const nextOffset = offset + DRILLDOWN_PAGE_SIZE;

    return HttpResponse.json({
      snapshotId,
      businessDate: date,
      timezone: TIMEZONE,
      period,
      scope: DEMO_SCOPE,
      generatedAt: nowIso(),
      sourceUpdatedAt: null,
      sourceWatermark: null,
      freshnessState: "CURRENT",
      completenessState: "COMPLETE",
      calculationVersion: CALCULATION_VERSION,
      policyVersion: POLICY_VERSION,
      data: {
        metricCode,
        rows,
        nextCursor: nextOffset < ids.length ? encodeCursor(nextOffset) : null,
        totalCount: ids.length,
        personalDetailSuppressed: PERSONAL_DETAIL_SUPPRESSED,
        personalDetailReason: PERSONAL_DETAIL_SUPPRESSED
          ? PERSONAL_DETAIL_REASON
          : null,
      },
    });
  }),

  // §22.11 «Требует внимания»: свой проход по источнику, своя политика.
  http.get(`*${ANALYTICS_ATTENTION_PATH}`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    let period: AnalyticsPeriod;
    try {
      period = resolvePeriod({
        presetCode: param(params.get("preset")),
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
      });
    } catch (error) {
      if (error instanceof PeriodError)
        return errorEnvelope(error.errorCode, error.message, 422);
      throw error;
    }
    const source = readSource();
    const date = businessDate();
    const generatedAt = nowIso();
    const snapshotId = buildSnapshotId({
      revision: sourceRevision(source),
      from: period.from,
      to: period.to,
      scopeId: DEMO_SCOPE.scopeId,
    });
    // Числа политики — из «Настроек»: после правки порога блок обязан
    // считаться по-новому и нести НОВУЮ policyVersion.
    const policy = readAttentionPolicy();
    const detectors = applyAttentionPolicy(ATTENTION_DETECTORS, policy);
    const unavailableReason =
      source === null
        ? "Источник наблюдений недоступен: детекторы §22.11 не отработали. Пустой блок здесь означал бы «замечаний нет» — утверждение, которого сервер не делал."
        : policy === null || detectors.length === 0
          ? "Политика наблюдений §22.11 не загружена: раздел «Настройки» не отдал допуски и пороги, а без них детекторы не запускались."
          : null;

    return HttpResponse.json({
      snapshotId,
      businessDate: date,
      timezone: TIMEZONE,
      period,
      scope: DEMO_SCOPE,
      generatedAt,
      sourceUpdatedAt: null,
      sourceWatermark: null,
      freshnessState: source === null ? "UNKNOWN" : "CURRENT",
      completenessState: unavailableReason === null ? "COMPLETE" : "INCOMPLETE",
      calculationVersion: CALCULATION_VERSION,
      policyVersion: policy?.policyVersion ?? ATTENTION_POLICY_VERSION,
      data: {
        items:
          source === null || unavailableReason !== null
            ? []
            : buildAttentionItems(detectors, source, {
                from: period.from,
                to: period.to,
                businessDate: date,
                generatedAt,
                snapshotId,
                scopeLabel: DEMO_SCOPE.safeLabel,
                policyVersion: policy?.policyVersion ?? ATTENTION_POLICY_VERSION,
              }),
        detectionState: unavailableReason === null ? "COMPLETE" : "UNAVAILABLE",
        detectionUnavailableReason: unavailableReason,
        unavailableDetectors: UNAVAILABLE_DETECTORS.map((detector) => ({ ...detector })),
      },
    });
  }),

  // §22.9 нагрузка: периодом владеет политика — параметров запроса нет.
  http.get(`*${LOAD_ANALYTICS_PATH}`, () => {
    const source = readSource();
    if (source === null) {
      return errorEnvelope(
        "SOURCE_UNAVAILABLE",
        "Источник смен недоступен: нагрузку посчитать не из чего.",
        422
      );
    }
    const policy = readLoadPolicy();
    return HttpResponse.json({
      businessDate: businessDate(),
      generatedAt: nowIso(),
      view: buildLoadAnalytics(source, policy, businessDate()),
      unavailable: LOAD_UNAVAILABLE.map((item) => ({ ...item })),
    });
  }),

  // §22.13/§22.15 аналитика ОМ: уровень разрешает СЕРВЕР.
  http.get(`*${OPERATIONS_ANALYTICS_PATH}`, ({ request }) => {
    const params = new URL(request.url).searchParams;
    const level = (param(params.get("level")) ?? "ALL") as OpsLevel;
    const date = businessDate();
    const source = readOpsSource();
    const registry = OPS_LIFECYCLE_REGISTRY;

    const period: AnalyticsPeriod = { from: date, to: date, presetCode: null };
    const base = {
      snapshotId: buildSnapshotId({
        revision: sourceRevision(null),
        from: date,
        to: date,
        scopeId: `${DEMO_SCOPE.scopeId}:ops:${level}`,
      }),
      businessDate: date,
      timezone: TIMEZONE,
      period,
      scope: DEMO_SCOPE,
      generatedAt: nowIso(),
      sourceUpdatedAt: null,
      sourceWatermark: null,
      calculationVersion: OPS_CALCULATION_VERSION,
      policyVersion: POLICY_VERSION,
    };

    const unavailableMeasures = UNAVAILABLE_OPS_MEASURES.map((measure) => ({
      ...measure,
    }));

    if (source === null) {
      return HttpResponse.json({
        ...base,
        freshnessState: "UNKNOWN",
        completenessState: "INCOMPLETE",
        data: {
          level: "ALL",
          breadcrumb: breadcrumbFor("ALL", {}),
          columns: columnsFor("ALL"),
          rows: [],
          lifecycleDistribution: [],
          unknownLifecycleCodes: [],
          eventCard: null,
          funnel: null,
          funnelUnavailableReason:
            "Источник мероприятий недоступен — журнала переходов тоже нет. Воронка не строится.",
          unavailableMeasures: [
            {
              code: "SOURCE",
              label: "Источник мероприятий",
              reason:
                "Стор охранных мероприятий недоступен: ни уровни, ни распределение по состояниям не построены. Пустая таблица здесь означала бы «мероприятий нет».",
            },
            ...unavailableMeasures,
          ],
        },
      });
    }

    // §22.14: воронка строится по журналу переходов, которого host-стор ОМ не
    // ведёт (стадии переписываются на месте). Причина названа вслух, а не
    // изображена нулями по текущим стадиям.
    const funnelUnavailable = {
      funnel: null,
      funnelUnavailableReason:
        "Журнала переходов стадий в сторе ОМ нет: стадия переписывается на месте, событий перехода не остаётся. Построить воронку по текущим стадиям нельзя — §22.14 требует событий перехода.",
    };

    const byId = new Map(source.map((event) => [event.id, event]));

    if (level === "ALL") {
      const { buckets, unknownCodes } = lifecycleDistribution(source, registry);
      return HttpResponse.json({
        ...base,
        freshnessState: "CURRENT",
        completenessState: "COMPLETE",
        data: {
          level: "ALL",
          breadcrumb: breadcrumbFor("ALL", {}),
          columns: columnsFor("ALL"),
          rows: objectRows(source),
          lifecycleDistribution: buckets,
          unknownLifecycleCodes: unknownCodes,
          eventCard: null,
          ...funnelUnavailable,
          unavailableMeasures,
        },
      });
    }

    if (level === "OBJECT") {
      const objectId = params.get("object_id") ?? "";
      const events = source.filter(
        (event) => (event.objectId ?? UNBOUND_OBJECT_ID) === objectId
      );
      if (events.length === 0) {
        return errorEnvelope("UNKNOWN_LEVEL_TARGET", "Объект не найден.", 422);
      }
      const { buckets, unknownCodes } = lifecycleDistribution(events, registry);
      return HttpResponse.json({
        ...base,
        freshnessState: "CURRENT",
        completenessState: "COMPLETE",
        data: {
          level: "OBJECT",
          breadcrumb: breadcrumbFor("OBJECT", {
            objectId,
            objectLabel:
              objectId === UNBOUND_OBJECT_ID
                ? "Объект вне реестра (связь по названию не выводится)"
                : events[0].objectName,
          }),
          columns: columnsFor("OBJECT"),
          rows: eventRows(events),
          lifecycleDistribution: buckets,
          unknownLifecycleCodes: unknownCodes,
          eventCard: null,
          ...funnelUnavailable,
          unavailableMeasures,
        },
      });
    }

    const event = byId.get(params.get("event_id") ?? "");
    if (event === undefined) {
      return errorEnvelope("UNKNOWN_LEVEL_TARGET", "Мероприятие не найдено.", 422);
    }
    const objectKey = event.objectId ?? UNBOUND_OBJECT_ID;
    const parts = {
      objectId: objectKey,
      objectLabel:
        objectKey === UNBOUND_OBJECT_ID
          ? "Объект вне реестра (связь по названию не выводится)"
          : event.objectName,
      eventId: event.id,
      eventLabel: `${event.code} · ${event.title}`,
    };

    if (level === "EVENT") {
      const { buckets, unknownCodes } = lifecycleDistribution([event], registry);
      return HttpResponse.json({
        ...base,
        freshnessState: "CURRENT",
        completenessState: "COMPLETE",
        data: {
          level: "EVENT",
          breadcrumb: breadcrumbFor("EVENT", parts),
          columns: columnsFor("EVENT"),
          rows: directionRows(event),
          lifecycleDistribution: buckets,
          unknownLifecycleCodes: unknownCodes,
          eventCard: buildEventCard(event, registry),
          ...funnelUnavailable,
          unavailableMeasures,
        },
      });
    }

    const direction = params.get("direction_id") ?? "";
    const directionPosts = event.posts.filter(
      (post) => directionId(event.id, post) === direction
    );
    if (directionPosts.length === 0) {
      return errorEnvelope("UNKNOWN_LEVEL_TARGET", "Направление не найдено.", 422);
    }
    const directionRow = directionRows(event).find((row) => row.rowId === direction);

    if (level === "DIRECTION") {
      return HttpResponse.json({
        ...base,
        freshnessState: "CURRENT",
        completenessState: "COMPLETE",
        data: {
          level: "DIRECTION",
          breadcrumb: breadcrumbFor("DIRECTION", {
            ...parts,
            directionId: direction,
            directionLabel: directionRow?.safeLabel ?? direction,
          }),
          columns: columnsFor("DIRECTION"),
          rows: postRows(event, direction),
          lifecycleDistribution: [],
          unknownLifecycleCodes: [],
          eventCard: null,
          funnel: null,
          funnelUnavailableReason: NO_FUNNEL_AT_LEVEL,
          unavailableMeasures,
        },
      });
    }

    const post = directionPosts.find((item) => item.postId === (params.get("post_id") ?? ""));
    if (post === undefined) {
      return errorEnvelope("UNKNOWN_LEVEL_TARGET", "Пост не найден.", 422);
    }
    return HttpResponse.json({
      ...base,
      freshnessState: "CURRENT",
      completenessState: "COMPLETE",
      data: {
        level: "POST",
        breadcrumb: breadcrumbFor("POST", {
          ...parts,
          directionId: direction,
          directionLabel: directionRow?.safeLabel ?? direction,
          postId: post.postId,
          postLabel: post.postLabel,
        }),
        columns: columnsFor("POST"),
        rows: participationRows(post),
        lifecycleDistribution: [],
        unknownLifecycleCodes: [],
        eventCard: null,
        funnel: null,
        funnelUnavailableReason: NO_FUNNEL_AT_LEVEL,
        unavailableMeasures,
      },
    });
  }),
];
