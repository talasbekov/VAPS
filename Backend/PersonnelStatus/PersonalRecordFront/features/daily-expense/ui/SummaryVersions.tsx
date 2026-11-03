"use client";

import { SummaryCorrection } from "./SummaryCorrection";
import { VersionSnapshot } from "./VersionSnapshot";

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
// Без явного серверного признака кандидат — узел под корнем, чьё поддерево
// содержит строки расхода. Единственный выбирается автоматически; несколько
// требуют выбора человека независимо от размера. До выбора версии не читаются.
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
import { Button } from "@/components/ui/button";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  SUMMARY_ASSEMBLE_PERMISSION,
  useAssembleSummary,
  useSendSummary,
} from "@/hooks/use-daily-summary-write";
import { useTrafficLightTree } from "@/hooks/use-strength-report";
import { DAILY_SUBMISSIONS_PATH, parseSubmissionList } from "@/entities/daily-grid";
import type { DaySubmission } from "@/entities/daily-grid";
import { formatIsoDateTime } from "@/shared/lib/date";

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
  name: string;
  /** Собирает ли узел суточный свод — ФАКТ С СЕРВЕРА (Plane №326, решение
   *  заказчика 30.08.2026). Признак заводит администратор; пока он не
   *  проставлен ни у кого, экран ведёт себя как прежде и выводит узел
   *  правилом по форме дерева. */
  isSummaryNode: boolean;
}

/** Кандидат в узел свода — департамент, за который свод можно собрать. */
interface SummaryCandidate {
  id: number;
  name: string;
}

/**
 * Чем кончился вывод узла свода — и ПОЧЕМУ (Plane №326).
 *
 * До №326 правило отвечало `number | null`, и все три «нет» выглядели на
 * экране одной строкой «Узел суточного свода не определён по структуре
 * подразделений». Между тем это три разных положения дел:
 *
 *   `no-department` — в области актора нет ни одного департамента: свод
 *      собирается ЗА департамент, и собирать не за что. Чинится структурой.
 *   `no-coverage` — департаменты есть, но ни один не содержит управлений
 *      этого расхода: расход и структура разошлись. Чинится данными.
 *   `ambiguous` — расход охватывает НЕСКОЛЬКО департаментов. Это
 *      не поломка вовсе: так выглядит область, накрывающая всю службу.
 *      Здесь системе не хватает не сведений, а ВЫБОРА — и спросить его можно
 *      у человека, а не гадать за него.
 *
 * Именно `ambiguous` и делал шаг цикла непроходимым НИ ДЛЯ КОГО на стенде с
 * тремя департаментами: правило требовало единственного победителя, а их
 * трое с одинаковым покрытием.
 */
interface SummaryResolution {
  chosen: number | null;
  reason: "ok" | "no-department" | "no-coverage" | "ambiguous";
  candidates: SummaryCandidate[];
}

/** Узлы дерева читаем ЗАЩИТНО, тем же приёмом, что `parseSubmission` в
 * `entities/daily-grid`: кривой узел выпадает из вычисления, а не роняет
 * блок целиком. Тип с сервера объявлен (`TrafficLightNode`), но объявление —
 * это обещание, а не проверка: ответ читается через `unknown`-приведение
 * ровно потому, что подтверждать форму некому. */
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
    result.push({
      divisionId: row.division_id,
      parentId: parentId as number | null,
      // Имя нужно ВЫБОРУ департамента (Plane №326): список без имён —
      // список номеров, выбрать по нему нельзя.
      name: typeof row.name === "string" ? row.name : "",
      // Ответ без поля читается как «признак не проставлен»: старый сервер
      // остаётся валидным, и экран падает обратно на правило.
      isSummaryNode: row.is_summary_node === true,
    });
  }
  return result;
}

/**
 * При нескольких узлах с положительным покрытием `boardDivisionIds`
 * требуется явный выбор; размер покрытия не определяет адресата свода.
 */
/**
 * Узел свода ПО СЕРВЕРНОМУ ПРИЗНАКУ (Plane №326, решение заказчика 30.08.2026).
 *
 * Признак отменяет угадывание: пока он не проставлен ни у кого, экран падает
 * обратно на правило по форме дерева — расширяем, не подменяем, и стенд без
 * настройки ведёт себя как вёл. Проставлен у одного — ответ однозначен;
 * проставлен у нескольких (у каждого департамента свой свод — это норма) —
 * спрашиваем человека, как и раньше.
 *
 * Кандидаты сужаются ОБЛАСТЬЮ АКТОРА сами собой: дерево приходит уже
 * суженным сервером, и узла вне своей области в нём просто нет.
 */
function resolveByServerFlag(
  nodes: DivisionTreeNode[],
  nameOf: (id: number) => string
): SummaryResolution | null {
  const flagged = nodes.filter((node) => node.isSummaryNode);
  if (flagged.length === 0) return null;
  const candidates = flagged.map((node) => ({
    id: node.divisionId,
    name: nameOf(node.divisionId),
  }));
  if (candidates.length === 1) {
    return { chosen: candidates[0].id, reason: "ok", candidates };
  }
  return { chosen: null, reason: "ambiguous", candidates };
}

function resolveSummary(
  nodes: DivisionTreeNode[],
  boardDivisionIds: readonly number[]
): SummaryResolution {
  const nameOf = (id: number): string =>
    nodes.find((node) => node.divisionId === id)?.name ?? `подразделение №${id}`;
  const byFlag = resolveByServerFlag(nodes, nameOf);
  if (byFlag !== null) return byFlag;

  const rootIds = new Set(
    nodes.filter((node) => node.parentId === null).map((node) => node.divisionId)
  );
  const candidates = nodes.filter(
    (node) => node.parentId !== null && rootIds.has(node.parentId)
  );
  if (candidates.length === 0) {
    return { chosen: null, reason: "no-department", candidates: [] };
  }

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
  const covered = coverage.filter((entry) => entry.count > 0);
  if (covered.length === 0) {
    return {
      chosen: null,
      reason: "no-coverage",
      candidates: candidates.map((node) => ({ id: node.divisionId, name: nameOf(node.divisionId) })),
    };
  }
  if (covered.length > 1) {
    return {
      chosen: null,
      reason: "ambiguous",
      // Размер департамента не определяет, за кого пользователь хочет
      // собрать или исправить свод. Каждый представленный узел — кандидат.
      candidates: covered.map((entry) => ({ id: entry.id, name: nameOf(entry.id) })),
    };
  }
  return {
    chosen: covered[0].id,
    reason: "ok",
    candidates: [{ id: covered[0].id, name: nameOf(covered[0].id) }],
  };
}

// Момент печатается модулем `formatIsoDateTime` (Plane №935): своя копия
// отдавала сырую ISO-строку вместо «—» и печатала секунды, которых на экране
// нет ни у кого. Один формат на все экраны — «дд.мм.гггг, чч:мм».

interface SummaryVersionsProps {
  /** Cached context preserves drafts but must not authorize a write. */
  contextReady?: boolean;
  /** Optional role scope, already validated against the daily hierarchy by the caller. */
  scopeDivisionId?: number;
  /** Department scopes validated against server division types by the caller. */
  scopeCandidates?: { id: number; name: string }[];
  /** Дата — из ТОГО ЖЕ ответа расхода, что и остальной борд: оба блока
   * обязаны говорить об одном дне. */
  businessDate: string;
  /** `division_id` строк борда (расхода) — правилу вывода узла нужно
   * знать, какие управления борд вообще показывает, чтобы выбрать узел,
   * РЕАЛЬНО накрывающий их поддеревом, а не любой формальный корневой. */
  boardDivisionIds: readonly number[];
  /** Подпись подразделения по id — «имя · путь», как её видит человек на
   * борде. Нужна ОТКАЗУ сборки: сервер называет отставших числами
   * (`details.laggards`), а список чисел на экране — не ответ на вопрос
   * «кого торопить». Блок своего списка подразделений не заводит: он уже
   * загружен бордом, и второй запрос за теми же именами был бы лишним. */
  labelOfDivision: (divisionId: number) => string;
  /** `history` — ТОЛЬКО список версий, без кнопок ступеней и их сообщений
   * (Plane №1221): на экране ответственного сборка/отправка живут в блоке
   * `SummaryActionBar` наверху, и вторая пара тех же кнопок внизу означала
   * бы два главных действия на одном экране. Умолчание `full` — прежнее
   * поведение для `DailyExpenseBoard`. */
  variant?: "full" | "history";
}

/** Отказ сборки СЛОВАМИ. Три случая названы отдельно, потому что человек
 * делает по ним РАЗНОЕ: «не все сдали» — торопить перечисленных, «уже
 * собран» — идти в пересборку (отдельное действие и отдельное право), всё
 * прочее — читать сообщение сервера. */
export function assembleFailureText(failure: OpsApiFailure): string {
  // `SUMMARY_CHILDREN_NOT_SUBMITTED` сюда больше не долетает (Plane №990):
  // кнопка всегда шлёт `allow_incomplete: true`, и недостающие управления
  // видны в СПИСКЕ версий/статусе отправки, а не как отказ сборки.
  if (!(failure instanceof OpsApiError)) {
    return "Свод не собран: связи с сервером нет";
  }
  if (failure.status === 409) {
    return "Свод за этот день уже собран — исправление отдельным действием";
  }
  if (failure.status === 403) {
    return "Свод не собран: нет права собирать свод за это подразделение";
  }
  return `Свод не собран: ${failure.message}`;
}

/** Список несдавших из отказа ОТПРАВКИ — `null`, если отказ не про
 * неполноту (403/404/409/сеть): им поле причины не решает ничего, и
 * рисовать его значило бы обещать выход из тупика, которого нет. */
export function sendLaggardsOf(failure: OpsApiFailure | null): number[] | null {
  if (failure === null || !(failure instanceof OpsApiError)) return null;
  const raw = failure.details.laggards;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export function sendFailureText(
  failure: OpsApiFailure | null,
  labelOfDivision: (divisionId: number) => string,
  laggards: number[] | null
): string | null {
  if (failure === null) return null;
  if (!(failure instanceof OpsApiError)) {
    return "Отправка не удалась: связи с сервером нет";
  }
  if (laggards !== null && laggards.length > 0) {
    const names = laggards.map((id) => labelOfDivision(id));
    return `Свод неполный — не сдали ${names.join(", ")}. Укажите причину и подтвердите отправку.`;
  }
  if (failure.errorCode === "SUMMARY_ALREADY_SENT") {
    return "Эта версия свода уже отправлена дежурному";
  }
  if (failure.status === 404) {
    return "Свод ещё не собран — сначала «Собрать свод»";
  }
  if (failure.status === 403) {
    return "Отправка закрыта правом «Суточный отчёт: генерация»";
  }
  return `Отправка не удалась: ${failure.message}`;
}

/** «Суточный свод» — версии сводного заявления департамента. */
export function SummaryVersions({
  businessDate,
  boardDivisionIds,
  labelOfDivision,
  scopeDivisionId,
  scopeCandidates,
  variant = "full",
  contextReady = true,
}: SummaryVersionsProps) {
  const actions = variant !== "history";
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(businessDate);

  // Дерево — ЧЕРЕЗ ОБЩИЙ ХУК СВЕТОФОРА (`useTrafficLightTree`), а не своим
  // `opsApiClient.get` под вторым ключом кэша: до ревью ветки 22.08 один и
  // тот же ответ лежал в кэше ДВАЖДЫ под разными ключами, то есть и
  // запрашивался дважды, и мог разъехаться во времени с деревом соседних
  // экранов. Гейт `enabled` тут всегда true: борд не монтирует этот блок,
  // пока сам не прошёл гейт `status.view` и не получил ответ расхода.
  //
  // `businessDate` ПЕРЕДАЁТСЯ ЯВНО, а не как раньше (без даты — про
  // «сегодня»): борд получает СВОЙ `businessDate` пропом (Plane №988), и
  // дерево сдачи обязано отвечать про ТОТ ЖЕ день, что и расход рядом —
  // иначе свод сверял бы завтрашние управления со вчерашним светофором.
  const needsTree = scopeDivisionId === undefined && scopeCandidates === undefined;
  const treeQuery = useTrafficLightTree(needsTree, dateValid ? businessDate : undefined);

  const treeNodes = useMemo(() => parseTreeNodes(treeQuery.data), [treeQuery.data]);
  const treeReady = dateValid && (!needsTree || treeQuery.data !== undefined);
  const writeContextReady = contextReady && (!needsTree || (treeQuery.isSuccess && !treeQuery.isFetching));
  const resolution = useMemo(
    () =>
      scopeDivisionId !== undefined ? ({ chosen: scopeDivisionId, reason: 'ok', candidates: [] } as SummaryResolution) : scopeCandidates !== undefined
        ? ({ chosen: scopeCandidates.length === 1 ? scopeCandidates[0].id : null,
             reason: scopeCandidates.length === 0 ? 'no-department' : scopeCandidates.length > 1 ? 'ambiguous' : 'ok',
             candidates: scopeCandidates } as SummaryResolution) : treeReady
        ? resolveSummary(treeNodes, boardDivisionIds)
        : ({ chosen: null, reason: "ok", candidates: [] } as SummaryResolution),
    [treeReady, treeNodes, boardDivisionIds, scopeDivisionId, scopeCandidates]
  );

  // ВЫБОР ЧЕЛОВЕКА ПЕРЕВЕШИВАЕТ ПРАВИЛО (Plane №326), но только когда правило
  // само призналось в неоднозначности: подменять однозначный вывод чужим
  // выбором значило бы дать собрать свод не за тот департамент.
  const [pickedId, setPickedId] = useState<number | null>(null);
  const pickable = treeReady && resolution.reason === "ambiguous";
  const picked =
    pickable && resolution.candidates.some((item) => item.id === pickedId)
      ? pickedId
      : null;
  const summaryDivisionId = resolution.chosen ?? picked;
  const unresolved = treeReady && summaryDivisionId === null;
  const resolved = treeReady && summaryDivisionId !== null;

  // Mutation feedback and draft reasons belong to this date and department.
  // A keyed child resets them before the new context can paint or submit.
  return <SummaryVersionsContext
    key={`${businessDate}:${summaryDivisionId ?? "unresolved"}`}
    {...{ businessDate, labelOfDivision, scopeCandidates, actions, dateValid,
      needsTree, treeQuery, resolution, pickable, picked, setPickedId,
      summaryDivisionId, unresolved, resolved, contextReady: writeContextReady }}
  />;
}

interface SummaryVersionsContextProps {
  contextReady: boolean;
  businessDate: string;
  labelOfDivision: SummaryVersionsProps["labelOfDivision"];
  scopeCandidates: SummaryVersionsProps["scopeCandidates"];
  actions: boolean;
  dateValid: boolean;
  needsTree: boolean;
  treeQuery: ReturnType<typeof useTrafficLightTree>;
  resolution: SummaryResolution;
  pickable: boolean;
  picked: number | null;
  setPickedId: (id: number | null) => void;
  summaryDivisionId: number | null;
  unresolved: boolean;
  resolved: boolean;
}

function SummaryVersionsContext({
  businessDate, labelOfDivision, scopeCandidates, actions, dateValid,
  needsTree, treeQuery, resolution, pickable, picked, setPickedId,
  summaryDivisionId, unresolved, resolved, contextReady,
}: SummaryVersionsContextProps) {
  const [openId, setOpenId] = useState<number | null>(null);

  const query = useQuery({
    // `summaryDivisionId` — ЧАСТЬ КЛЮЧА: он стоит в URL запроса, и без него
    // ответы для разных узлов свода легли бы в одну ячейку кэша (находка ревью
    // ветки 22.08). Узел выводится из дерева и на другой инсталляции/области
    // актора будет другим.
    queryKey: ["daily-expense-board", "summaries", businessDate, summaryDivisionId],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${summaryDivisionId}&business_date=${encodeURIComponent(businessDate)}`
      ),
    // Гейт на `resolved`, а не только на дату: узел не определён — запрос не
    // уходит вовсе, а не уходит с бессмысленным division_id.
    enabled: resolved,
  });

  const versions: DailySummaryRow[] = resolved ? parseSubmissionList(query.data) : [];
  const currentVersion = versions.find((version) => version.is_current) ?? null;
  const assembled = currentVersion !== null;
  const alreadySent = currentVersion !== null && currentVersion.sent_at !== null;

  // ДВЕ СТУПЕНИ, А НЕ ОДНА (Plane №990, §20.4 п.6). Право одно на обе —
  // `daily_report.generate`; без него кнопок нет вовсе и причина названа
  // словами, как на остальных гейтах экрана. Пока права ещё грузятся, кнопка
  // не рисуется: мигнувшая и исчезнувшая кнопка хуже, чем появившаяся с
  // задержкой.
  const { hasPermission, isLoading: permissionsLoading, error: permissionsError } = useOpsPermissions();
  const canAssemble = hasPermission(SUMMARY_ASSEMBLE_PERMISSION);
  const assemble = useAssembleSummary();
  const send = useSendSummary();
  const [sendReason, setSendReason] = useState("");
  const assembleFailureMessage =
    assemble.error === null
      ? null
      : assembleFailureText(assemble.error);
  const sendLaggards = sendLaggardsOf(send.error);
  // Причина нужна ИМЕННО когда сервер отказал по неполноте — а не на любой
  // отказ отправки: 403/404/409 показывать поле ввода не должны, оно не
  // решает ни одну из этих причин.
  const sendNeedsReason = sendLaggards !== null && sendLaggards.length > 0;
  const sendFailureMessage = sendFailureText(send.error, labelOfDivision, sendLaggards);
  const canWrite = actions && resolved && contextReady && query.isSuccess && !query.isFetching && !permissionsLoading && !permissionsError && canAssemble;
  const canSend = canWrite && assembled && !alreadySent;
  const sendNow = () => {
    if (!canSend || send.isPending || (sendNeedsReason && sendReason.trim() === "")) return;
    send.mutate({ division_id: summaryDivisionId as number, business_date: businessDate, reason: sendReason });
  };

  return (
    <section role="region" aria-label={actions ? "Суточный свод" : "Версии свода"} className="space-y-2">
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{actions ? "Суточный свод" : "Версии свода"}</h2>
          {resolved && <p data-slot="summary-target" className="w-full text-xs text-muted-foreground">
            Свод за {resolution.candidates.length > 0 ? "департамент" : "подразделение"} «{resolution.candidates.find(item => item.id === summaryDivisionId)?.name ?? labelOfDivision(summaryDivisionId as number)}».
            {picked !== null && <> <button type="button" className="underline underline-offset-2" onClick={() => setPickedId(null)}>Выбрать другой</button></>}
          </p>}
          {canWrite && !assembled && (
            <Button
              type="button"
              size="sm"
              disabled={assemble.isPending}
              onClick={() => {
                if (!canWrite || assemble.isPending || assembled) return;
                assemble.reset();
                assemble.mutate({
                  division_id: summaryDivisionId as number,
                  business_date: businessDate,
                });
              }}
            >
              {assemble.isPending ? "Собираем…" : "Собрать свод"}
            </Button>
          )}
          {canSend && !sendNeedsReason && (
            <Button
              type="button"
              size="sm"
              disabled={send.isPending || (sendNeedsReason && sendReason.trim() === "")}
              onClick={sendNow}
            >
              {send.isPending ? "Отправляем…" : "Отправить дежурному"}
            </Button>
          )}
        </div>
        {actions && assembled && summaryDivisionId !== null && <div className="border-b px-4 py-2"><SummaryCorrection key={`${businessDate}:${summaryDivisionId}`} divisionId={summaryDivisionId} businessDate={businessDate} dataReady={contextReady && query.isSuccess && !query.isFetching} /></div>}
        {/* Кому уходит — сказано вслух и рядом с кнопкой: «отправить» без
            адресата не отвечает на вопрос, что случится по нажатию. */}
        {canWrite && !assembled && (
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            Свод собирается из действующих сдач управлений; недостающие
            остаются видны как «не сдали» — отправка неполного свода
            потребует явной причины.
          </p>
        )}
        {canSend && !sendNeedsReason && (
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            Свод собран. Отправка уходит оперативному дежурному, который
            сводит расход за организацию, — отдельным действием со своим
            моментом и автором.
          </p>
        )}
        {actions && resolved && !permissionsLoading && canAssemble && alreadySent && currentVersion !== null && (
          <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
            Отправлено {formatIsoDateTime(currentVersion.sent_at as string)} ·{" "}
            {currentVersion.sent_by}
            {currentVersion.incomplete_reason !== "" && (
              <> — неполный свод: «{currentVersion.incomplete_reason}»</>
            )}
          </p>
        )}
        {actions && permissionsError && <p role="alert" className="border-b px-4 py-2 text-sm text-muted-foreground">Не удалось проверить права. Сборка и отправка недоступны до успешной загрузки прав.</p>}
        {actions && !permissionsLoading && !permissionsError && !canAssemble && (
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            Сборка и отправка свода закрыты правом «Суточный отчёт: генерация»
            — свод собирает и отправляет ответственный за расход департамента.
          </p>
        )}
        {actions && assembleFailureMessage !== null && (
          <p role="alert" className="border-b px-4 py-2 text-sm text-muted-foreground">
            {assembleFailureMessage}
          </p>
        )}
        {actions && assemble.isSuccess && (
          <p role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">
            Свод собран — новая версия в списке ниже
          </p>
        )}
        {actions && sendFailureMessage !== null && (
          <p role="alert" className="border-b px-4 py-2 text-sm text-muted-foreground">
            {sendFailureMessage}
          </p>
        )}
        {canSend && sendNeedsReason && !send.isSuccess && (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <input
              aria-label="Причина неполной отправки"
              type="text"
              value={sendReason}
              onChange={(event) => setSendReason(event.target.value)}
              placeholder="Причина неполной отправки — обязательна"
              className="min-w-64 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={send.isPending || sendReason.trim() === ""}
              onClick={sendNow}
            >
              Подтвердить отправку
            </Button>
          </div>
        )}
        {actions && send.isSuccess && (
          <p role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">
            Свод отправлен дежурному
          </p>
        )}
        {/* `role="list"`/`listitem` — тот же приём, что у «Руководства
            департамента»: скелетные/текстовые заглушки этой роли не несут,
            поэтому счёт строк не путается с «ещё грузится». */}
        <div className="divide-y" role="list">
          {!dateValid && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Загрузка даты расхода…
            </p>
          )}
          {needsTree && dateValid && treeQuery.isPending && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Загрузка структуры подразделений…
            </p>
          )}
          {needsTree && dateValid && !treeQuery.isPending && treeQuery.isError && (
            <p role="alert" className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Не удалось прочитать структуру подразделений — узел свода не определён
            </p>
          )}
          {/* ТРИ РАЗНЫХ «НЕТ», А НЕ ОДНО (Plane №326). Прежде здесь стояла
              одна строка «Узел суточного свода не определён по структуре
              подразделений» — она одинаково описывала «департамента нет»,
              «расход и структура разошлись» и «департаментов несколько».
              Последнее и делало шаг цикла непроходимым НИ ДЛЯ КОГО: на стенде
              с тремя департаментами правило не находило единственного
              победителя и молча сдавалось, хотя человеку хватило бы вопроса
              «за какой департамент собираем». */}
          {unresolved && resolution.reason === "no-department" && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Свод департамента собирает ответственный из сдач управлений и отправляет дежурному.
              В вашей области доступны управления и отделы: сдайте расход за управление целиком.
              Отдельно сдавать каждый отдел не требуется.
            </p>
          )}
          {unresolved && resolution.reason === "no-coverage" && (
            <p className="whitespace-normal px-4 py-3 text-sm text-muted-foreground">
              Ни один департамент вашей области не содержит управлений этого
              расхода — собирать свод не из чего. Проверьте, к тем ли
              подразделениям привязаны управления расхода.
            </p>
          )}
          {unresolved && pickable && (
            <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
              <p className="whitespace-normal">
                {scopeCandidates !== undefined
                  ? "Доступно несколько департаментов. Выберите департамент, за который собираете свод."
                  : "Расход охватывает несколько департаментов — за какой собирать свод, система не решает за вас. Выберите департамент."}
              </p>
              <div className="flex flex-wrap gap-2">
                {resolution.candidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPickedId(candidate.id)}
                  >
                    {candidate.name}
                  </Button>
                ))}
              </div>
            </div>
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
                    {formatIsoDateTime(version.submitted_at)} · {version.submitted_by}
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
                {openId === version.id && <VersionSnapshot id={version.id} labelOfDivision={labelOfDivision} />}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
