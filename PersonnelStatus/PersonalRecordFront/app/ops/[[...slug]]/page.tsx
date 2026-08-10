// /ops/* — БЫВШИЙ адрес встроенной SPA Smart Josparlau (Этапы M1-M4).
//
// Раздел дублировал переписанные нативные страницы /security-ops/*: два
// пункта сайдбара на каждый экран, SPA — на MSW-моках, натив — на живом
// /api/ops/*. По решению владельца дубли убраны: реализация одна —
// переписанные страницы старого фронта, а старые адреса /ops/* остаются
// редиректами (на них ведут закладки и старые ссылки).
//
// Донорские разделы SPA (личный состав, расход, отчёты, оргструктура) ведут
// на ЖИВЫЕ хостовые экраны — их переписанных версий в /security-ops нет,
// потому что живые уже есть.
import { redirect } from "next/navigation";

// Первый сегмент SPA-маршрута → база в старом фронте. Хвост маршрута
// сохраняется там, где нативный раздел повторяет структуру SPA (карточки,
// подстраницы рейтинга/отчётов/аналитики).
const SECTION_BASE: Record<string, { base: string; keepTail: boolean }> = {
  "command-center": { base: "/security-ops/command-center", keepTail: false },
  "security-events": { base: "/security-ops/events", keepTail: true },
  objects: { base: "/security-ops/objects", keepTail: true },
  duties: { base: "/security-ops/duties", keepTail: true },
  calendar: { base: "/security-ops/calendar", keepTail: false },
  analytics: { base: "/security-ops/analytics", keepTail: true },
  ratings: { base: "/security-ops/ratings", keepTail: true },
  "service-reports": { base: "/security-ops/service-reports", keepTail: true },
  dictionaries: { base: "/security-ops/dictionaries", keepTail: true },
  settings: { base: "/security-ops/settings", keepTail: false },
  audit: { base: "/security-ops/audit", keepTail: false },
  changelog: { base: "/security-ops/changelog", keepTail: false },
  "daily-expense": { base: "/security-ops/daily-expense", keepTail: false },
  // Обратная связь живёт на своём адресе раздела (один модуль — два входа).
  feedback: { base: "/feedback", keepTail: true },
  // Донорские дубли SPA → живые хостовые экраны.
  employees: { base: "/employees", keepTail: false },
  organization: { base: "/organization", keepTail: false },
  reports: { base: "/reports", keepTail: false },
  login: { base: "/", keepTail: false },
};

export default async function OpsRedirect({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const [head, ...tail] = slug;
  const section = head === undefined ? undefined : SECTION_BASE[head];
  if (section === undefined) {
    // Корень SPA и неизвестные пути (print/*) — в командный центр раздела.
    redirect("/security-ops/command-center");
  }
  const suffix =
    section.keepTail && tail.length > 0 ? `/${tail.join("/")}` : "";
  redirect(`${section.base}${suffix}`);
}
