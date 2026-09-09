// Запуск host-MSW для нативных страниц /security-ops/*.
//
// ИНВАРИАНТ сосуществования с MSW смонтированной SPA на /ops: sidebar ходит
// по обычным <a> (полная перезагрузка документа), поэтому host-MSW и
// SPA-MSW никогда не живут в одном документе. Если когда-нибудь ссылки
// sidebar станут клиентскими (next/link) — этот инвариант сломается; гейт по
// pathname ниже — вторая линия обороны, не убирать.
//
// Promise, а не булев флаг: под React StrictMode эффект layout выполняется
// дважды, два параллельных вызова прошли бы мимо булевого guard-а и подняли
// два инстанса worker-а (каждый исполняет handler → мутации дублируются).
import { isOpsMockMode, opsMockDomains } from "@/lib/ops-env";
import { composeOpsHandlers } from "./handlers";

const OPS_MOCK_DOMAIN_PATHS: Readonly<Record<string, readonly string[]>> = {
  "security-events": ["/api/ops/security-events/"],
  objects: ["/api/ops/objects/"],
  duties: [
    "/api/ops/duty-types/",
    "/api/ops/duty-shifts/",
    "/api/ops/duty-monthly-plan/",
    "/api/ops/duty-plan-objects/",
    "/api/ops/duty-candidates/",
  ],
  gvo: ["/api/ops/gvo-summaries/"],
  "protected-persons": ["/api/ops/protected-persons/"],
  "legal-documents": ["/api/ops/legal-documents/"],
  dictionaries: [
    "/api/ops/dictionaries/",
    "/api/dictionaries/positions/",
    "/api/dictionaries/ranks/",
  ],
  settings: ["/api/ops/settings/"],
  audit: ["/api/ops/audit-logs/"],
  ratings: [
    "/api/ops/operational-ratings/",
    "/api/ops/operational-rating-dynamics/",
    "/api/ops/rating-analytics/",
    "/api/ops/evaluation-workspace/",
    "/api/ops/evaluation-work-items/",
    "/api/ops/evaluation-registry/",
    "/api/ops/rating-audit/",
    "/api/ops/rating-notifications/",
    "/api/ops/operational-rating-employee/",
    "/api/ops/rating-exports/",
    "/api/ops/rating-export-artifacts/",
  ],
  analytics: [
    "/api/ops/service-analytics/",
    "/api/ops/service-analytics-presets/",
    "/api/ops/service-analytics-drilldown/",
    "/api/ops/service-analytics-attention/",
    "/api/ops/operations-analytics/",
    "/api/ops/load-analytics/",
  ],
  "service-reports": [
    "/api/ops/service-report-types/",
    "/api/ops/service-report-jobs/",
    "/api/ops/service-report-artifacts/",
    "/api/ops/event-documents/",
    "/api/ops/bulletin-issues/",
  ],
  feedback: ["/api/ops/feedback-requests/"],
  access: [
    "/api/operations/permissions/",
    "/api/operations/roles/",
    "/api/operations/user-roles/",
    "/api/operations/accounts/",
    "/api/ops/access-catalog/",
  ],
};

/** Returns the active mock domain owning a request path, or null for bypass. */
export function opsMockDomainForPath(pathname: string): string | null {
  for (const [domain, prefixes] of Object.entries(OPS_MOCK_DOMAIN_PATHS)) {
    if (
      opsMockDomains().has(domain) &&
      prefixes.some((prefix) => pathname.startsWith(prefix))
    ) {
      return domain;
    }
  }
  return null;
}

/** Где host-MSW разрешён. Гейт нужен из-за SPA-MSW на /ops: два worker-а в
 * одном документе исполняли бы handlers дважды. `/settings` добавлен
 * 26.08.2026 (Plane №106, шаг «П-10») — экраны доступа живут там, и без этого
 * `NEXT_PUBLIC_OPS_MOCK_DOMAINS=access` не действовал на них ВОВСЕ: запросы
 * молча уходили в живой бэк, а мок-проба считала это проверкой мока и завела
 * на стенде настоящую учётку. */
const HOST_MSW_PREFIXES = ["/security-ops", "/settings"];

let startPromise: Promise<void> | null = null;

/**
 * Запускает MSW worker и резолвится, когда перехват готов. Вызывать ДО
 * первого рендера страниц раздела — иначе первые запросы уйдут в сеть.
 * Идемпотентно: повторный вызов не плодит вторую регистрацию.
 */
export function startOpsMockWorker(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!isOpsMockMode()) return Promise.resolve();
  if (!HOST_MSW_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix))) {
    return Promise.resolve();
  }
  if (startPromise !== null) return startPromise;
  startPromise = start();
  return startPromise;
}

async function start(): Promise<void> {
  const { setupWorker } = await import("msw/browser");
  const worker = setupWorker(...composeOpsHandlers());
  await worker.start({
    // Рядом живут запросы хоста (NextAuth и /api/* основного бэка), поэтому
    // bypass остаётся для путей вне включённых мок-доменов. Внутри домена
    // bypass запрещён: опечатка или снятый handler не должен уходить в живой
    // бэк и выдавать мок-пробе зелёный ответ.
    onUnhandledRequest(request, print) {
      if (opsMockDomainForPath(new URL(request.url).pathname) !== null) {
        print.error();
      }
    },
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
}
