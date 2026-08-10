// Реестр экранов, под которыми НЕТ бэкенда.
//
// Раздел «Охранные мероприятия» (/security-ops/*) и встроенная SPA (/ops)
// написаны под другой бэкенд и живут на MSW-моках: браузерный воркер отвечает
// 200 на каждый /api/ops/*, поэтому экран выглядит рабочим. Ни один из этих
// путей не резолвится ни целевым бэком (organization_management, резолвер
// Django), ни донором (Backend/VAPS/schema.yaml).
//
// Пустой список или нули на месте отсутствующего бэка — хуже ошибки: дыру
// найдут в проде. Поэтому каждый такой экран несёт видимую пометку с именем
// недостающего пути (см. components/api-gap-notice.tsx, врезка в
// components/dashboard-layout.tsx).
//
// Сводка целиком: docs/api-gaps.md в корне worktree.

import { isOpsCombatLive, isOpsDutiesLive, isOpsObjectsLive, isOpsSecurityEventsLive } from "@/lib/ops-env";

export interface ApiGap {
  /** Что на экране не обеспечено бэком. */
  readonly subject: string;
  /** Пути, которых нет ни в целевом бэке, ни в доноре. */
  readonly paths: readonly string[];
  /** Уточнение: чем экран наполнен вместо живых данных. */
  readonly note?: string;
}

const MOCK_NOTE =
  "Всё, что показано ниже, отдаёт браузерный мок-слой MSW, а не сервер.";

// Ключ — префикс маршрута. Совпадение ищется от самого длинного к самому
// короткому, поэтому вложенные экраны могут уточнять родительскую запись.
const GAPS: Readonly<Record<string, ApiGap>> = {
  "/feedback": {
    subject: "Обратная связь",
    paths: ["/api/dictionaries/feedback/"],
    note: "Бэкенд отдаёт 404: в /api/dictionaries/ есть только positions, ranks и status_types.",
  },
  "/ops": {
    subject: "Встроенная SPA раздела ОМ",
    paths: [
      "/api/ops/*",
      "/api/operations/expense-reports/",
    ],
    note:
      "SPA работает на собственном MSW-воркере. /api/core/staffing-slots/ и " +
      "/api/documents/attachments/ на бэке уже есть — SPA их пока не читает; " +
      "из перечисленного не резолвятся только /api/ops/* и expense-reports.",
  },

  "/security-ops": {
    subject: "Раздел «Охранные мероприятия»",
    paths: ["/api/ops/*"],
    note: MOCK_NOTE,
  },
  // Командный центр и Реестр ОМ: бэк ГОТОВ (срез B1 — реестр, карточка,
  // жизненный цикл всех девяти стадий, кадровый снимок). Записи собираются в
  // findApiGap — как у объектов, они зависят от режима.

  // «Объекты и паспорта»: бэк ГОТОВ целиком (срез A2 — конверт списка с
  // kpi/freshness/политикой, PATCH черновика, POST публикации версии).
  // В live-режиме (NEXT_PUBLIC_OPS_LIVE_DOMAINS=objects) врезки нет вовсе;
  // в mock-режиме врезка обязана остаться — экран показывает данные MSW, и
  // молчать об этом значило бы выдать демо за прод, — но говорит правду:
  // не «на бэке нет», а «экран на моке по конфигурации». Запись собирается в
  // findApiGap, потому что зависит от режима, а GAPS — статичный словарь.

  // «План дежурств»: бэк ГОТОВ (срез C1 — виды+политика, месячный план с
  // конфликтами и action policy, смены с циклом исполнения, объекты и
  // кандидаты формы). Запись строится в findApiGap — зависит от режима.

  // «Боевые группы»: бэк ГОТОВ (срез C2 — реестры видов/Трасс, кандидаты из
  // живых кадров, смены с процессом §24.1 целиком). Запись — в findApiGap.

  // «Календарь смен»: оба источника (duty-shifts срез C1, combat-duty-shifts
  // срез C2) живые — запись собирается в findApiGap по режимам обоих доменов.

  "/security-ops/daily-expense": {
    subject: "Расход дня (ОМ)",
    paths: [
      "/api/ops/daily/divisions/",
      "/api/ops/daily/employees/",
      "/api/ops/daily/daily-submissions/",
      "/api/ops/daily/statuses-bulk/",
    ],
    note: `${MOCK_NOTE} Живой расход по строевой записке — на хостовом экране «Отчёты».`,
  },
  "/security-ops/ratings": {
    subject: "Оперативный рейтинг",
    paths: [
      "/api/ops/operational-ratings/",
      "/api/ops/operational-rating-dynamics/",
      "/api/ops/rating-notifications/",
    ],
    note: MOCK_NOTE,
  },
  "/security-ops/ratings/workspace": {
    subject: "Рабочее место оценщика",
    paths: ["/api/ops/evaluation-workspace/", "/api/ops/evaluation-work-items/"],
    note: MOCK_NOTE,
  },
  "/security-ops/ratings/evaluations": {
    subject: "Реестр оценок",
    paths: ["/api/ops/evaluation-registry/"],
    note: MOCK_NOTE,
  },
  "/security-ops/ratings/employees": {
    subject: "Карточка рейтинга сотрудника",
    paths: ["/api/ops/operational-rating-employee/"],
    note: MOCK_NOTE,
  },
  "/security-ops/ratings/analytics": {
    subject: "Аналитика рейтинга",
    paths: ["/api/ops/rating-analytics/"],
    note: MOCK_NOTE,
  },
  "/security-ops/ratings/audit": {
    subject: "Аудит рейтинга",
    paths: ["/api/ops/rating-audit/"],
    note: MOCK_NOTE,
  },
  "/security-ops/ratings/export": {
    subject: "Выгрузки рейтинга",
    paths: ["/api/ops/rating-exports/", "/api/ops/rating-export-artifacts/"],
    note: MOCK_NOTE,
  },
  "/security-ops/analytics": {
    subject: "Аналитика службы",
    paths: [
      "/api/ops/service-analytics/",
      "/api/ops/service-analytics-presets/",
      "/api/ops/service-analytics-attention/",
      "/api/ops/service-analytics-drilldown/",
      "/api/ops/load-analytics/",
    ],
    note: MOCK_NOTE,
  },
  "/security-ops/analytics/operations": {
    subject: "Аналитика мероприятий",
    paths: ["/api/ops/operations-analytics/"],
    note: MOCK_NOTE,
  },
  "/security-ops/service-reports": {
    subject: "Служебные отчёты",
    paths: [
      "/api/ops/service-report-types/",
      "/api/ops/service-report-jobs/",
      "/api/ops/service-report-artifacts/",
    ],
    note: MOCK_NOTE,
  },
  "/security-ops/dictionaries": {
    subject: "Справочники раздела ОМ",
    paths: ["/api/ops/dictionaries/"],
    note: MOCK_NOTE,
  },
  "/security-ops/settings": {
    subject: "Настройки раздела ОМ",
    paths: ["/api/ops/settings/", "/api/ops/setting-changes/"],
    note: MOCK_NOTE,
  },
  "/security-ops/audit": {
    subject: "Журнал действий ОМ",
    paths: ["/api/ops/audit-logs/"],
    note: MOCK_NOTE,
  },
  "/security-ops/feedback": {
    subject: "Обратная связь раздела ОМ",
    paths: ["/api/ops/feedback-requests/"],
    note: MOCK_NOTE,
  },
};

// Экраны внутри раздела, которым бэк не нужен вовсе: журнал изменений порта
// собран из статического текста. Пометка «не подключён» здесь была бы враньём
// в другую сторону, поэтому маршрут исключён из общего правила /security-ops.
const NO_BACKEND_NEEDED: readonly string[] = ["/security-ops/changelog"];

/**
 * Возвращает запись реестра для маршрута — самое длинное совпадение по
 * префиксу. Для маршрутов без пробела возвращает null, и врезка не рисуется.
 */
const OBJECTS_MOCK_BY_CONFIG: ApiGap = {
  subject: "Объекты и паспорта",
  paths: [],
  note:
    "Бэкенд объектов и паспортов готов (/api/ops/objects/ + паспорт и версии); " +
    "экран работает на MSW по конфигурации. Живой режим: " +
    "NEXT_PUBLIC_OPS_LIVE_DOMAINS=objects.",
};

const SECURITY_EVENTS_MOCK_BY_CONFIG: ApiGap = {
  subject: "Охранные мероприятия",
  paths: [],
  note:
    "Бэкенд ОМ готов (/api/ops/security-events/ — реестр, карточка и все " +
    "девять стадий; /api/ops/personnel/ — кадровый снимок); экран работает " +
    "на MSW по конфигурации. Живой режим: " +
    "NEXT_PUBLIC_OPS_LIVE_DOMAINS=security-events.",
};

const SECURITY_EVENT_ROUTES = ["/security-ops/command-center", "/security-ops/events"];

const COMBAT_MOCK_BY_CONFIG: ApiGap = {
  subject: "Боевые группы",
  paths: [],
  note:
    "Бэкенд боевых групп готов (/api/ops/combat-duty-types|routes|" +
    "roster-candidates|duty-shifts/); экран работает на MSW по конфигурации. " +
    "Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=combat.",
};

const CALENDAR_MOCK_BY_CONFIG: ApiGap = {
  subject: "Календарь смен",
  paths: [],
  note:
    "Бэкенд обоих источников календаря готов (duty-shifts и " +
    "combat-duty-shifts); экран работает на MSW по конфигурации. Живой " +
    "режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=duties,combat.",
};

const DUTIES_MOCK_BY_CONFIG: ApiGap = {
  subject: "План дежурств",
  paths: [],
  note:
    "Бэкенд плана дежурств готов (/api/ops/duty-types|shifts|monthly-plan|" +
    "plan-objects|candidates/); экран работает на MSW по конфигурации. " +
    "Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=duties.",
};

export function findApiGap(pathname: string | null | undefined): ApiGap | null {
  if (!pathname) return null;
  {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    if (
      normalized === "/security-ops/objects" ||
      normalized.startsWith("/security-ops/objects/")
    ) {
      return isOpsObjectsLive() ? null : OBJECTS_MOCK_BY_CONFIG;
    }
    if (
      SECURITY_EVENT_ROUTES.some(
        (route) => normalized === route || normalized.startsWith(`${route}/`)
      )
    ) {
      return isOpsSecurityEventsLive() ? null : SECURITY_EVENTS_MOCK_BY_CONFIG;
    }
    if (
      normalized === "/security-ops/duties/combat" ||
      normalized.startsWith("/security-ops/duties/combat/")
    ) {
      return isOpsCombatLive() ? null : COMBAT_MOCK_BY_CONFIG;
    }
    if (
      normalized === "/security-ops/duties" ||
      normalized.startsWith("/security-ops/duties/")
    ) {
      return isOpsDutiesLive() ? null : DUTIES_MOCK_BY_CONFIG;
    }
    if (
      normalized === "/security-ops/calendar" ||
      normalized.startsWith("/security-ops/calendar/")
    ) {
      return isOpsDutiesLive() && isOpsCombatLive()
        ? null
        : CALENDAR_MOCK_BY_CONFIG;
    }
  }
  // Хост отдаёт пути с завершающим слэшем; нормализуем, чтобы «/ops/» и «/ops»
  // попадали в одну запись, а «/opsomething» — не попадало.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  const excluded = NO_BACKEND_NEEDED.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
  if (excluded) return null;

  let best: ApiGap | null = null;
  let bestLength = -1;
  for (const [prefix, gap] of Object.entries(GAPS)) {
    const isMatch =
      normalized === prefix || normalized.startsWith(`${prefix}/`);
    if (isMatch && prefix.length > bestLength) {
      best = gap;
      bestLength = prefix.length;
    }
  }
  return best;
}

/** Полный реестр — для сводки и тестов. */
export const API_GAPS = GAPS;
