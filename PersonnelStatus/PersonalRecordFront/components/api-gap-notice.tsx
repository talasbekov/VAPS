"use client";

// Единственная разметка «раздел не подключён». Переиспользуется врезкой в
// DashboardLayout (components/dashboard-layout.tsx) для всех экранов из
// реестра lib/api-gaps.ts — копий этой разметки быть не должно.
//
// Требование владельца: заглушка видимая и честная. Поэтому здесь нет ни
// пустого списка, ни нулей, ни «данные загружаются» — только прямое
// утверждение о том, какого пути нет на бэке.
import { AlertTriangle } from "lucide-react";
import type { ApiGap } from "@/lib/api-gaps";

export function ApiGapNotice({ gap }: { gap: ApiGap }) {
  const [first, ...rest] = gap.paths;
  // Запись без путей — «бэк готов, экран на моке по конфигурации» (объекты):
  // говорить «на бэке нет …» тут не о чем, врезка несёт только пояснение.
  const hasMissingPaths = first !== undefined;

  return (
    <div
      role="status"
      data-testid="api-gap-notice"
      className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-2">
          {hasMissingPaths ? (
            <p className="text-sm font-semibold">
              Не подключено — {gap.subject}: на бэке нет{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[0.8em] dark:bg-amber-900/60">
                {first}
              </code>
            </p>
          ) : (
            <p className="text-sm font-semibold">
              Демоданные — {gap.subject}
            </p>
          )}

          {rest.length > 0 && (
            <div className="text-sm">
              <span className="opacity-80">Также отсутствуют: </span>
              <span className="inline-flex flex-wrap gap-1 align-top">
                {rest.map((path) => (
                  <code
                    key={path}
                    className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[0.8em] dark:bg-amber-900/60"
                  >
                    {path}
                  </code>
                ))}
              </span>
            </div>
          )}

          {gap.note && <p className="text-sm opacity-90">{gap.note}</p>}

          <p className="text-xs opacity-75">
            Сводка недостающих маршрутов — docs/api-gaps.md.
          </p>
        </div>
      </div>
    </div>
  );
}
