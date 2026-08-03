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

let startPromise: Promise<void> | null = null;

/**
 * Запускает MSW worker и резолвится, когда перехват готов. Вызывать ДО
 * первого рендера страниц раздела — иначе первые запросы уйдут в сеть.
 * Идемпотентно: повторный вызов не плодит вторую регистрацию.
 */
export function startOpsMockWorker(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!isOpsMockMode()) return Promise.resolve();
  if (!window.location.pathname.startsWith("/security-ops")) {
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
