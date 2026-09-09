"use client";

/**
 * Блок «на какие мероприятия привлечён» — ОДИН на два окна (Plane №367, Ш-2
 * задачи №365).
 *
 * ОТКУДА ВЗЯЛСЯ. Блок жил внутри окна расхода (`features/daily-expense/ui/
 * SetStatusDialog.tsx`) и был там единственным местом, где человека можно
 * привлечь на ОМ. Заказчик по №365 просит того же в ПОРТАЛЬНОМ окне статуса
 * («Участие на ОМ должно быть как статус На дежурстве, должен выбираться
 * группы и Физнаряд»). Второе окно с теми же тремя списками означало бы вторую
 * копию правил — а правил тут больше, чем кажется: роль принадлежит СВОЕЙ
 * группе, у физнаряда ролей нет вовсе, смена вида обязана сбрасывать роль,
 * загрузка и пустота списка — разные состояния. Поэтому блок вынут целиком, а
 * не переписан рядом.
 *
 * ЧТО ОСТАЛОСЬ ЗА ГРАНИЦЕЙ БЛОКА. Он не знает, каким статусом это записывать и
 * в какую ручку — это дело окна. Он отвечает на один вопрос: «на какие ОМ и
 * кем именно».
 */
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { useParticipationCatalog } from "@/hooks/use-participation-catalog";
import {
  branchOfKind,
  ParticipationKindPicker,
  type ParticipationBranch,
} from "@/features/event-participation/ui/ParticipationKindPicker";

/** Мероприятие в списке выбора: подпись собирает вызывающий. */
export interface ParticipationEventOption {
  id: string;
  label: string;
}

/** Строка черновика: мероприятие, вид участия и роль (у групп). */
export interface ParticipationDraft {
  eventId: string;
  kindCode: string;
  roleCode: string;
  branch?: ParticipationBranch;
}

export const EMPTY_PARTICIPATION_ROW: ParticipationDraft = {
  eventId: "",
  kindCode: "",
  roleCode: "",
};

/** Тело, которое ждёт ручка раздела ОМ. */
export interface ParticipationPayload {
  event_id: number | null;
  kind_code: string;
  role_code?: string;
}

export function participationsToPayload(
  rows: ParticipationDraft[]
): ParticipationPayload[] {
  return rows.map((row) => ({
    event_id: row.eventId === "" ? null : Number(row.eventId),
    kind_code: row.kindCode,
    role_code: row.roleCode === "" ? undefined : row.roleCode,
  }));
}

interface KindRow {
  code: string;
  label: string;
  roles: { code: string; label: string }[];
}

/**
 * Проверка черновика ДО отправки. Возвращает текст отказа либо `null`.
 *
 * Проверять на клиенте приходится потому, что сервер отвечает картой
 * `participations.0.role_code`, а показать её человеку окно может только
 * строкой — и «Роль принадлежит другой группе» без номера строки в окне с
 * тремя мероприятиями не говорит ничего.
 */
export function validateParticipations(
  rows: ParticipationDraft[],
  kinds: KindRow[]
): string | null {
  for (const [index, row] of rows.entries()) {
    if (row.kindCode === "") {
      return `Строка ${index + 1}: выберите мероприятие и вид участия.`;
    }
    if (row.eventId === "" && row.kindCode !== "PHYSICAL_SQUAD") {
      return `Строка ${index + 1}: выберите мероприятие для группы.`;
    }
    const kind = kinds.find((item) => item.code === row.kindCode) ?? null;
    if (kind !== null && kind.roles.length > 0 && row.roleCode === "") {
      return `Строка ${index + 1}: у группы «${kind.label}» выберите роль.`;
    }
  }
  return null;
}

interface EventParticipationFieldsProps {
  rows: ParticipationDraft[];
  onChange: (next: ParticipationDraft[]) => void;
  /** Запросы уходят только при открытом окне и выбранном статусе участия. */
  enabled: boolean;
  /** Подпись блока — окна называют одно и то же по-своему. */
  title?: string;
  hint?: string;
  /** 🔴 СПИСОК МЕРОПРИЯТИЙ ДАЁТ ОКНО, А НЕ БЛОК (Plane №737).
   *
   * Раньше блок сам ходил в реестр ОМ (`useSecurityEvents`). Это связывало
   * его с правом `event.view`, которого у начальника управления нет и не
   * будет (Реестр ОМ закрыт этой роли решением заказчика №348) — то есть
   * список у того, кому блок и предназначен, был бы пуст или 403. Откуда
   * брать мероприятия, знает окно: портальное — из заявок на сбор сил своего
   * управления (решение заказчика по №737), любое будущее — из своего
   * источника. Докстринг модуля обещает ровно это: блок отвечает на вопрос
   * «на какие ОМ и кем именно», а не «где их взять». */
  events: ParticipationEventOption[];
  eventsPending?: boolean;
  eventsError?: boolean;
  /** Пустота и отказ — РАЗНЫЕ состояния, и оба называются словами. */
  eventsEmptyText?: string;
  eventsErrorText?: string;
}

export function EventParticipationFields({
  rows,
  onChange,
  enabled,
  title = "Мероприятия",
  hint = "Человек может быть причастен к нескольким ОМ, и на каждом идти по-своему.",
  events,
  eventsPending = false,
  eventsError = false,
  eventsEmptyText = "Мероприятий нет — привлекать не на что",
  eventsErrorText = "Список мероприятий не ответил — выбирать не из чего.",
}: EventParticipationFieldsProps) {
  const catalog = useParticipationCatalog(enabled);
  const eventList = events;
  const kinds = catalog.data ?? [];
  const patchRow = (index: number, patch: Partial<ParticipationDraft>): void => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { ...EMPTY_PARTICIPATION_ROW }])}
        >
          + Мероприятие
        </Button>
      </div>

      {eventsError && (
        <p className="text-sm text-destructive-ink" role="alert">
          {eventsErrorText}
        </p>
      )}

      {rows.map((row, index) => {
        return (
          <div
            key={index}
            /* ДВЕ РАЗНЫЕ БЕДЫ ОДНОЙ СТРОКИ, и лечатся они порознь.
               (1) `min-w-0` у ячеек: без него длинное название ОМ распирает
               колонку по своему содержимому, строка выходит за ширину окна и
               обрезается С ОБЕИХ СТОРОН — вместе с заголовком и кнопкой.
               (2) `[&>span]:truncate` у триггеров: ячейка-то сжимается, а
               подпись ВНУТРИ поля продолжает рисоваться во всю длину и
               наезжает на соседнее поле. Поймано снимком экрана 31.08.2026 в
               портальном окне (Plane №367): «ОМ-2026-10 · Сценарий 2 — полный
               прогон» наползал на «Группа досмотра».
               Ассерты «текст на месте» не видят ни того, ни другого: текст на
               месте в обоих случаях. */
            className="grid min-w-0 items-start gap-2 md:grid-cols-[minmax(0,1fr)_minmax(18rem,2fr)_auto]"
          >
            <Select
              value={row.eventId}
              onValueChange={(value) => patchRow(index, { eventId: value })}
            >
              <SelectTrigger
                className="w-full min-w-0 [&>span]:truncate"
                aria-label={`Мероприятие ${index + 1}`}
              >
                <SelectValue
                  placeholder={
                    row.kindCode === "PHYSICAL_SQUAD"
                      ? "Мероприятие (необязательно)"
                      : "Мероприятие"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {/* ЗАГРУЗКА И ПУСТОТА — РАЗНЫЕ СОСТОЯНИЯ, и молчать нельзя ни
                    в одном: пустой список читается как «мероприятий нет» и
                    тогда, когда запрос ещё идёт. Поймано пробой в полном
                    прогоне — под нагрузкой реестр отвечал не сразу, и окно
                    показывало пустоту как факт. */}
                {eventsPending && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Загружаем мероприятия…
                  </div>
                )}
                {!eventsPending && eventList.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {eventsEmptyText}
                  </div>
                )}
                {eventList.map((event) => (
                  <SelectItem key={event.id} value={String(event.id)}>
                    {event.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {row.kindCode === "PHYSICAL_SQUAD" && row.eventId === "" && (
              <p className="col-span-full text-xs text-muted-foreground md:col-span-2">
                Для физнаряда мероприятие можно определить позже штабом.
              </p>
            )}

            <ParticipationKindPicker
              id={`participation-${index + 1}`}
              branch={row.branch ?? (row.kindCode ? branchOfKind(row.kindCode) : "")}
              kindCode={row.kindCode}
              roleCode={row.roleCode}
              kinds={kinds}
              onBranchChange={(branch) =>
                patchRow(index, {
                  branch,
                  kindCode: branch === "PHYSICAL" ? "PHYSICAL_SQUAD" : "",
                  roleCode: "",
                })
              }
              onKindChange={(value) =>
                // Смена группы сбрасывает специальность: она принадлежит
                // конкретной группе, и переносить её в другую нельзя.
                patchRow(index, { branch: "GROUP", kindCode: value, roleCode: "" })
              }
              onRoleChange={(value) => patchRow(index, { roleCode: value })}
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Убрать мероприятие ${index + 1}`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
