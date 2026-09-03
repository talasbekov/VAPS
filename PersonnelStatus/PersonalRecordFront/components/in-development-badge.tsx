"use client";

// Метка «В разработке» (Plane №450) — один компонент на меню, шапку экрана и
// шапку этапа; что именно не доделано, берётся из `shared/config/in-development`.
//
// Вид — янтарная капсула, а не красная: это не ошибка и не запрет, а честное
// «здесь ещё работают». Одной строкой без переноса (скилл: «Compact Label
// Overflow»); полный список — не только по наведению: капсула фокусируется с
// клавиатуры, и `aria-label` читает список целиком, а `title` показывает его
// указателю. Скринридер слышит «В разработке: …», а не голое слово.
import { Hammer } from "lucide-react";

import {
  inDevelopmentSummary,
  type InDevelopmentNote,
} from "@/shared/config/in-development";
import { cn } from "@/lib/utils";

export function InDevelopmentBadge({
  note,
  size = "md",
  className,
  /** `true` — метку читает не скринридер, а соседнее описание (меню):
   * внутри ссылки она не должна менять её имя. */
  decorative = false,
}: {
  note: InDevelopmentNote;
  size?: "sm" | "md";
  className?: string;
  decorative?: boolean;
}) {
  const summary = inDevelopmentSummary(note);
  return (
    <span
      data-slot="in-development"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-semibold",
        "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/50",
        size === "sm" ? "px-1.5 py-0 text-[10px] leading-4" : "px-2 py-0.5 text-[11px] leading-4",
        className
      )}
      title={summary}
      tabIndex={decorative ? undefined : 0}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : summary}
    >
      <Hammer className={size === "sm" ? "size-2.5" : "size-3"} aria-hidden="true" />
      В разработке
    </span>
  );
}
