"use client";

// «Суточный свод» — версии СВОДНОГО заявления департамента (Task 5).
//
// Контракт снят ЭМПИРИЧЕСКИ, не по брифу: бриф предполагал вьюсет
// `daily-summaries` (`organization_management/apps/operations/api/urls.py:44`,
// `DailySummaryViewSet`, basename `ops-daily-summary`) источником списка
// версий. На деле у него НЕТ действия чтения списка вовсе — только
// `create` (собрать, `daily_report.generate`), `rebuild` (пересобрать
// «взамен», `daily_report.correct`), `freshness` (свежесть ОДНОЙ действующей)
// и `export` (файл). Docstring вьюсета говорит прямо: «Сводка возвращается
// тем же сериализатором, что и сдача: это одна сущность» — свод физически
// ХРАНИТСЯ в ТОЙ ЖЕ таблице (`OpsDailySubmission`), что обычная сдача
// листового подразделения: «версия свода» — это строка `daily-submissions`
// с `division_id` СОСТАВНОГО (не листового) подразделения.
//
// Поэтому источник версий — УЖЕ ИЗВЕСТНАЯ ручка `DAILY_SUBMISSIONS_PATH`
// (`/api/ops/daily/daily-submissions/`, тот же адаптер, что уже импортирован
// борд-ом для сводки сдачи), с фильтром `division_id=<департамент>`. Этот
// фильтр здесь ТОЧНЫЙ (см. `DailySubmissionSelector.list`: `division_id`
// param — `.filter(division_id=division_id)`, ровно равенство), а НЕ
// поддеревный — то есть ответ несёт РОВНО версии свода этого узла, не сдачи
// его детей. Право чтения — `status.view`, ТО ЖЕ самое, что уже открывает
// остальной экран.
//
// УЗЕЛ СВОДА ВЫВОДИТСЯ ИЗ СЕРВЕРНОЙ СТРУКТУРЫ, А НЕ ЗАШИТ ID-ОМ (правка по
// ревью координатора 21.08.2026). Первая версия файла хранила
// `SUMMARY_DIVISION_ID = 2` константой — это была прямая привязка к
// идентификатору из БД КОНКРЕТНОГО стенда: на другой инсталляции она молча
// указала бы не туда. Это принципиально ДРУГОЙ класс константы, чем
// `LEADERSHIP_MAX_LEVEL` в `LeadershipStrip.tsx` — тот опирается на
// СЕРВЕРНОЕ поле (`position.level`), устойчивое к смене инсталляции, а не на
// конкретный id из данных стенда.
//
// Источник структуры — `GET /api/operations/traffic-light/tree/` (то же
// право `status.view`, БЕЗ `root_division_id` — сервер сам сужает дерево
// до области актора). Это заодно честно решает случай оператора,
// закреплённого за ЛИСТОВЫМ подразделением: в его дереве родитель-предок
// обрезан областью, кандидатов по правилу ниже не найдётся, и сработает
// честная ветка «узел не определён», а не молчаливая подстановка чужого узла.
//
// ПРАВИЛО ВЫВОДА УЗЛА (координатор, эмпирически на живом дереве): узел
// свода — тот, чей РОДИТЕЛЬ сам является КОРНЕМ (`parent_id === null`), и
// в чьём поддереве лежит НАИБОЛЬШЕЕ число управлений борда (`division_id`
// строк расхода, проп `boardDivisionIds`). На живых данных стенда это
// однозначно «Департамент охраны» (id=2, родитель — корень «Служба», id=1):
// у сироты «Управление (стенд)» (id=6) родителя нет вовсе (сам корень, не
// подходит под правило вообще), у «Управление объектами» (id=3) родитель
// (2) сам не корень. При НУЛЕ кандидатов, при максимальном покрытии = 0
// или при НЕОДНОЗНАЧНОСТИ (два и более кандидата делят максимальное
// ненулевое покрытие) — компонент НЕ гадает: показывает честную строку и
// НЕ шлёт запрос версий вовсе (`enabled` гейт запроса версий).
//
// Снимок ОДНОЙ версии («Открыть») отдаёт только `retrieve` вьюсета
// `daily-submissions` РАЗДЕЛА `/api/operations/` (не адаптер `/api/ops/
// daily/`: у адаптера действия `retrieve` нет вовсе — только `list`/
// `create`/`amend`). То же право `status.view`, другая база пути — как и
// `apiClient.getOpsStatusesOn`, уже бьющий в `/api/operations/` напрямую с
// этого экрана.
import { useMemo, useState } from "react";
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

interface DivisionTreeNode {
  divisionId: number;
  parentId: number | null;
}

/** Узлы дерева читаем ЗАЩИТНО, тем же приёмом, что `parseSubmission` в
 * `entities/daily-grid`: кривой узел выпадает из вычисления, а не роняет
 * блок целиком. */
function parseTreeNodes(payload: unknown): DivisionTreeNode[] {
  const envelope = asRecord(payload);
  if (envelope === null) return [];
  const rawNodes = envelope.nodes;
  if (!Array.isArray(rawNodes)) return [];
  const result: DivisionTreeNode[] = [];
  for (const raw of rawNodes) {
    const row = asRecord(raw);
    if (row === null) continue;
    if (typeof row.division_id !== "number") continue;
    const parentId = row.parent_id;
    if (parentId !== null && typeof parentId !== "number") continue;
    result.push({ divisionId: row.division_id, parentId: parentId as number | null });
  }
  return result;
}

/**
 * Узел свода по правилу координатора — см. заголовок файла: кандидат —
 * узел, чей родитель сам корневой; победитель — кандидат с максимальным
 * (ненулевым) покрытием `boardDivisionIds` в своём поддереве, при условии
 * что он ЕДИНСТВЕННЫЙ такой. `null` — «не определён», честно, не гадаем.
 */
function resolveSummaryDivisionId(
  nodes: DivisionTreeNode[],
  boardDivisionIds: readonly number[]
): number | null {
  const rootIds = new Set(
    nodes.filter((node) => node.parentId === null).map((node) => node.divisionId)
  );
  const candidates = nodes.filter(
    (node) => node.parentId !== null && rootIds.has(node.parentId)
  );
  if (candidates.length === 0) return null;

  const childrenOf = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node.divisionId);
    childrenOf.set(node.parentId, list);
  }
  function subtreeIds(rootId: number): Set<number> {
    const seen = new Set<number>([rootId]);
    const stack = [rootId];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const child of childrenOf.get(current) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          stack.push(child);
        }
      }
    }
    return seen;
  }

  const boardSet = new Set(boardDivisionIds);
  const coverage = candidates.map((candidate) => {
    const subtree = subtreeIds(candidate.divisionId);
    let count = 0;
    for (const id of boardSet) if (subtree.has(id)) count += 1;
    return { id: candidate.divisionId, count };
  });
  const maxCoverage = Math.max(...coverage.map((entry) => entry.count));
  if (maxCoverage === 0) return null;
  const winners = coverage.filter((entry) => entry.count === maxCoverage);
  if (winners.length !== 1) return null;
  return winners[0].id;
}

function formatSubmittedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("ru-RU");
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

interface SummaryVersionsProps {
  /** Дата — из ТОГО ЖЕ ответа расхода, что и остальной борд: оба блока
   * обязаны говорить об одном дне. */
  businessDate: string;
  /** `division_id` строк борда (расхода) — правилу вывода узла нужно
   * знать, какие управления борд вообще показывает, чтобы выбрать узел,
   * РЕАЛЬНО накрывающий их поддеревом, а не любой формальный корневой. */
  boardDivisionIds: readonly number[];
}

/** «Суточный свод» — версии сводного заявления департамента. */
export function SummaryVersions({ businessDate, boardDivisionIds }: SummaryVersionsProps) {
  const [openId, setOpenId] = useState<number | null>(null);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(businessDate);

  const treeQuery = useQuery({
    queryKey: ["daily-expense-board", "division-tree"],
    queryFn: () => opsApiClient.get<unknown>("/api/operations/traffic-light/tree/"),
  });

  const treeNodes = useMemo(() => parseTreeNodes(treeQuery.data), [treeQuery.data]);
  const treeReady = dateValid && !treeQuery.isPending && !treeQuery.isError;
  const summaryDivisionId = useMemo(
    () => (treeReady ? resolveSummaryDivisionId(treeNodes, boardDivisionIds) : null),
    [treeReady, treeNodes, boardDivisionIds]
  );
  const unresolved = treeReady && summaryDivisionId === null;
  const resolved = treeReady && summaryDivisionId !== null;

  const query = useQuery({
    queryKey: ["daily-expense-board", "summaries", businessDate],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${summaryDivisionId}&business_date=${encodeURIComponent(businessDate)}`
      ),
    // Гейт на `resolved`, а не только на дату: узел не определён — запрос не
    // уходит вовсе, а не уходит с бессмысленным division_id.
    enabled: resolved,
  });

  const versions: DailySummaryRow[] = resolved ? parseSubmissionList(query.data) : [];

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
          {dateValid && treeQuery.isPending && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Загрузка структуры подразделений…
            </p>
          )}
          {dateValid && !treeQuery.isPending && treeQuery.isError && (
            <p role="alert" className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Не удалось прочитать структуру подразделений — узел свода не определён
            </p>
          )}
          {unresolved && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Узел суточного свода не определён по структуре подразделений
            </p>
          )}
          {resolved && query.isPending && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Загрузка свода…
            </p>
          )}
          {resolved && !query.isPending && query.isError && (
            <p role="alert" className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Не удалось узнать, собирался ли свод
            </p>
          )}
          {resolved && !query.isPending && !query.isError && versions.length === 0 && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              свод ещё не собирался
            </p>
          )}
          {resolved &&
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
