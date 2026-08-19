import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Капсовый надзаголовок над H1 — раздел, к которому относится страница. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Кнопки справа; выравниваются по верхнему краю блока заголовка. */
  actions?: ReactNode;
  className?: string;
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
}: PageHeaderProps) {
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
        <h1 className="mb-1.5 text-[25px] leading-[1.15] font-bold tracking-[-.02em]">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
