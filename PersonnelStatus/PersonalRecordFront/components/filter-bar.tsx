import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface FilterBarProps {
  children: ReactNode;
  /** Обработчик кнопки «Сбросить фильтры»; без него кнопка не рисуется. */
  onReset?: () => void;
}

/**
 * Ряд фильтров единой высоты. Высоту задаёт сам ряд через селектор потомков —
 * иначе каждый экран назначает её по-своему и они расходятся.
 */
export function FilterBar({ children, onReset }: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      className="flex flex-wrap items-center gap-2 [&_button]:h-9 [&_input]:h-9 [&_select]:h-9"
    >
      {children}
      {onReset ? (
        <Button
          variant="outline"
          size="default"
          className="ml-auto"
          onClick={onReset}
        >
          Сбросить фильтры
        </Button>
      ) : null}
    </div>
  );
}
