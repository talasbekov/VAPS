"use client";

import { Button } from "@/components/ui/button";

/**
 * Листатель постраничных списков (Plane №228, вынесен общим в №231).
 *
 * НОМЕРОВ СТРАНИЦ НЕТ СОЗНАТЕЛЬНО. На пяти тысячах сотрудников их сто три, и
 * «перейти на 73-ю» не отвечает ни на один вопрос человека: он ищет
 * КОНКРЕТНОГО сотрудника, а для этого есть поиск — он теперь серверный и
 * смотрит весь состав, а не показанную страницу.
 *
 * Диапазон назван словами («51-100 из 5124»), потому что без него «Далее»
 * не говорит, где человек находится и сколько ещё осталось.
 *
 * Кнопки не исчезают на крайних страницах, а гаснут: пропадающая кнопка
 * сдвигает соседнюю под курсор — и следующий щелчок попадает не туда.
 */
export function Pager({
  page,
  pageSize,
  matched,
  hasNext,
  busy,
  onChange,
}: {
  page: number;
  pageSize: number;
  matched: number;
  hasNext: boolean;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  if (matched === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, matched);
  if (!hasNext && page === 1) {
    // Одна страница — листать нечего; счётчик и без того стоит в шапке.
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 pt-2"
      aria-busy={busy}
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {from}–{to} из {matched}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || busy}
          onClick={() => onChange(page - 1)}
        >
          Назад
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext || busy}
          onClick={() => onChange(page + 1)}
        >
          Далее
        </Button>
      </div>
    </div>
  );
}

