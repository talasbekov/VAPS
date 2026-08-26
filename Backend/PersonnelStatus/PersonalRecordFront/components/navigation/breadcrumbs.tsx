"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

/**
 * Подписи сегментов маршрута. Ключ — сегмент URL как есть.
 * Сегменты, которых здесь нет (идентификаторы, промежуточные шаги без своей
 * страницы), в крошки не попадают: «/security-ops/events/42» читается как
 * «Реестр ОМ», а не «Реестр ОМ / 42».
 *
 * Сверено с фактическими h1 на страницах app/ (не с брифом дословно):
 * - Сегментов `duties`/`calendar`/`daily-expense`/`forces` здесь нет: группа
 *   «Дежурства и расход» и экран «Сбор сил на ОМ» удалены 21.08.2026 вместе с
 *   адресами. Подпись на удалённый адрес вела бы крошку в 404.
 * - `analytics` (верхний уровень, `/security-ops/analytics/`) H1 —
 *   «Состояние службы и личного состава», предложение, в крошку не влезает;
 *   подпись берёт надзаголовок страницы «Аналитика службы» — точен и короток.
 * - `statuses` на странице — «Управление статусами», не «Статусы сотрудников».
 * - `changelog` H1 — «Журнал: сообщено → исправлено» со стрелкой, в крошке
 *   нечитаем; подпись сокращена до «Журнал».
 * - `reports` H1 в коде БЕЗ «ё» («Отчеты») — подпись повторяет посимвольно.
 * - `export`/`evaluations`/`workspace` под `ratings/` — H1 расходится с
 *   именем сегмента сильнее, чем у соседей: «Выгрузка рейтинга»,
 *   «Итоговые оценки участников», «Оценивание участников» соответственно.
 */
const SEGMENT_LABELS: Record<string, string> = {
  "security-ops": "Охранные мероприятия",
  "command-center": "Командный центр",
  events: "Реестр ОМ",
  gvo: "Реестр ГВО",
  persons: "Охраняемые лица",
  objects: "Объекты и паспорта",
  laws: "Законы об ОМ",
  ratings: "Оперативный рейтинг",
  analytics: "Аналитика службы",
  operations: "Аналитика мероприятий",
  "service-reports": "Отчёты службы",
  history: "История отчётов",
  export: "Выгрузка рейтинга",
  evaluations: "Итоговые оценки участников",
  workspace: "Оценивание участников",
  dictionaries: "Справочники",
  audit: "Аудит",
  changelog: "Журнал",
  settings: "Администрирование",
  feedback: "Обратная связь",
  profile: "Мой профиль",
  dashboard: "Обзор",
  employees: "Сбор сил на ОМ",
  organization: "Структура организации",
  statuses: "Управление статусами",
  reports: "Отчеты",
};

/**
 * Сегменты, у которых СВОЕЙ СТРАНИЦЫ НЕТ (Plane №175).
 *
 * `/security-ops/` — раздел, а не экран: в `app/security-ops/` лежит
 * `layout.tsx` и дочерние каталоги, но `page.tsx` нет. Крошка вела на него
 * ссылкой, и нажатие давало 404. В dev это не замечалось; в прод-режиме Next
 * ПРЕДЗАГРУЖАЕТ ссылки крошек, и `/security-ops/?_rsc=…` отвечал 404 при
 * каждом заходе на любой экран раздела — нашлось прогоном смоука по
 * прод-сборке.
 *
 * Подпись при этом остаётся: она называет, ГДЕ человек находится, и терять её
 * нельзя. Не остаётся только обещание перехода, которого система не держит.
 *
 * Список ведётся руками и намеренно НЕ выводится из файловой системы: крошки
 * — клиентский компонент, дерева `app/` он не видит, а угадывать по адресу
 * значило бы гадать. Строк здесь ровно столько, сколько разделов без экрана.
 */
const SEGMENTS_WITHOUT_PAGE = new Set(["security-ops"]);

/** Бренд первым звеном крошек — как в прототипе: «Smart Жоспарлау / Экран».
 * Ведёт на командный центр, а не на «/»: корень редиректит, и звено-петля в
 * крошках читалась бы как сломанная ссылка. */
const BRAND_CRUMB = {
  href: "/security-ops/command-center/",
  label: "Smart Жоспарлау",
} as const;

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { href: string; label: string; linked: boolean }[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    const label = SEGMENT_LABELS[segment];
    if (label)
      crumbs.push({
        href: `${href}/`,
        label,
        linked: !SEGMENTS_WITHOUT_PAGE.has(segment),
      });
  }

  if (crumbs.length === 0) return null;

  // Бренд не подменяет первый сегмент, а встаёт перед ним: «Охранные
  // мероприятия» — настоящий раздел со своим адресом, и терять его нельзя.
  const trail = [{ ...BRAND_CRUMB, linked: true }, ...crumbs];

  return (
    <nav aria-label="Хлебные крошки" className="min-w-0">
      <ol className="text-muted-foreground flex items-center gap-1.5 text-[12.5px]">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              ) : null}
              {isLast ? (
                <span className="text-foreground truncate font-semibold" aria-current="page">
                  {crumb.label}
                </span>
              ) : crumb.linked ? (
                <Link href={crumb.href} className="hover:text-foreground truncate">
                  {crumb.label}
                </Link>
              ) : (
                // Без ссылки и без вида ссылки: подпись называет место, но
                // перехода не обещает. Ссылка, ведущая в 404, хуже её
                // отсутствия — человек считает сломанным весь раздел.
                <span className="truncate">{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
