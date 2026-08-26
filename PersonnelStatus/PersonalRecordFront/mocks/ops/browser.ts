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
import { isOpsMockMode } from "@/lib/ops-env";
import { composeOpsHandlers } from "./handlers";

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
    // рядом живые запросы хоста (NextAuth, /api/* основного бэка) —
    // их перехватывать нельзя; цена bypass: опечатка в пути handler-а не
    // упадёт ошибкой, а молча уйдёт в сеть — проверять network-таб
    onUnhandledRequest: "bypass",
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
}
