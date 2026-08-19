"use client";

// Грид слепого ввода «Расхода дня» — нативный порт вокруг ЧИСТОЙ клавиатурной
// грамматики (entities/daily-grid): роверный фокус, EDIT-комбобокс с
// type-ahead-фильтром, PERIOD_EDIT с датой, Esc возвращает pre-edit значение,
// Enter/Tab коммитят и двигают фокус. Грид не знает ни эндпоинтов, ни ошибок
// сервера: наружу уходят ТОЛЬКО дельты (onSubmit) и их число (onDirtyChange).
//
// Виртуализации нет намеренно: demo-состав — единицы строк, а честный порт
// перф-обвязки (react-virtual) без объёма, на котором она проверяема, был бы
// декорацией.
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { transition } from "@/entities/daily-grid";
import type {
  Bounds,
  CellState,
  ColumnKind,
  EmployeeRow,
  GridKey,
  Position,
  RowChange,
  StatusOption,
} from "@/entities/daily-grid";

const COLUMN_KINDS: readonly ColumnKind[] = ["readonly", "status", "period"];
const COLUMN_TITLES = ["Сотрудник", "Статус", "Период (по … включительно)"];

interface RowValue {
  statusCode: string;
  period: string;
}

type ValueState = Record<string, RowValue>;

type ValueAction =
  | { type: "SET_STATUS"; id: string; statusCode: string }
  | { type: "SET_PERIOD"; id: string; period: string }
  | { type: "RESYNC"; initials: ValueState; prevInitials: ValueState };

function initialsOf(rows: EmployeeRow[]): ValueState {
  const initials: ValueState = {};
  for (const row of rows) {
    initials[row.id] = { statusCode: row.statusCode, period: row.period ?? "" };
  }
  return initials;
}

function valuesReducer(state: ValueState, action: ValueAction): ValueState {
  switch (action.type) {
    case "SET_STATUS": {
      const current = state[action.id];
      if (current === undefined) return state;
      return { ...state, [action.id]: { ...current, statusCode: action.statusCode } };
    }
    case "SET_PERIOD": {
      const current = state[action.id];
      if (current === undefined) return state;
      return { ...state, [action.id]: { ...current, period: action.period } };
    }
    case "RESYNC": {
      // Нетронутые строки берут новый initial, правки сохраняются,
      // исчезнувшие id отбрасываются.
      const next: ValueState = {};
      for (const [id, initial] of Object.entries(action.initials)) {
        const prevInitial = action.prevInitials[id];
        const current = state[id];
        const touched =
          prevInitial !== undefined &&
          current !== undefined &&
          (current.statusCode !== prevInitial.statusCode ||
            current.period !== prevInitial.period);
        next[id] = touched && current !== undefined ? current : initial;
      }
      return next;
    }
  }
}

function toKey(event: React.KeyboardEvent): GridKey | null {
  if (event.key === "Enter") return { type: "Enter" };
  if (event.key === "Tab")
    return event.shiftKey ? { type: "ShiftTab" } : { type: "Tab" };
  if (event.key === "Escape") return { type: "Esc" };
  if (event.key === "ArrowUp") return { type: "ArrowUp" };
  if (event.key === "ArrowDown") return { type: "ArrowDown" };
  if (event.key === "ArrowLeft") return { type: "ArrowLeft" };
  if (event.key === "ArrowRight") return { type: "ArrowRight" };
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return { type: "Char", char: event.key };
  }
  return null;
}

export interface DailyGridProps {
  rows: EmployeeRow[];
  statusOptions: StatusOption[];
  /** Отправка ТОЛЬКО дельт. */
  onSubmit: (changes: RowChange[]) => void;
  emptyLabel?: string;
  /** Надпись кнопки отправки дельт: канон-кнопку «Сдать день» забирает панель
   * сдачи — кнопка грида день НЕ сдаёт. */
  submitLabel?: string;
  /** Число дельт → экрану (beforeunload и подтверждение смены даты). */
  onDirtyChange?: (changedCount: number) => void;
  submitting?: boolean;
}

export function DailyGrid({
  rows,
  statusOptions,
  onSubmit,
  emptyLabel = "Личный состав не загружен",
  submitLabel = "Сохранить правки",
  onDirtyChange,
  submitting = false,
}: DailyGridProps) {
  const initials = useMemo(() => initialsOf(rows), [rows]);
  const prevInitialsRef = useRef(initials);
  const [values, dispatch] = useReducer(valuesReducer, initials);

  useEffect(() => {
    if (prevInitialsRef.current === initials) return;
    dispatch({ type: "RESYNC", initials, prevInitials: prevInitialsRef.current });
    prevInitialsRef.current = initials;
  }, [initials]);

  const [cellState, setCellState] = useState<CellState>("NAVIGATE");
  const [position, setPosition] = useState<Position>({ row: 0, col: 1 });
  /** Pre-edit значение открытой правки — его возвращает Esc. */
  const preEditRef = useRef<RowValue | null>(null);
  /** Фильтр type-ahead открытого комбобокса + активный кандидат. */
  const [filter, setFilter] = useState("");
  const [candidate, setCandidate] = useState(0);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const editorRef = useRef<HTMLInputElement>(null);

  const bounds: Bounds = useMemo(
    () => ({ rows: rows.length, cols: COLUMN_KINDS.length, columnKinds: COLUMN_KINDS }),
    [rows.length]
  );

  const changed = useMemo(() => {
    const changes: RowChange[] = [];
    for (const row of rows) {
      const value = values[row.id];
      const initial = initials[row.id];
      if (value === undefined || initial === undefined) continue;
      if (value.statusCode !== initial.statusCode || value.period !== initial.period) {
        changes.push({ id: row.id, statusCode: value.statusCode, period: value.period });
      }
    }
    return changes;
  }, [rows, values, initials]);

  useEffect(() => {
    onDirtyChange?.(changed.length);
  }, [changed.length, onDirtyChange]);

  const candidates = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("ru");
    if (needle === "") return statusOptions;
    return statusOptions.filter((option) =>
      option.label.toLocaleLowerCase("ru").includes(needle)
    );
  }, [filter, statusOptions]);

  const focusCell = useCallback((next: Position) => {
    const cell = cellRefs.current.get(`${next.row}:${next.col}`);
    cell?.focus();
  }, []);

  useEffect(() => {
    if (cellState === "NAVIGATE") focusCell(position);
    else editorRef.current?.focus();
  }, [cellState, position, focusCell]);

  const commitEdit = useCallback(
    (rowIndex: number) => {
      const row = rows[rowIndex];
      if (row === undefined) return;
      const picked = candidates[Math.min(candidate, candidates.length - 1)];
      if (picked !== undefined) {
        dispatch({ type: "SET_STATUS", id: row.id, statusCode: picked.code });
      }
    },
    [rows, candidates, candidate]
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    if (rows.length === 0) return;
    const key = toKey(event);
    if (key === null) return;
    // Tab в NAVIGATE отдаётся браузеру на краях? Нет: роверная модель — Tab
    // всегда ходит по гриду; выход из грида — мышью или Ctrl+Enter экрана.
    event.preventDefault();
    event.stopPropagation();

    const result = transition({ state: cellState, position, bounds, key });

    switch (result.action) {
      case "OPEN_EDIT":
        preEditRef.current = values[rows[result.nextPosition.row]?.id ?? ""] ?? null;
        setFilter("");
        setCandidate(0);
        break;
      case "OPEN_PERIOD":
        preEditRef.current = values[rows[result.nextPosition.row]?.id ?? ""] ?? null;
        break;
      case "TYPE_AHEAD":
        if (cellState === "NAVIGATE") {
          // из NAVIGATE — открыть комбобокс с seed
          preEditRef.current = values[rows[result.nextPosition.row]?.id ?? ""] ?? null;
          setFilter(result.seed ?? "");
        } else {
          setFilter((current) => current + (result.seed ?? ""));
        }
        setCandidate(0);
        break;
      case "LIST_MOVE":
        setCandidate((current) => {
          const delta = key.type === "ArrowUp" ? -1 : 1;
          const max = Math.max(0, candidates.length - 1);
          const next = current + delta;
          return next < 0 ? 0 : next > max ? max : next;
        });
        break;
      case "COMMIT":
        if (cellState === "EDIT") commitEdit(position.row);
        // PERIOD_EDIT коммитится вводом напрямую (управляемое поле).
        preEditRef.current = null;
        break;
      case "RESTORE_PRE_EDIT": {
        const row = rows[position.row];
        const preEdit = preEditRef.current;
        if (row !== undefined && preEdit !== null) {
          dispatch({ type: "SET_STATUS", id: row.id, statusCode: preEdit.statusCode });
          dispatch({ type: "SET_PERIOD", id: row.id, period: preEdit.period });
        }
        preEditRef.current = null;
        break;
      }
      default:
        break;
    }

    setCellState(result.nextState);
    setPosition(result.nextPosition);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <p role="status" className="text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      </div>
    );
  }

  const labelOf = (code: string) =>
    statusOptions.find((option) => option.code === code)?.label ?? code;

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 text-xs text-muted-foreground">
        Слепой ввод: стрелки — навигация, Enter или буква на колонке «Статус» —
        правка с фильтром по подписи, Enter — подтвердить и вниз, Tab — вправо,
        Esc — вернуть прежнее значение.
      </p>
      <div onKeyDown={handleKeyDown}>
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              {COLUMN_TITLES.map((title) => (
                <TableHead key={title}>{title}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => {
              const value = values[row.id];
              const initial = initials[row.id];
              const dirty =
                value !== undefined &&
                initial !== undefined &&
                (value.statusCode !== initial.statusCode ||
                  value.period !== initial.period);
              return (
                <TableRow
                  key={row.id}
                  className={dirty ? "bg-amber-50 dark:bg-amber-950/20" : ""}
                >
                  {COLUMN_KINDS.map((kind, colIndex) => {
                    const focused =
                      position.row === rowIndex && position.col === colIndex;
                    const editingHere =
                      focused && (cellState === "EDIT" || cellState === "PERIOD_EDIT");
                    return (
                      <TableCell
                        key={kind}
                        ref={(node) => {
                          if (node !== null)
                            cellRefs.current.set(`${rowIndex}:${colIndex}`, node);
                        }}
                        tabIndex={focused && cellState === "NAVIGATE" ? 0 : -1}
                        onClick={() => {
                          setCellState("NAVIGATE");
                          setPosition({ row: rowIndex, col: colIndex });
                        }}
                        className={`outline-none ${
                          focused ? "ring-2 ring-primary/60 ring-inset rounded-sm" : ""
                        }`}
                      >
                        {kind === "readonly" && (
                          <span>
                            {row.fullName}
                            {row.rank !== undefined && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                {row.rank}
                              </span>
                            )}
                          </span>
                        )}
                        {kind === "status" &&
                          (editingHere && cellState === "EDIT" ? (
                            <div className="relative">
                              <input
                                ref={editorRef}
                                aria-label={`Статус: ${row.fullName}`}
                                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                                value={filter}
                                placeholder={labelOf(value?.statusCode ?? "")}
                                // Ввод идёт через грамматику (onKeyDown выше);
                                // onChange глушится — иначе символ пришёл бы
                                // дважды.
                                onChange={() => undefined}
                              />
                              <ul className="absolute z-10 mt-1 max-h-48 w-72 overflow-y-auto rounded-md border bg-card p-1 shadow-lg">
                                {candidates.length === 0 ? (
                                  <li className="px-2 py-1 text-xs text-muted-foreground">
                                    Нет совпадений — Esc вернёт прежнее значение.
                                  </li>
                                ) : (
                                  candidates.map((option, index) => (
                                    <li
                                      key={option.code}
                                      className={`cursor-pointer rounded px-2 py-1 text-sm ${
                                        index === candidate
                                          ? "bg-primary text-primary-foreground"
                                          : ""
                                      }`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        dispatch({
                                          type: "SET_STATUS",
                                          id: row.id,
                                          statusCode: option.code,
                                        });
                                        setCellState("NAVIGATE");
                                      }}
                                    >
                                      {option.label}
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                          ) : (
                            <span className={dirty ? "font-semibold" : ""}>
                              {labelOf(value?.statusCode ?? row.statusCode)}
                            </span>
                          ))}
                        {kind === "period" &&
                          (editingHere && cellState === "PERIOD_EDIT" ? (
                            <input
                              ref={editorRef}
                              type="date"
                              aria-label={`Период: ${row.fullName}`}
                              className="rounded-md border bg-background px-2 py-1 text-sm"
                              value={value?.period ?? ""}
                              onChange={(event) =>
                                dispatch({
                                  type: "SET_PERIOD",
                                  id: row.id,
                                  period: event.target.value,
                                })
                              }
                              // Клавиши даты живут в поле; Enter/Tab/Esc
                              // перехватывает onKeyDown контейнера.
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {value?.period === "" || value?.period === undefined
                                ? "—"
                                : value.period}
                            </span>
                          ))}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={changed.length === 0 || submitting}
          onClick={() => onSubmit(changed)}
        >
          {submitLabel}
        </button>
        <span className="text-xs text-muted-foreground">
          Изменено {changed.length} из {rows.length}
        </span>
      </div>
    </div>
  );
}
