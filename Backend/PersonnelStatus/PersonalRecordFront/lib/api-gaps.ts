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

import { isOpsAnalyticsLive, isOpsAuditLive, isOpsCombatLive, isOpsDictionariesLive, isOpsDutiesLive, isOpsFeedbackLive, isOpsObjectsLive, isOpsRatingsLive, isOpsSecurityEventsLive, isOpsServiceReportsLive, isOpsSettingsLive } from "@/lib/ops-env";

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
  // «/feedback» (легаси-чат поверх несуществующего /api/dictionaries/feedback/)
  // переписан целиком: адрес редиректит на /security-ops/feedback (срез J).
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
  // Оперативный рейтинг: бэк ГОТОВ (срез G) — запись собирается в findApiGap
  // по режиму домена ratings (все семь экранов — один домен).
  // Аналитика службы и мероприятий: бэк ГОТОВ (срез H) — запись собирается
  // в findApiGap по режиму домена analytics (оба экрана — один домен).
  // Служебные отчёты: бэк ГОТОВ (срез I) — запись собирается в findApiGap
  // по режиму домена service-reports (все три экрана — один домен).
  // Справочники, настройки и аудит: бэк ГОТОВ (срез D1) — записи собираются
  // в findApiGap по режимам доменов dictionaries/settings/audit.
  // Обратная связь: бэк ГОТОВ (срез J) — запись собирается в findApiGap по
  // режиму домена feedback (реестр и карточка — один домен).
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

const SIMPLE_MOCK_BY_CONFIG: Record<string, ApiGap> = {
  "/security-ops/dictionaries": {
    subject: "Справочники раздела ОМ",
    paths: [],
    note:
      "Бэкенд справочников готов (/api/ops/dictionaries/ — реестры, связи, " +
      "заведение/деактивация/удаление); экран на MSW по конфигурации. Живой " +
      "режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=dictionaries.",
  },
  "/security-ops/settings": {
    subject: "Настройки раздела ОМ",
    paths: [],
    note:
      "Бэкенд настроек готов (/api/ops/settings/ + журнал изменений; правка " +
      "пишется насквозь в политики свежести/конфликтов); экран на MSW по " +
      "конфигурации. Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=settings.",
  },
  "/security-ops/audit": {
    subject: "Журнал действий ОМ",
    paths: [],
    note:
      "Бэкенд журнала готов (/api/ops/audit-logs/ поверх живого журнала " +
      "раздела); экран на MSW по конфигурации. Живой режим: " +
      "NEXT_PUBLIC_OPS_LIVE_DOMAINS=audit.",
  },
  "/security-ops/feedback": {
    subject: "Обратная связь раздела ОМ",
    paths: [],
    note:
      "Бэкенд обратной связи готов (/api/ops/feedback-requests/ — реестр со " +
      "сводкой и страницами, создание/отправка черновика, карточка с лентой, " +
      "комментарии, разбор и закрытие с ответом автору); экран на MSW по " +
      "конфигурации. Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=feedback.",
  },
};

const SIMPLE_LIVE_CHECK: Record<string, () => boolean> = {
  "/security-ops/dictionaries": isOpsDictionariesLive,
  "/security-ops/settings": isOpsSettingsLive,
  "/security-ops/audit": isOpsAuditLive,
  "/security-ops/feedback": isOpsFeedbackLive,
};

const ANALYTICS_MOCK_BY_CONFIG: ApiGap = {
  subject: "Аналитика службы и мероприятий",
  paths: [],
  note:
    "Бэкенд аналитики готов (/api/ops/service-analytics|-presets|-drilldown|" +
    "-attention, load-analytics, operations-analytics — снимки, выборки, " +
    "внимание, нагрузка, уровни и воронка по журналу переходов); экраны на " +
    "MSW по конфигурации. Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=analytics.",
};

const SERVICE_REPORTS_MOCK_BY_CONFIG: ApiGap = {
  subject: "Служебные отчёты",
  paths: [],
  note:
    "Бэкенд отчётов готов (/api/ops/service-report-types|jobs|artifacts — " +
    "асинхронная генерация, immutable-артефакты с ревизиями серии, retry/" +
    "new-revision, скачивание с повторной проверкой прав и срока); экраны " +
    "на MSW по конфигурации. Живой режим: " +
    "NEXT_PUBLIC_OPS_LIVE_DOMAINS=service-reports.",
};

const RATINGS_MOCK_BY_CONFIG: ApiGap = {
  subject: "Оперативный рейтинг",
  paths: [],
  note:
    "Бэкенд рейтинга готов (/api/ops/operational-ratings|-dynamics|-employee, " +
    "evaluation-workspace|-work-items|-registry, rating-analytics|-audit|" +
    "-notifications|-exports|-export-artifacts); экраны на MSW по " +
    "конфигурации. Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=ratings.",
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
      normalized === "/security-ops/ratings" ||
      normalized.startsWith("/security-ops/ratings/")
    ) {
      return isOpsRatingsLive() ? null : RATINGS_MOCK_BY_CONFIG;
    }
    if (
      normalized === "/security-ops/service-reports" ||
      normalized.startsWith("/security-ops/service-reports/")
    ) {
      return isOpsServiceReportsLive() ? null : SERVICE_REPORTS_MOCK_BY_CONFIG;
    }
    if (
      normalized === "/security-ops/analytics" ||
      normalized.startsWith("/security-ops/analytics/")
    ) {
      return isOpsAnalyticsLive() ? null : ANALYTICS_MOCK_BY_CONFIG;
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
    for (const [route, isLive] of Object.entries(SIMPLE_LIVE_CHECK)) {
      if (normalized === route || normalized.startsWith(`${route}/`)) {
        return isLive() ? null : SIMPLE_MOCK_BY_CONFIG[route];
      }
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
