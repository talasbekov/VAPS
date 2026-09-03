"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { InDevelopmentBadge } from "@/components/in-development-badge";
import { inDevelopmentOfRoute } from "@/shared/config/in-development";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Капсовый надзаголовок над H1 — раздел, к которому относится страница. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Кнопки справа; выравниваются по верхнему краю блока заголовка. */
  actions?: ReactNode;
  className?: string;
  /** Метка «В разработке» по адресу экрана (Plane №450) ставится сама из
   * реестра `shared/config/in-development`; `false` — не ставить (экран
   * внутри уже помеченного раздела показывает её один раз). */
  inDevelopment?: boolean;
}

/**
 * Заголовок страницы в наборе прототипа:
 *   надзаголовок 10.5px/700/uppercase/letter-spacing .12em/--primary, mb 6px
 *   H1           25px/700/line-height 1.15/letter-spacing -.02em, mb 6px
 *   подпись      --muted-foreground
 *
 * Надзаголовок набран `text-primary-ink`, а не `text-primary`: насыщенный
 * --primary как БУКВЫ даёт 3.46:1 на тёмном фоне и не проходит 4.5:1.
 *
 * 🔴 Капс делает CSS (`uppercase`), а НЕ `toUpperCase()` в JSX: иначе компонент
 * молча уродует данные вызывающего — акронимы и имена собственные теряют
 * регистр безвозвратно, а текст в DOM перестаёт совпадать с переданным пропом
 * (грепать по исходной строке станет нечем).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  inDevelopment = true,
}: PageHeaderProps) {
  const pathname = usePathname();
  const note = inDevelopment ? inDevelopmentOfRoute(pathname) : null;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p
            data-slot="page-eyebrow"
            className="text-primary-ink mb-1.5 text-[10.5px] font-bold tracking-[.12em] uppercase"
          >
            {eyebrow}
          </p>
        ) : null}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <h1 className="text-[25px] leading-[1.15] font-bold tracking-[-.02em]">
            {title}
          </h1>
          {note !== null && <InDevelopmentBadge note={note} />}
        </div>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div
          data-slot="page-header-actions"
          className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
