"use client";

// Единый вид «данные не загрузились» для списков, плиток и таблиц.
//
// Зачем компонент, а не строка на месте. Аудит 17.08.2026 нашёл шесть экранов,
// где отказ сервера рендерился как успешная пустота: «сотрудников нет»,
// «уведомлений нет», пустой месяц календаря, прочерки в оргструктуре. Человек
// видел факт о мире вместо факта о запросе и не имел кнопки, которая что-то
// меняет. Один компонент делает эти два состояния различимыми везде одинаково.
//
// Почему текст не `text-destructive`. Этот токен не проходит 4.5:1 ни в одной
// теме (аудит, §Доступность) и уезжает отдельной правкой токенов. Красным
// помечена только иконка — она несёт то же значение дублирующим каналом, а
// читаемость сообщения от неё не зависит.
import type { ReactElement } from "react";
import { AlertTriangle } from "lucide-react";

export function LoadFailure({
  what,
  onRetry,
  isRetrying = false,
  className,
}: {
  /** Что не загрузилось, в винительном падеже: «список сотрудников». */
  what: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div
      role="alert"
      className={`flex flex-col items-start gap-2 py-4 ${className ?? ""}`}
    >
      <p className="flex items-center gap-2 text-sm text-foreground">
        <AlertTriangle
          className="h-4 w-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <span>Не удалось загрузить {what}.</span>
      </p>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="min-h-11 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
        >
          {isRetrying ? "Повторяем…" : "Повторить"}
        </button>
      )}
    </div>
  );
}
