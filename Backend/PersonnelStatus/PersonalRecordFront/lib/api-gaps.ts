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

import { isOpsAnalyticsLive, isOpsAuditLive, isOpsCombatLive, isOpsDailyLive, isOpsDictionariesLive, isOpsDutiesLive, isOpsFeedbackLive, isOpsObjectsLive, isOpsRatingsLive, isOpsSecurityEventsLive, isOpsServiceReportsLive, isOpsSettingsLive } from "@/lib/ops-env";

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
  // переписан целиком: адрес рендерит новый модуль §28 (та же страница, что
  // /security-ops/feedback — срез J); запись собирается в findApiGap по
  // режиму домена feedback.
  // «/ops» (встроенная SPA Smart Josparlau на собственном MSW-воркере)
  // выведена из навигации: она дублировала переписанные нативные страницы
  // /security-ops/*; адреса /ops/* редиректят на них
  // (app/ops/[[...slug]]/page.tsx) — экрана, требующего пометки, больше нет.

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

  // «Расход дня (ОМ)»: бэк ГОТОВ адаптерами над живым /api/operations/
  // (статусы, сдача, поправка — те же сервисы, свой только адрес и форма
  // контракта). Запись собирается в findApiGap по режиму домена daily.
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

const PROFILE_MOCK_BY_CONFIG: ApiGap = {
  subject: "Мой профиль",
  paths: [],
  note:
    "Кадровая запись, статусы и справочники приходят с живого бэка " +
    "(/api/operations/my-employee|statuses/, /api/core/*) — они моком не " +
    "закрываются вовсе. На MSW по конфигурации остаются только назначения в " +
    "ОМ и смены дежурств. Живой режим: " +
    "NEXT_PUBLIC_OPS_LIVE_DOMAINS=security-events,duties.",
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
  // Один модуль — два адреса (/feedback и /security-ops/feedback): врезка
  // обязана вести себя одинаково на обоих.
  "/feedback": {
    subject: "Обратная связь раздела ОМ",
    paths: [],
    note:
      "Бэкенд обратной связи готов (/api/ops/feedback-requests/ — реестр со " +
      "сводкой и страницами, создание/отправка черновика, карточка с лентой, " +
      "комментарии, разбор и закрытие с ответом автору); экран на MSW по " +
      "конфигурации. Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=feedback.",
  },
  "/security-ops/daily-expense": {
    subject: "Расход дня (ОМ)",
    paths: [],
    note:
      "Бэкенд расхода дня готов (/api/ops/daily/* — адаптеры над живыми " +
      "статусами, сдачей дня и поправкой /api/operations/); экран на MSW по " +
      "конфигурации. Живой режим: NEXT_PUBLIC_OPS_LIVE_DOMAINS=daily.",
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
  "/security-ops/daily-expense": isOpsDailyLive,
  "/feedback": isOpsFeedbackLive,
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

// Пометки «Плана дежурств» здесь больше нет: раздел удалён 13.08.2026. Домен
// duties остался живым понятием — на нём стоит календарь смен, см.
// CALENDAR_MOCK_BY_CONFIG ниже.

// Реестр ГВО: сам список мероприятий берётся из живого реестра ОМ, а вот
// сводные данные хранить негде — ручек нет ни в целевом бэке, ни в доноре.
// Ручные правки живут в мок-слое и не переживут другую машину или вкладку.
const GVO_NO_BACKEND: ApiGap = {
  subject: "Сводные данные ГВО",
  paths: ["/api/ops/gvo-summaries/"],
  note:
    "Список мероприятий приходит из реестра ОМ (живой бэк), а правки сводок " +
    "сохраняет браузерный мок-слой MSW: серверного хранилища у сводных " +
    "данных ГВО пока нет.",
};

// Каталог охраняемых лиц: справочника нет ни в целевом бэке, ни в доноре —
// профили отдаёт мок-слой. Связь «лицо → мероприятия» при этом настоящая: она
// восстанавливается по сводкам ГВО поверх живого реестра ОМ.
const PROTECTED_PERSONS_NO_BACKEND: ApiGap = {
  subject: "Каталог охраняемых лиц",
  paths: ["/api/ops/protected-persons/"],
  note:
    "Профили лиц отдаёт браузерный мок-слой MSW: справочника охраняемых лиц " +
    "на бэке нет. Мероприятия и объекты в карточке — живые, они собираются " +
    "из реестра ОМ и сводок ГВО.",
};

// Нормативная база: справочника документов на бэке нет, файлов тем более —
// карточка честно говорит, что файл не хранится (см. app/security-ops/laws).
const LEGAL_DOCUMENTS_NO_BACKEND: ApiGap = {
  subject: "Нормативная база ОМ",
  paths: ["/api/ops/legal-documents/"],
  note:
    "Перечень документов отдаёт браузерный мок-слой MSW: справочника " +
    "нормативной базы на бэке нет. Файлов документов система не хранит " +
    "вовсе — скачивание не заведено ни на одном источнике.",
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
      normalized === "/security-ops/profile" ||
      normalized.startsWith("/security-ops/profile/")
    ) {
      // Профиль НЕ подпадает под общее правило раздела: «на бэке нет
      // /api/ops/*» здесь было бы неправдой — своё «кто я», статусы и
      // справочники он читает у живых ручек вне /api/ops. Врезка зависит
      // только от режима двух доменов, из которых он берёт назначения и
      // смены.
      return isOpsSecurityEventsLive() && isOpsDutiesLive()
        ? null
        : PROFILE_MOCK_BY_CONFIG;
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
      normalized === "/security-ops/calendar" ||
      normalized.startsWith("/security-ops/calendar/")
    ) {
      return isOpsDutiesLive() && isOpsCombatLive()
        ? null
        : CALENDAR_MOCK_BY_CONFIG;
    }
    if (
      normalized === "/security-ops/gvo" ||
      normalized.startsWith("/security-ops/gvo/")
    ) {
      // Единственный экран раздела БЕЗ пер-доменного переключателя: бэкенда
      // сводных данных ГВО нет вовсе, поэтому «живого режима» у него не
      // бывает и врезка обязана стоять всегда.
      return GVO_NO_BACKEND;
    }
    if (
      normalized === "/security-ops/persons" ||
      normalized.startsWith("/security-ops/persons/")
    ) {
      return PROTECTED_PERSONS_NO_BACKEND;
    }
    if (
      normalized === "/security-ops/laws" ||
      normalized.startsWith("/security-ops/laws/")
    ) {
      return LEGAL_DOCUMENTS_NO_BACKEND;
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
