"use client";

/**
 * Карточка заявки департаменту (Plane №272, Ш-4).
 *
 * Четыре плитки, распределение по управлениям с правкой квот и список
 * выделенных — состав из эталона заказчика.
 *
 * КЛЮЧЕВАЯ СТРОКА ЭТАЛОНА, ради которой сделан весь эпик: «Статус „На ОМ
 * (физнаряд)“ проставляют начальники управлений — выделенные сотрудники
 * появляются здесь автоматически». Это не подпись, а описание механики,
 * построенной в №274 Ш-5: список собирается ИЗ СТАТУСОВ, а не из ручного
 * набора штаба. Подпись оставлена дословно, потому что она отвечает на
 * вопрос «почему тут люди, которых я не добавлял».
 *
 * ПРАВКА КВОТ ЗАПЕРТА ПОСЛЕ ЗАПРОСА УПРАВЛЕНИЙ — правило сервера (Ш-1), и
 * экран его ПОВТОРЯЕТ, а не заменяет: поля выключаются и рядом стоит причина.
 * Выключить без объяснения значит оставить человека гадать, что он сделал не
 * так.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ForceAllocationDirectorate } from "@/entities/security-event";
import {
  useDepartmentRequest,
  useNotifyDepartmentDirectorates,
  useRespondDepartmentAllocation,
  useSplitDirectorateQuotas,
  useSubmitDepartmentAllocation,
  useWithdrawDepartmentAllocation,
} from "@/hooks/use-department-requests";
import { apiClient, type CoreDivision } from "@/lib/api";
import { formatIsoDate } from "@/shared/lib/date";

/**
 * Управления ДЕПАРТАМЕНТА заявки — из общего справочника оргструктуры, а не
 * из `allocation.directorates` (Plane №389).
 *
 * 🔴 ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ЗАПРОС, А НЕ `allocation.directorates` НАПРЯМУЮ.
 * `directorates[]` заводит ПЕРВОЕ действие цепочки (`split` или `notify`,
 * обе службы читают дерево оргструктуры сами) — до него список пуст. Таблица
 * ниже рендерилась ИЗ ЭТОГО ПОЛЯ и потому была пуста при первом визите
 * ВСЕГДА: ни строки, ни поля ввода, ни кнопки «Сохранить раскладку» — форма
 * штатного Ш-4 не могла создать первую раскладку сама, только править уже
 * существующую. `/api/core/divisions/` не требует `forces.*` вовсе (это
 * справочник оргструктуры, не звено цепочки), поэтому годится ответственному
 * за департамент, у которого `event.view` нет и не будет.
 */
function useDepartmentDirectorates(departmentId: string | undefined) {
  const divisions = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
    enabled: departmentId !== undefined,
  });
  const directorates = useMemo(() => {
    if (departmentId === undefined) return [];
    const parent = Number(departmentId);
    return (divisions.data ?? []).filter(
      (division) =>
        division.type_code === "directorate" &&
        division.parent === parent &&
        // 🔴 АРХИВНЫЕ УПРАВЛЕНИЯ СЮДА НЕ ПОПАДАЮТ (Plane №530). Сервер
        // (`split_directorate_quotas`) знает только `is_active=True` и
        // отбивает ВСЁ тело «Управление не найдено в департаменте» — то есть
        // одно архивное управление в департаменте делало сохранение
        // раскладки невозможным вообще, а пустое состояние карточки при этом
        // обещало «действующих управлений».
        division.is_active !== false
    );
  }, [divisions.data, departmentId]);
  // 🔴 ОТКАЗ СПРАВОЧНИКА — НЕ ФАКТ ОБ ОРГСТРУКТУРЕ (Plane №531). `isLoading`
  // деструктурировался и выбрасывался, а `isError` не возвращался вовсе:
  // пока справочник грузился или если он отказал, экран УТВЕРЖДАЛ, что у
  // департамента нет управлений, и молча прятал блок сохранения с кнопкой
  // рассылки. Человек читал поломку связи как решённый вопрос про структуру.
  return {
    directorates,
    isLoading: divisions.isPending,
    isError: divisions.isError,
    error: divisions.error,
    refetch: divisions.refetch,
  };
}

export function DepartmentRequestCard({
  allocationId,
  onBack,
}: {
  allocationId: string;
  onBack: () => void;
}) {
  const request = useDepartmentRequest(allocationId);
  const detail = request.data;
  const allocation = detail?.allocation;
  const locked = allocation !== undefined && allocation.status !== "DRAFT";

  const split = useSplitDirectorateQuotas(detail?.eventId ?? "", allocationId);
  const notify = useNotifyDepartmentDirectorates(detail?.eventId ?? "", allocationId);
  const submit = useSubmitDepartmentAllocation(detail?.eventId ?? "", allocationId);
  const respond = useRespondDepartmentAllocation(detail?.eventId ?? "", allocationId);
  const withdraw = useWithdrawDepartmentAllocation(detail?.eventId ?? "", allocationId);
  const [submitOpen, setSubmitOpen] = useState(false);
  // Запрос управлений НЕОБРАТИМ (Plane №532): после него сервер запирает
  // квоты (`DIRECTORATE_QUOTAS_LOCKED`) навсегда — отзыв списка возвращает
  // заявку в `NOTIFIED`, а не в `DRAFT`. Такое действие спрашивают, а не
  // выполняют по одному щелчку.
  const [notifyOpen, setNotifyOpen] = useState(false);
  // Ответ «Выделяем: X · Комментарий» (Plane №391). Черновик наполняется ИЗ
  // ОТВЕТА сервера тем же доводом, что и квоты ниже: пустое поле над
  // сохранённой цифрой читалось бы как «ноль», а ноль здесь — отказ.
  const [answer, setAnswer] = useState<{ allocating: string; comment: string }>({
    allocating: "",
    comment: "",
  });
  useEffect(() => {
    if (allocation === undefined) return;
    setAnswer({
      allocating:
        allocation.allocating === null || allocation.allocating === undefined
          ? ""
          : String(allocation.allocating),
      comment: allocation.answerComment ?? "",
    });
  }, [allocation]);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const {
    directorates: orgDirectorates,
    isLoading: orgLoading,
    isError: orgFailed,
    error: orgError,
    refetch: refetchOrg,
  } = useDepartmentDirectorates(allocation?.departmentId);
  /** Строки таблицы = дерево оргструктуры, дополненное тем, что уже известно
   *  заявке (квота, выделено, оповещено). Управление, выбывшее из дерева, но
   *  ещё живущее в заявке (см. `split_directorate_quotas`), не теряется —
   *  тем же правилом, что и на сервере: его след — факт. */
  const directorateRows = useMemo(() => {
    const known = new Map(allocation?.directorates.map((row) => [row.divisionId, row]) ?? []);
    const merged: ForceAllocationDirectorate[] = orgDirectorates.map((division) => {
      const id = String(division.id);
      const existing = known.get(id);
      known.delete(id);
      return (
        existing ?? {
          id: `force-directorate-${id}`,
          divisionId: id,
          name: division.name,
          need: 0,
          assigned: 0,
          notifiedAt: null,
        }
      );
    });
    return [...merged, ...known.values()];
  }, [orgDirectorates, allocation?.directorates]);

  // Черновик наполняется ИЗ СВОДНОГО СПИСКА, а не из одного `allocation.
  // directorates` (Plane №389, `[СБС-21]`/`[СБС-22]`): до первого действия
  // цепочки заявка не знает о СВОИХ управлениях ничего, и форма, читавшая
  // только `allocation.directorates`, была пуста при первом визите ВСЕГДА —
  // ни строки, ни поля, ни кнопки «Сохранить». Пустое поле над сохранённой
  // квотой читается как «ноль», и человек сохранил бы ноль, ничего не
  // набрав, — черновик поэтому не заводится пустым.
  useEffect(() => {
    setDraft(
      Object.fromEntries(directorateRows.map((row) => [row.divisionId, String(row.need ?? 0)]))
    );
  }, [directorateRows]);

  if (request.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="bg-muted h-8 w-64 animate-pulse rounded" aria-hidden />
        <div className="bg-muted h-40 w-full animate-pulse rounded" aria-hidden />
      </div>
    );
  }

  if (request.isError || detail === undefined || allocation === undefined) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к заявкам
        </Button>
        <p role="alert" className="text-destructive-ink text-sm">
          {request.error?.message ?? "Заявка не открылась"}
        </p>
      </div>
    );
  }

  const quota = allocation.need;
  // ПРЕДЕЛ РАСКЛАДКИ — ОТ «ВЫДЕЛЯЕМ» (`[СБС-22]`, Plane №392): раскладывать
  // между управлениями департамент обязан СВОЮ цифру, а не запрос штаба.
  // Пока ответа нет — запрос штаба, как и раньше.
  const splitCap =
    allocation.allocating === null || allocation.allocating === undefined
      ? quota
      : allocation.allocating;
  const splitTotal = allocation.directorates.reduce(
    (sum, row) => sum + (row.need ?? 0),
    0
  );
  const assigned = allocation.members.length;
  const draftTotal = Object.values(draft).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );
  // Набрано, но не сохранено (Plane №532). Оповещение перерисовывает карточку
  // ответом сервера, и `useEffect` выше сбрасывает черновик на сохранённые
  // цифры — набранное молча исчезает. Разница считается по СТРОКАМ таблицы,
  // а не по сумме: две правки, гасящие друг друга (+2 одному, −2 другому),
  // дают ту же сумму и тоже пропадут.
  // Строки, которые ПРАВЯТСЯ: только действующие управления дерева. Выбывшие
  // остаются в таблице (их след — факт), но без поля ввода и мимо запроса.
  const orgIds = new Set(orgDirectorates.map((division) => String(division.id)));
  const editableRows = directorateRows.filter((row) => orgIds.has(row.divisionId));
  const splitDirty = directorateRows.some(
    (row) => (Number(draft[row.divisionId]) || 0) !== (row.need ?? 0)
  );

  async function save() {
    await split.mutateAsync({
      // 🔴 УЕЗЖАЮТ ТОЛЬКО СТРОКИ ДЕРЕВА (Plane №530). Таблица показывает и
      // управления, ВЫБЫВШИЕ из оргструктуры, но ещё живущие в заявке — их
      // след это факт, и стирать его нельзя (сервер их тоже сохраняет). Но
      // отправлять их в запрос нельзя тем более: сервер сверяет каждую строку
      // с действующими управлениями департамента и отбивает ВСЁ тело целиком.
      // Раскладка не сохранялась вовсе, а убрать выбывшую строку из формы
      // человеку было нечем.
      rows: editableRows.map((row) => ({
        divisionId: row.divisionId,
        need: Number(draft[row.divisionId]) || 0,
      })),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к заявкам
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {detail.code}
          </Badge>
          <Badge variant="outline">{allocation.departmentName}</Badge>
        </div>
        <h2 className="text-xl font-semibold">{detail.title}</h2>
        <p className="text-muted-foreground text-sm">
          {formatIsoDate(detail.businessDate)} · {detail.location}
          {detail.eventTime !== null ? ` · ${detail.eventTime}` : ""}
        </p>
      </div>

      {/* ШАПКА-ОТВЕТ (`[СБС-21]`, Plane №391): «Запрошено штабом: N ·
          Выделяем: [ввод] · Комментарий: [ввод]». Цифру ставит только
          ответственный, штаб читает. Ограничений нет — меньше, больше, 0;
          «0» закрывает запрос статусом «Отказ». Правится до отправки
          списка. Комментарий необязателен: при цифре меньше запрошенной —
          подсказка «желательно пояснить», без блокировки. */}
      <section
        aria-labelledby="answer-heading"
        className="rounded-lg border p-4 space-y-3"
        data-slot="department-answer"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="answer-heading" className="font-semibold">
            Ответ департамента
          </h3>
          <p className="text-muted-foreground text-sm">
            Запрошено штабом: <b className="tabular-nums text-foreground">{quota}</b>
          </p>
        </div>
        {allocation.status === "DECLINED" && (
          <p role="status" className="text-destructive-ink text-sm">
            Запрос закрыт отказом («Выделяем: 0»). Поставьте ненулевую цифру,
            чтобы снять отказ.
          </p>
        )}
        {(() => {
          const answerLocked =
            allocation.status === "SUBMITTED" || allocation.status === "ACCEPTED";
          const parsed = Number.parseInt(answer.allocating, 10);
          const short = Number.isFinite(parsed) && parsed > 0 && parsed < quota;
          const dirty =
            answer.allocating !==
              (allocation.allocating === null || allocation.allocating === undefined
                ? ""
                : String(allocation.allocating)) || answer.comment !== (allocation.answerComment ?? "");
          return (
            <>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="answer-allocating">Выделяем</Label>
                  <Input
                    id="answer-allocating"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="tabular-nums"
                    disabled={answerLocked || respond.isPending}
                    value={answer.allocating}
                    onChange={(event) =>
                      setAnswer((prev) => ({ ...prev, allocating: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="answer-comment">Комментарий</Label>
                  <Input
                    id="answer-comment"
                    disabled={answerLocked || respond.isPending}
                    value={answer.comment}
                    placeholder={short ? "Желательно пояснить, почему меньше" : "Необязательно"}
                    onChange={(event) =>
                      setAnswer((prev) => ({ ...prev, comment: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  disabled={answerLocked || respond.isPending || answer.allocating === "" || !dirty}
                  onClick={() =>
                    respond.mutate({
                      allocating: Number.parseInt(answer.allocating, 10),
                      comment: answer.comment,
                    })
                  }
                >
                  {respond.isPending ? "Сохраняю…" : "Сохранить ответ"}
                </Button>
                {answerLocked ? (
                  <p className="text-muted-foreground text-sm">
                    Список уже у штаба — цифра правится до отправки
                  </p>
                ) : short && answer.comment.trim() === "" ? (
                  // Подсветка без блокировки — ровно как в спецификации.
                  <p className="text-sm text-amber-700">
                    Меньше запрошенного на {quota - parsed} — желательно пояснить
                  </p>
                ) : parsed === 0 && answer.allocating !== "" ? (
                  <p className="text-muted-foreground text-sm">
                    «0» закроет запрос отказом
                  </p>
                ) : null}
              </div>
              {respond.isError && (
                <p role="alert" className="text-destructive-ink text-sm">
                  {respond.error?.message ?? "Ответ не сохранился"}
                </p>
              )}
            </>
          );
        })()}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Плитки — ОБЩИЕ (`StatCard` из набора прототипа), а не свои.
            Первая версия рисовала собственные и красила их выдуманными
            токенами `text-success-ink`, которых в системе нет вовсе: класс
            молча отрисовался бы как ничто, и «зелёное» число оказалось бы
            обычным. */}
        <StatCard
          label="Квота департамента"
          value={quota}
          caption="Сколько просит штаб"
        />
        <StatCard
          label="Разложено по управлениям"
          value={splitTotal}
          tone={splitTotal > splitCap ? "danger" : "neutral"}
          caption={
            splitTotal > splitCap
              ? `Больше «Выделяем» на ${splitTotal - splitCap}`
              : `Ещё не разложено ${Math.max(0, splitCap - splitTotal)}`
          }
        />
        <StatCard
          label="Выделено"
          value={assigned}
          tone="success"
          caption="Люди со статусом участия"
        />
        <StatCard
          label="Осталось"
          value={Math.max(0, quota - assigned)}
          tone={assigned > quota ? "danger" : "info"}
          caption={
            assigned > quota
              ? `Выделено сверх квоты на ${assigned - quota}`
              : "До закрытия квоты"
          }
        />
      </div>

      <section aria-labelledby="split-heading" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="split-heading" className="font-semibold">
              Распределение по управлениям
            </h3>
            <p className="text-muted-foreground text-sm">
              {locked
                ? "Управления уже запрошены — цифры правятся до запроса"
                : allocation.allocating === null || allocation.allocating === undefined
                  ? "Разложите запрос по управлениям и отправьте им — начальники получат уведомление"
                  : `Разложите «Выделяем: ${allocation.allocating}» по управлениям и отправьте им`}
            </p>
          </div>
          {/* 🔴 КНОПКА, КОТОРОЙ НЕ БЫЛО (Plane №389, `[СБС-22]`). До правки
              оповестить свои управления мог только штаб — из панели
              мероприятия, куда у ответственного за департамент нет доступа
              (`event.view` не выдаётся этой роли намеренно). Ручка на
              сервере оповещение по СВОЕМУ департаменту всегда разрешала —
              кнопки не было НА ЭТОМ экране.
              Условие НЕ читает `allocation.directorates`: `notify_directorates`
              сама заводит строки управлений из дерева оргструктуры при первом
              вызове (см. `useDepartmentDirectorates` выше) — требовать
              непустой список означало бы просить департамент раскладывать
              несуществующие строки, чтобы получить кнопку их создать. */}
          {directorateRows.length > 0 && !locked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={notify.isPending || split.isPending}
              onClick={() => setNotifyOpen(true)}
            >
              {notify.isPending ? "Отправляю…" : "Отправить в управления"}
            </Button>
          )}
        </div>
        {notify.isError && (
          <p role="alert" className="text-destructive-ink text-sm">
            {notify.error?.message ?? "Управления не оповещены"}
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Колонки — эталон `[СБС-22]`: «Управление | Запрошено |
                    Проставлено „Участие в ОМ“ | Статус». «В строю» из эталона
                    здесь нет намеренно: строевой численности управления у
                    заявки нет, а тянуть расход дня ради колонки — второй
                    источник числа, который разошёлся бы с экраном расхода. */}
                <TableHead>Управление</TableHead>
                <TableHead className="w-32">Запрошено</TableHead>
                <TableHead>Проставлено «Участие в ОМ»</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {directorateRows.length === 0 && orgLoading && (
                <TableRow>
                  <TableCell colSpan={4}>
                    {/* Справочник ещё едет — сказать это, а не выдать ожидание
                        за ответ (Plane №531). */}
                    <div
                      className="bg-muted h-5 w-64 animate-pulse rounded"
                      aria-label="Управления департамента загружаются"
                    />
                  </TableCell>
                </TableRow>
              )}
              {directorateRows.length === 0 && orgFailed && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal">
                    {/* 🔴 ОТКАЗ НАЗВАН ОТКАЗОМ (Plane №531). Здесь стояло
                        «нет действующих управлений» — утверждение об
                        оргструктуре, сделанное по молчанию сети. Причина
                        сервера остаётся на экране: без неё поддержке нечего
                        спросить. */}
                    <p role="alert" className="text-destructive-ink text-sm">
                      Справочник подразделений не ответил — список управлений
                      департамента неизвестен.
                      {orgError?.message ? ` ${orgError.message}` : ""}{" "}
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 align-baseline"
                        onClick={() => void refetchOrg()}
                      >
                        Повторить
                      </Button>
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {directorateRows.length === 0 && !orgLoading && !orgFailed && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      {/* Пусто означает РОВНО ОДНО: справочник ответил, и в
                          дереве оргструктуры у департамента нет ни одного
                          действующего управления — а не «не загрузилось» и не
                          «раскладка ещё не начата». */}
                      У департамента «{allocation.departmentName}» нет
                      действующих управлений — раскладывать некуда.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {directorateRows.map((row: ForceAllocationDirectorate) => (
                <TableRow key={row.divisionId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    {orgIds.has(row.divisionId) ? (
                      <>
                        <Label className="sr-only" htmlFor={`quota-${row.divisionId}`}>
                          Квота управления «{row.name}»
                        </Label>
                        <Input
                          id={`quota-${row.divisionId}`}
                          type="number"
                          min={0}
                          inputMode="numeric"
                          className="w-24 tabular-nums"
                          disabled={locked || split.isPending}
                          value={draft[row.divisionId] ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              [row.divisionId]: event.target.value,
                            }))
                          }
                        />
                      </>
                    ) : (
                      // Управление выбыло из оргструктуры: квота остаётся
                      // видимой как факт, но править её нечем — сервер такую
                      // строку не примет и отобьёт вместе с ней всю раскладку
                      // (Plane №530).
                      <span className="text-muted-foreground tabular-nums text-sm">
                        {row.need ?? 0} · не в оргструктуре
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.assigned ?? 0} из {row.need ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.notifiedAt === null
                      ? "Не запрошено"
                      : (row.assigned ?? 0) >= (row.need ?? 0) && (row.need ?? 0) > 0
                        ? "Выделено"
                        : `Запрошено ${formatIsoDate(row.notifiedAt)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Кнопка живёт при наличии ПРАВИМЫХ строк, а не любых (Plane №530):
            у заявки, где все управления выбыли из оргструктуры, сохранять
            нечего — запрос ушёл бы пустым и ничего не менял. */}
        {!locked && editableRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={split.isPending}>
              {split.isPending ? "Сохраняем…" : "Сохранить раскладку"}
            </Button>
            {/* Итог НАБРАННОГО, а не сохранённого: он про черновик, о котором
                сервер ещё не знает. Перебор называется до нажатия — сервер
                отобьёт его и сам, но узнать об этом заранее дешевле. */}
            <p
              className={`text-sm ${draftTotal > splitCap ? "text-destructive-ink" : "text-muted-foreground"}`}
            >
              Набрано {draftTotal} из {splitCap}
              {draftTotal > splitCap ? ` · перебор ${draftTotal - splitCap}` : ""}
            </p>
          </div>
        )}

        {split.isError && (
          <p role="alert" className="text-destructive-ink text-sm">
            {split.error?.message ?? "Раскладка не сохранилась"}
          </p>
        )}
      </section>

      <section aria-labelledby="members-heading" className="space-y-3">
        <div>
          <h3 id="members-heading" className="font-semibold">
            Выделенные сотрудники
          </h3>
          <p className="text-muted-foreground text-sm">
            Статус «Привлечён на мероприятие» проставляют начальники управлений
            — выделенные сотрудники появляются здесь автоматически
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Сотрудник</TableHead>
                <TableHead>Подразделение</TableHead>
                <TableHead>Откуда</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocation.members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      Никого не выделено — начальники управлений ещё не
                      проставили статусы
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {allocation.members.map((member) => (
                <TableRow key={member.employeeId}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.divisionName || "—"}
                  </TableCell>
                  <TableCell>
                    {/* Источник назван словом: у строки «из статуса» нет
                        записи штаба, и снять её как выделение нельзя —
                        кнопка обещала бы то, чего не может. */}
                    <Badge variant={member.source === "STATUS" ? "secondary" : "outline"}>
                      {member.source === "STATUS" ? "По статусу" : "Выделен штабом"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* 🔴 КНОПКА, КОТОРОЙ НЕ БЫЛО (Plane №389, `[СБС-23]`): «Отправить
            список в штаб» жила только на панели мероприятия у ШТАБА
            (`ForcesSplitPanel`), куда у ответственного за департамент нет
            доступа. Ручка `.../submit/` разрешала действие СВОЕМУ
            департаменту всегда — экрана не было. */}
        {(allocation.status === "NOTIFIED" || allocation.status === "RETURNED") && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={submit.isPending}
              onClick={() => setSubmitOpen(true)}
            >
              Отправить список в штаб
            </Button>
            {assigned < quota && (
              <p className="text-muted-foreground text-sm">
                Недобор {quota - assigned} — список можно отправить и так,
                штаб решит, довыделять или принять как есть.
              </p>
            )}
          </div>
        )}
        {/* 🔴 ОТЗЫВ БЕЗ ПАНЕЛИ ШТАБА (Plane №532). Диалог отправки обещает
            «отозвать список», а единственная кнопка отзыва жила в
            `ForcesSplitPanel` за правом `event.view`, которого этой роли не
            дают: обещание было невыполнимым ровно для того, кто его читал.
            Ручка отзыва гейтится тем же `forces.allocate` со скопом своего
            департамента, что и отправка. Подтверждения нет намеренно —
            действие обратное (список отправляется заново той же кнопкой) и
            повторяет поведение штабной панели. */}
        {allocation.status === "SUBMITTED" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Отправлено — ждём решения штаба.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate({})}
            >
              {withdraw.isPending ? "Отзываю…" : "Отозвать список"}
            </Button>
          </div>
        )}
        {withdraw.isError && (
          <p role="alert" className="text-destructive-ink text-sm">
            {withdraw.error?.message ?? "Список не отозван"}
          </p>
        )}
        {allocation.status === "RETURNED" && allocation.decisionComment !== "" && (
          <p role="alert" className="text-destructive-ink text-sm">
            Возвращено штабом: {allocation.decisionComment}
          </p>
        )}
      </section>

      {/* ПОДТВЕРЖДЕНИЕ ЗАПРОСА УПРАВЛЕНИЙ (Plane №532). Кнопка слала мутацию
          сразу: один случайный щелчок запирал раскладку насовсем — сервер
          после `NOTIFIED` отвечает на правку квот `DIRECTORATE_QUOTAS_LOCKED`,
          а отзыв списка возвращает заявку в `NOTIFIED`, не в `DRAFT`. Диалог
          называет обе цены действия: необратимость и судьбу несохранённого
          черновика. */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить заявку в управления?</DialogTitle>
            <DialogDescription>
              Начальники управлений получат уведомление и начнут выделять
              людей. После этого раскладку по управлениям не поправить —
              ни правкой, ни отзывом списка.
              {splitDirty
                ? " Набранные, но не сохранённые цифры пропадут: кнопка ниже сохранит раскладку и только потом отправит."
                : ""}
            </DialogDescription>
          </DialogHeader>
          {/* Числа рядом с решением, а не в голове у человека: сравнивать
              «сколько разложено» с «сколько выделяем» после закрытия диалога
              будет уже поздно. Показывается НАБРАННОЕ, когда оно расходится с
              сохранённым, — отправлять будем именно его. */}
          <p className="text-muted-foreground text-sm">
            Разложено {splitDirty ? draftTotal : splitTotal} из {splitCap}
            {(splitDirty ? draftTotal : splitTotal) < splitCap
              ? ` · не разложено ${splitCap - (splitDirty ? draftTotal : splitTotal)}`
              : ""}
          </p>
          {(split.isError || notify.isError) && (
            <p role="alert" className="text-destructive-ink text-sm">
              {split.error?.message ??
                notify.error?.message ??
                "Управления не оповещены"}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={notify.isPending || split.isPending}
              onClick={() => {
                // Сохранение и оповещение — ДВА запроса, и второй идёт
                // только после успеха первого: иначе несохранённая
                // раскладка запиралась бы вместе с сохранённой.
                void (async () => {
                  if (splitDirty) {
                    try {
                      await save();
                    } catch {
                      return;
                    }
                  }
                  notify.mutate({}, { onSuccess: () => setNotifyOpen(false) });
                })();
              }}
            >
              {notify.isPending || split.isPending
                ? "Отправляю…"
                : splitDirty
                  ? "Сохранить и отправить"
                  : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить список в штаб?</DialogTitle>
            <DialogDescription>
              {/* Подтверждение спецификации `[СБС-13]`: «при недоборе —
                  подтверждение с комментарием». Комментария к отправке у
                  этого шага нет — штаб видит недобор числом на своей
                  карточке (Ш-5 плана №74) и решает там; здесь только
                  предупреждение, чтобы отправка «не глядя» не выглядела как
                  сбой.
                  🔴 НОЛЬ — ОТДЕЛЬНЫЙ СЛУЧАЙ, а не «недобор в 100 %»: сервер
                  отвечает `ALLOCATION_EMPTY` и отправку отклоняет вовсе
                  («Никто не выделен — отправлять нечего»), пока недобор
                  1..N-1 отправить можно — решает штаб. Формулировка не
                  обещает то, чего действие не сделает. */}
              {assigned === 0
                ? "Никто ещё не выделен — штаб получит пустой список. Отправить всё равно?"
                : assigned < quota
                  ? `Выделено ${assigned} из ${quota} — отправить список с недобором ${quota - assigned}?`
                  : `Выделено ${assigned} из ${quota} — список полный, отправить штабу?`}
              {" "}Раскладку по управлениям после отправки не поправить:
              отзыв возвращает список в работу, но квоты управлений остаются
              прежними.
            </DialogDescription>
          </DialogHeader>
          {submit.isError && (
            <p role="alert" className="text-destructive-ink text-sm">
              {submit.error?.message ?? "Список не отправлен"}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={submit.isPending}
              onClick={() => {
                submit.mutate(
                  {},
                  { onSuccess: () => setSubmitOpen(false) }
                );
              }}
            >
              {submit.isPending ? "Отправляю…" : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
