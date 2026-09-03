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
  useSplitDirectorateQuotas,
  useSubmitDepartmentAllocation,
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
      (division) => division.type_code === "directorate" && division.parent === parent
    );
  }, [divisions.data, departmentId]);
  return { directorates, isLoading: divisions.isPending };
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
  const [submitOpen, setSubmitOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { directorates: orgDirectorates } = useDepartmentDirectorates(
    allocation?.departmentId
  );
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
  const splitTotal = allocation.directorates.reduce(
    (sum, row) => sum + (row.need ?? 0),
    0
  );
  const assigned = allocation.members.length;
  const draftTotal = Object.values(draft).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );

  async function save() {
    await split.mutateAsync({
      rows: Object.entries(draft).map(([divisionId, value]) => ({
        divisionId,
        need: Number(value) || 0,
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
          tone={splitTotal > quota ? "danger" : "neutral"}
          caption={
            splitTotal > quota
              ? `Больше квоты на ${splitTotal - quota}`
              : `Ещё не разложено ${quota - splitTotal}`
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
                ? "Управления уже запрошены — квоты правятся до запроса"
                : "Квоты редактируются до запроса управлений"}
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
              disabled={notify.isPending}
              onClick={() => notify.mutate({})}
            >
              {notify.isPending ? "Оповещаю…" : "Оповестить управления"}
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
                <TableHead>Управление</TableHead>
                <TableHead className="w-32">Квота</TableHead>
                <TableHead>Выделено</TableHead>
                <TableHead>Оповещено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {directorateRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      {/* Пусто теперь означает РОВНО ОДНО: в дереве
                          оргструктуры у департамента нет ни одного
                          действующего управления — а не «раскладка ещё не
                          начата» (та причина закрыта самим бутстрапом выше). */}
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
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.assigned ?? 0} из {row.need ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.notifiedAt === null ? "—" : "Запрошено"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {!locked && directorateRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={split.isPending}>
              {split.isPending ? "Сохраняем…" : "Сохранить раскладку"}
            </Button>
            {/* Итог НАБРАННОГО, а не сохранённого: он про черновик, о котором
                сервер ещё не знает. Перебор называется до нажатия — сервер
                отобьёт его и сам, но узнать об этом заранее дешевле. */}
            <p
              className={`text-sm ${draftTotal > quota ? "text-destructive-ink" : "text-muted-foreground"}`}
            >
              Набрано {draftTotal} из {quota}
              {draftTotal > quota ? ` · перебор ${draftTotal - quota}` : ""}
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
        {allocation.status === "SUBMITTED" && (
          <p className="text-muted-foreground text-sm">
            Отправлено — ждём решения штаба.
          </p>
        )}
        {allocation.status === "RETURNED" && allocation.decisionComment !== "" && (
          <p role="alert" className="text-destructive-ink text-sm">
            Возвращено штабом: {allocation.decisionComment}
          </p>
        )}
      </section>

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
              {" "}После отправки раскладку по управлениям не поправить —
              только отозвать список целиком.
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
