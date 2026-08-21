"use client";

// «Суточный свод» — версии СВОДНОГО заявления департамента (Task 5).
//
// Контракт снят ЭМПИРИЧЕСКИ, не по брифу: бриф предполагал вьюсет
// `daily-summaries` (`organization_management/apps/operations/api/urls.py:44`,
// `DailySummaryViewSet`, basename `ops-daily-summary`) источником списка
// версий. На деле у него НЕТ действия чтения списка вовсе — только
// `create` (собрать, `daily_report.generate`), `rebuild` (пересобрать
// «взамен», `daily_report.correct`), `freshness` (свежесть ОДНОЙ действующей)
// и `export` (файл). Docstring вьюсета
// говорит прямо: «Сводка возвращается тем же сериализатором, что и сдача:
// это одна сущность» — свод физически ХРАНИТСЯ в ТОЙ ЖЕ таблице
// (`OpsDailySubmission`), что обычная сдача листового подразделения:
// «версия свода» — это строка `daily-submissions` с `division_id`
// СОСТАВНОГО (не листового) подразделения.
//
// Поэтому источник версий — УЖЕ ИЗВЕСТНАЯ ручка `DAILY_SUBMISSIONS_PATH`
// (`/api/ops/daily/daily-submissions/`, тот же адаптер, что уже импортирован
// борд-ом для сводки сдачи), с фильтром `division_id=<департамент>`. Этот
// фильтр здесь ТОЧНЫЙ (см. `DailySubmissionSelector.list`: `division_id`
// param — `.filter(division_id=division_id)`, ровно равенство), а НЕ
// поддеревный (поддерево фильтрует только `scope`, когда `division_id` не
// передан отдельным параметром) — то есть ответ несёт РОВНО версии свода
// этого узла, не сдачи его детей. Право чтения — `status.view`, ТО ЖЕ самое,
// что уже открывает остальной экран (проверено curl под admin 21.08.2026 —
// 200, без новых прав).
//
// `SUMMARY_DIVISION_ID` — id составного «Департамент охраны», родителя
// управлений 4/5 этого борда (снят с `/api/divisions/divisions_tree/` на
// живом стенде). Не вызываем этот эндпоинт из браузера: как и у
// `LEADERSHIP_MAX_LEVEL` в `LeadershipStrip.tsx`, орг-дерево живёт под
// другим правом (`orgstructure.view`), которого у этого экрана нет — id
// записан константой той же природы, что и порог уровня руководства.
// Управление 6 «Управление (стенд)» — сирота вне этого дерева (см. отчёт
// Task 3/4), поэтому свод департамента 2 НЕ покрывает его целиком — честная
// граница, не баг.
//
// Снимок ОДНОЙ версии («Открыть») отдаёт только `retrieve` вьюсета
// `daily-submissions` РАЗДЕЛА `/api/operations/` (не адаптер `/api/ops/
// daily/`: у адаптера действия `retrieve` нет вовсе, см. `OpsDailySubmis
// sionsViewSet` — только `list`/`create`/`amend`). То же право `status.view`,
// другая база пути — как и `apiClient.getOpsStatusesOn`, уже бьющий в
// `/api/operations/` напрямую с этого экрана.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { opsApiClient } from "@/lib/ops-api";
import { DAILY_SUBMISSIONS_PATH, parseSubmissionList } from "@/entities/daily-grid";
import type { DaySubmission } from "@/entities/daily-grid";

/** Строка «Суточного свода» — эмпирически ТА ЖЕ форма, что и строка обычной
 * сдачи (общая модель и сериализатор на бэке, см. заголовок файла). Алиас,
 * а не отдельный дублирующий тип: раздельное определение разошлось бы с
 * `entities/daily-grid` при первой же правке контракта сдачи. */
export type DailySummaryRow = DaySubmission;

/** id составного «Департамент охраны» — см. обоснование в заголовке файла. */
export const SUMMARY_DIVISION_ID = 2;

function formatSubmittedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("ru-RU");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

interface SnapshotBody {
  rosterCount: number;
  rowsCount: number;
  reason: string;
  sanction: string;
}

/** Снимок версии читаем ЗАЩИТНО, тем же приёмом, что `parseSubmission` в
 * `entities/daily-grid`: кривое тело не должно падать исключением — честнее
 * показать «пришло в незнакомой форме», чем уронить блок целиком. */
function parseSnapshotBody(payload: unknown): SnapshotBody | null {
  const row = asRecord(payload);
  if (row === null) return null;
  const snapshot = asRecord(row.snapshot);
  if (snapshot === null) return null;
  const roster = Array.isArray(snapshot.roster) ? snapshot.roster : null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : null;
  if (roster === null || rows === null) return null;
  return {
    rosterCount: roster.length,
    rowsCount: rows.length,
    reason: typeof row.reason === "string" ? row.reason : "",
    sanction: typeof row.sanction === "string" ? row.sanction : "",
  };
}

/** Снимок ОДНОЙ версии — свой запрос, только когда версия раскрыта. */
function VersionSnapshot({ id }: { id: number }) {
  const detail = useQuery({
    queryKey: ["daily-expense-board", "summary-snapshot", id],
    queryFn: () =>
      opsApiClient.get<unknown>(`/api/operations/daily-submissions/${id}/`),
  });

  if (detail.isPending) {
    return <p className="text-muted-foreground">Загрузка снимка версии…</p>;
  }
  if (detail.isError) {
    return (
      <p role="alert" className="text-muted-foreground">
        Не удалось открыть снимок версии
      </p>
    );
  }
  const body = parseSnapshotBody(detail.data);
  if (body === null) {
    return (
      <p role="alert" className="text-muted-foreground">
        Снимок версии пришёл в незнакомой форме — показать нечем
      </p>
    );
  }
  return (
    <p>
      В списке {body.rosterCount}, отклонений {body.rowsCount}
      {body.reason && ` · причина: ${body.reason}`}
      {body.sanction && ` · санкция: ${body.sanction}`}
    </p>
  );
}

/** «Суточный свод» — версии сводного заявления департамента. Дата — из ТОГО
 * ЖЕ ответа расхода, что и остальной борд (см. `DailyExpenseBoard.tsx`):
 * оба блока обязаны говорить об одном дне. */
export function SummaryVersions({ businessDate }: { businessDate: string }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(businessDate);

  const query = useQuery({
    queryKey: ["daily-expense-board", "summaries", businessDate],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${SUMMARY_DIVISION_ID}&business_date=${encodeURIComponent(businessDate)}`
      ),
    enabled: dateValid,
  });

  const versions: DailySummaryRow[] = dateValid ? parseSubmissionList(query.data) : [];

  return (
    <section role="region" aria-label="Суточный свод" className="space-y-2">
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Суточный свод</h2>
        </div>
        {/* `role="list"`/`listitem` — тот же приём, что у «Руководства
            департамента»: скелетные/текстовые заглушки этой роли не несут,
            поэтому счёт строк не путается с «ещё грузится». */}
        <div className="divide-y" role="list">
          {!dateValid && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              деловая дата ещё не известна
            </p>
          )}
          {dateValid && query.isPending && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Загрузка свода…
            </p>
          )}
          {dateValid && !query.isPending && query.isError && (
            <p role="alert" className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Не удалось узнать, собирался ли свод
            </p>
          )}
          {dateValid && !query.isPending && !query.isError && versions.length === 0 && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              свод ещё не собирался
            </p>
          )}
          {dateValid &&
            !query.isPending &&
            !query.isError &&
            versions.map((version) => (
              <div key={version.id} role="listitem" className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Версия {version.version}</span>
                  {version.is_current && <Badge variant="secondary">Текущая</Badge>}
                  <span className="text-muted-foreground">
                    {formatSubmittedAt(version.submitted_at)} · {version.submitted_by}
                  </span>
                  <button
                    type="button"
                    className="ml-auto rounded-md border px-2 py-1 text-xs"
                    aria-expanded={openId === version.id}
                    onClick={() =>
                      setOpenId((prev) => (prev === version.id ? null : version.id))
                    }
                  >
                    {openId === version.id ? "Свернуть" : "Открыть"}
                  </button>
                </div>
                {openId === version.id && <VersionSnapshot id={version.id} />}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
