"use client";

/**
 * Карточка сбора — вид ШТАБА (Plane №271, Ш-2).
 *
 * Состав из эталона: четыре плитки, общий прогресс и распределение по
 * департаментам, где строка РАСКРЫВАЕТСЯ до списка выделенных.
 *
 * ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ — действий. Раскладка квот, рассылка разнарядки и
 * приёмка уже реализованы в `ForcesSplitPanel` и обвешаны пробами; вторая
 * реализация тех же правил разошлась бы с первой при первой же правке. Пока
 * панель живёт лентой входящих штаба, карточка отвечает на вопрос «как идёт
 * сбор», а не подменяет её. Перенос действий сюда — отдельная работа, и
 * делать его молча, попутно, значило бы переписать проверенное поведение без
 * отдельной проверки.
 *
 * РАСКРЫТИЕ — деталь не косметическая. Заказчик просит видеть поимённо, кого
 * департамент уже отдал; без этого «5 из 46» остаётся числом, за которым
 * нельзя проверить, тех ли людей прислали.
 */
import { Fragment, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ForceAllocationRow } from "@/entities/security-event";
import {
  useAssignRosterObjects,
  useForceCollection,
  useHandOverToPlacement,
  useTopUpAllocation,
  type ForceCollectionWithObjects,
} from "@/hooks/use-force-collections";
import { formatIsoDate } from "@/shared/lib/date";


const ALLOCATION_STATUS: Record<string, string> = {
  DRAFT: "Не отправлен",
  NOTIFIED: "Отправлен",
  SUBMITTED: "Список прислан",
  ACCEPTED: "Принят",
  RETURNED: "Возвращён",
  DECLINED: "Отказ",
};

/**
 * Строка департамента `[СБС-12]`: Запрошено · Выделяют · Прислано ·
 * Комментарий · Статус · Ответственный; раскрытие — люди и история строк
 * запроса из таблиц `[МД-06]`; «Довыделить недобор → …» — новая строка
 * запроса тому же департаменту (старая не правится).
 */
function DepartmentRow({ row, eventId }: { row: ForceAllocationRow; eventId: string }) {
  const [open, setOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [count, setCount] = useState("");
  const topUp = useTopUpAllocation(eventId);
  const members = row.members ?? [];
  const need = row.need ?? 0;
  const sent = row.sent ?? members.length;
  const allocating = row.allocating ?? null;
  /**
   * НЕДОБОР, ОПРАВДЫВАЮЩИЙ ДОВЫДЕЛЕНИЕ, — это `need − allocating`, а не
   * `need − sent` (Plane №679).
   *
   * 🔴 `sent` — сколько людей ФИЗИЧЕСКИ попало в список; `allocating` — сколько
   * департамент ПООБЕЩАЛ в ответ на запрос. Пока считалось по `sent`, кнопка
   * «Довыделить недобор» вылезала сразу после отправки запроса — до того, как
   * департамент вообще успел ответить, — с подставленным ПОЛНЫМ `need`.
   * Департамент, ответивший «выделяем 5 из 5», но ещё не сдавший список,
   * всё равно показывал недобор 5, и одно нажатие слало второй запрос ещё на
   * пять, удваивая запрошенное.
   *
   * Департамент ещё не ответил (`allocating === null`) — недобора НЕТ:
   * «сколько не хватит» неизвестно, пока не сказано «сколько дадим».
   * Довыделять нечего, и кнопки нет.
   */
  const shortage = allocating === null ? 0 : Math.max(0, need - allocating);
  const canTopUp = row.status !== "DRAFT" && shortage > 0;
  return (
    <>
      <TableRow data-slot="department-row" data-top-up-of={row.topUpOf ?? ""}>
        <TableCell>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="inline-flex items-center gap-2 text-left font-medium"
          >
            {open ? (
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            )}
            {row.departmentName || `Департамент ${row.departmentId}`}
          </button>
          {row.topUpOf && (
            <p className="text-muted-foreground text-xs">довыделение</p>
          )}
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{need}</TableCell>
        <TableCell className="text-right tabular-nums" data-slot="department-allocating">
          {allocating === null ? <span className="text-muted-foreground">—</span> : allocating}
        </TableCell>
        <TableCell className="tabular-nums" data-slot="department-sent">
          {sent} из {need}
        </TableCell>
        <TableCell className="text-muted-foreground max-w-[220px] truncate text-sm">
          {row.answerComment || row.comment || "—"}
        </TableCell>
        <TableCell className="text-sm" data-slot="department-status">
          {ALLOCATION_STATUS[row.status] ?? row.status}
        </TableCell>
        <TableCell className="text-sm" data-slot="department-responsible">
          {row.responsibleName || <span className="text-muted-foreground">не назначен</span>}
        </TableCell>
        <TableCell>
          {canTopUp && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCount(String(shortage));
                setTopUpOpen(true);
              }}
            >
              Довыделить недобор →
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/40">
            <p className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
              Выделенные сотрудники
            </p>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Департамент ещё никого не выделил
              </p>
            ) : (
              <ul className="space-y-1">
                {members.map((member) => (
                  <li
                    key={member.employeeId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="font-medium">{member.name}</span>
                    <span className="text-muted-foreground">
                      {member.divisionName || "подразделение не указано"}
                    </span>
                    <Badge variant={member.source === "STATUS" ? "secondary" : "outline"}>
                      {member.source === "STATUS" ? "По статусу" : "Выделен штабом"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {(row.history ?? []).length > 1 && (
              <div className="mt-3" data-slot="department-history">
                <p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
                  История запроса
                </p>
                <ul className="space-y-0.5 text-xs">
                  {(row.history ?? []).map((item) => (
                    <li key={item.sequence} className="tabular-nums">
                      №{item.sequence} · запрошено {item.requested}
                      {item.allocating !== null ? ` · выделяют ${item.allocating}` : ""} ·{" "}
                      {ALLOCATION_STATUS[item.status] ?? item.status} ·{" "}
                      {new Date(item.recordedAt).toLocaleString("ru-RU")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Довыделить недобор — {row.departmentName}</DialogTitle>
            <DialogDescription>
              Уйдёт новой строкой запроса: прежние цифры не меняются и не удаляются.
              Недобор сейчас — {shortage}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`top-up-${row.id}`}>Сколько человек довыделить</Label>
            <Input
              id={`top-up-${row.id}`}
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          {topUp.error && (
            <p role="alert" className="text-destructive-ink text-sm">
              {topUp.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTopUpOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={topUp.isPending || Number(count) < 1}
              onClick={() =>
                topUp.mutate(
                  { allocationId: row.id, count: Number(count) },
                  { onSuccess: () => setTopUpOpen(false) }
                )
              }
            >
              {topUp.isPending ? "Отправка…" : "Отправить запрос"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ForceCollectionCard({
  eventId,
  onBack,
}: {
  eventId: string;
  onBack: () => void;
}) {
  const collection = useForceCollection(eventId);
  const data = collection.data;

  if (collection.isPending) {
    return (
      <div className="space-y-3" aria-busy>
        <div className="bg-muted h-8 w-64 animate-pulse rounded" aria-hidden />
        <div className="bg-muted h-40 w-full animate-pulse rounded" aria-hidden />
      </div>
    );
  }

  if (collection.isError || data === undefined) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к списку сборов
        </Button>
        <p role="alert" className="text-destructive-ink text-sm">
          {collection.error?.message ?? "Сбор не открылся"}
        </p>
      </div>
    );
  }

  // Сумма СТРОК, напечатанных рядом (Plane №678) — она и есть «Итого» блока
  // «Потребность». `data.need` рядом с ними — другой факт: число, которое штаб
  // получил на завершении рекогносцировки и раскладывает; оно заморожено и
  // после правки расчёта расходится с живой суммой.
  const shownNeed = data.needByObject.reduce((sum, item) => sum + item.need, 0);
  const needDiffers = data.needByObject.length > 0 && shownNeed !== data.need;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к списку сборов
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {data.code}
          </Badge>
          <Badge variant="outline" data-slot="collection-status">{data.boardStatus.label}</Badge>
          {data.urgent && (
            <Badge variant="destructive" data-slot="collection-urgent">
              Срочно
            </Badge>
          )}
        </div>
        <h2 className="text-xl font-semibold">{data.title}</h2>
        <p className="text-muted-foreground text-sm">
          {[formatIsoDate(data.businessDate), data.location, data.eventTime]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>

      {/* Блок 1 «Потребность» (`[СБС-11]`, Plane №426): по объектам посещения
          «„Мейрам“ — 8 (рекогносцировка завершена, Тлесов)» → Итого N.

          🔴 «ИТОГО» СЧИТАЕТСЯ ИЗ СТРОК, КОТОРЫЕ НАПЕЧАТАНЫ РЯДОМ (Plane №678).
          Здесь стояло `data.need` — число, замороженное на завершении
          рекогносцировки и с тех пор не пересчитываемое, тогда как строки
          объектов считаются живьём. Поправили `need` поста после
          рекогносцировки — строки изменились, «Итого» нет; оставили пост без
          объекта на ОМ с двумя объектами — он выпадал из строк, но сидел в
          «Итого». Человек читал «„Мейрам“ — 8 · „Рахат“ — 3 · Итого 12» и не
          мог свести. Теперь сумма верна по построению, а расхождение с тем,
          что получил штаб, названо отдельной строкой — это РАЗНЫЕ факты, и
          прятать второй ради первого нельзя. */}
      <section aria-labelledby="collection-need-heading" className="space-y-2" data-slot="collection-need">
        <h3 id="collection-need-heading" className="font-semibold">
          Потребность
        </h3>
        {data.needByObject.length === 0 ? (
          <p className="text-muted-foreground text-sm">Объектов посещения у мероприятия нет.</p>
        ) : (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {data.needByObject.map((item) => (
              <li key={item.visitObjectId || "unassigned"} data-slot="need-by-object">
                {/* Строка «без объекта посещения» — не объект, и кавычек ей не
                    полагается: она про посты, которые объекту не отнесены. */}
                {item.visitObjectId === "" ? (
                  <span>{item.objectName} — </span>
                ) : (
                  <span>«{item.objectName}» — </span>
                )}
                <b className="tabular-nums">{item.need}</b>
                <span className="text-muted-foreground">
                  {" "}
                  ({[item.statusLabel.toLowerCase(), item.chiefName].filter((p) => p !== "").join(", ")})
                </span>
              </li>
            ))}
            <li className="font-semibold" data-slot="need-total">
              Итого {shownNeed}
            </li>
          </ul>
        )}
        {/* Расхождение НАЗЫВАЕТСЯ, а не сглаживается (Plane №678). Штаб делит
            число, полученное на завершении рекогносцировки; расчёт постов
            после этого могли поправить. Оба числа — факты, и молчаливое
            выравнивание одного по другому спрятало бы то, что расчёт
            изменился уже после запроса. */}
        {needDiffers && (
          <p className="text-xs text-amber-800" data-slot="need-mismatch">
            Штабу передано {data.need} — расчёт постов изменился после запроса.
          </p>
        )}
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Требуется по рекогносцировке"
          value={data.need}
          caption="Число, которое делит штаб"
        />
        <StatCard
          label="Распределено квотами"
          value={data.allocated}
          tone={data.allocated > data.need ? "danger" : "neutral"}
          caption={
            data.allocated > data.need
              ? `Больше потребности на ${data.allocated - data.need}`
              : `Ещё не разложено ${data.need - data.allocated}`
          }
        />
        <StatCard
          label="Собрано"
          value={data.gathered}
          tone="success"
          caption="Люди со статусом участия"
        />
        <StatCard
          label="Осталось собрать"
          value={data.remaining}
          tone={data.remaining > 0 ? "info" : "success"}
          caption={data.remaining > 0 ? "До закрытия потребности" : "Потребность закрыта"}
        />
      </div>

      <section aria-labelledby="collection-split-heading" className="space-y-3">
        <div>
          <h3 id="collection-split-heading" className="font-semibold">
            Распределение по департаментам
          </h3>
          <p className="text-muted-foreground text-sm">
            Строка раскрывается — видно поимённо, кого департамент уже отдал
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Колонки `[СБС-12]` (Plane №426). */}
                <TableHead>Департамент</TableHead>
                <TableHead className="text-right">Запрошено</TableHead>
                <TableHead className="text-right">Выделяют</TableHead>
                <TableHead>Прислано</TableHead>
                <TableHead>Комментарий</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Ответственный</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      Раскладки нет — штаб ещё не решил, кому сколько.
                      Разложить можно в ленте входящих на этом же экране.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {data.allocations.map((row) => (
                <DepartmentRow key={row.id} row={row} eventId={data.eventId} />
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm" data-slot="collection-totals">
          Итог: потребность <b className="tabular-nums">{data.totals.need}</b> · выделяют{" "}
          <b className="tabular-nums">{data.totals.allocating}</b> · прислано{" "}
          <b className="tabular-nums">{data.totals.sent}</b> · недобор{" "}
          <b className={`tabular-nums ${data.totals.shortage > 0 ? "text-destructive-ink" : ""}`}>
            {data.totals.shortage}
          </b>
        </p>
      </section>

      <RosterToObjects data={data} />
    </div>
  );
}

/**
 * Блок 3 «Собранные сотрудники → объекты» (`[СБС-13]`, Plane №390).
 *
 * Появляется с первым принятым списком (состав непуст). Слева — люди состава
 * по департаментам с чекбоксами, справа — объекты посещения с ёмкостью
 * «потребность N / назначено M». Отметил → «На объект…» — люди отданы
 * объекту; «Передать на расстановку» — при недоборе диалог с обязательным
 * комментарием. Перетаскивания нет намеренно: чекбоксы + список делают то же
 * с клавиатуры и на планшете, а drag-and-drop без второго пути был бы
 * недоступен половине пользователей.
 *
 * После передачи блок читается, но не правится: распределение — решение
 * штаба, и менять его после того, как старшие объектов начали расставлять,
 * значило бы менять условия задним числом.
 */
function RosterToObjects({ data }: { data: ForceCollectionWithObjects }) {
  const assign = useAssignRosterObjects(data.eventId);
  const handOver = useHandOverToPlacement(data.eventId);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [comment, setComment] = useState("");
  const roster = data.roster ?? [];
  const objects = data.objects ?? [];
  const handedOver = Object.keys(data.handover ?? {}).length > 0;
  if (roster.length === 0) return null;

  const objectName = (id: string | null | undefined) =>
    objects.find((o) => o.visitObjectId === id)?.objectName ?? null;
  const unassigned = roster.filter((m) => !m.visitObjectId).length;
  const shortfall = objects.filter(
    (o) => o.need !== null && o.assigned < o.need
  );
  const byDepartment = new Map<string, typeof roster>();
  for (const member of roster) {
    const key = member.departmentName || "Без департамента";
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), member]);
  }
  const togglePicked = (employeeId: string, on: boolean) =>
    setPicked((prev) => (on ? [...prev, employeeId] : prev.filter((id) => id !== employeeId)));

  return (
    <section aria-labelledby="roster-objects-heading" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="roster-objects-heading" className="font-semibold">
            Собранные сотрудники → объекты
          </h3>
          <p className="text-muted-foreground text-sm">
            {handedOver
              ? `Передано на расстановку ${formatIsoDate((data.handover.at ?? "").slice(0, 10))}${
                  data.handover.comment ? ` · ${data.handover.comment}` : ""
                }`
              : `Прислано ${data.gathered} из ${data.need}${
                  unassigned > 0 ? ` · не распределены: ${unassigned}` : ""
                }`}
          </p>
        </div>
        {!handedOver && (
          <Button
            type="button"
            size="sm"
            disabled={handOver.isPending || unassigned > 0}
            title={unassigned > 0 ? "Сначала отдайте объектам всех собранных" : undefined}
            onClick={() => (shortfall.length > 0 ? setDialogOpen(true) : handOver.mutate({ comment: "" }))}
          >
            {handOver.isPending ? "Передаю…" : "Передать на расстановку"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Сотрудник</TableHead>
                <TableHead>Управление</TableHead>
                <TableHead>Объект</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...byDepartment.entries()].map(([department, members]) => (
                /* 🔴 `Fragment` С КЛЮЧОМ, А НЕ СОКРАЩЁННЫЙ `<>` (Plane №485).
                   Ключ нужен САМОМУ элементу списка; ключи на внутренних
                   строках его не заменяют — сокращённая запись фрагмента
                   атрибутов не принимает вовсе. React ругался «Each child in
                   a list should have a unique key», а при смене состава
                   департаментов группы перерисовывались лишний раз.

                   Предупреждение в консоли здесь дороже, чем кажется: полный
                   прогон требует смотреть на консоль браузера, и постоянное
                   жёлтое обесценивает эту проверку — туда перестают
                   смотреть. */
                <Fragment key={`dep-${department}`}>
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground bg-muted/30 text-xs font-semibold uppercase tracking-wide">
                      {department}
                    </TableCell>
                  </TableRow>
                  {members.map((member) => (
                    <TableRow key={member.employeeId} data-testid={`roster-${member.employeeId}`}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Отметить ${member.name}`}
                          disabled={handedOver}
                          checked={picked.includes(member.employeeId)}
                          onCheckedChange={(on) => togglePicked(member.employeeId, on === true)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell className="text-muted-foreground">{member.divisionName || "—"}</TableCell>
                      <TableCell>
                        {objectName(member.visitObjectId) ?? (
                          <span className="text-muted-foreground">не распределён</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          <ul className="space-y-2">
            {objects.map((object) => {
              const full = object.need !== null && object.assigned >= object.need;
              return (
                <li
                  key={object.visitObjectId}
                  className="rounded-lg border px-3 py-2 text-sm"
                  data-testid={`object-capacity-${object.visitObjectId}`}
                >
                  <div className="font-medium">{object.objectName}</div>
                  <div className={`tabular-nums ${full ? "text-green-700" : "text-muted-foreground"}`}>
                    {object.need === null
                      ? `назначено ${object.assigned} · потребность не размечена`
                      : `потребность ${object.need} / назначено ${object.assigned}`}
                  </div>
                </li>
              );
            })}
          </ul>
          {!handedOver && (
            <div className="space-y-2">
              <label className="text-xs font-semibold" htmlFor="roster-target">
                На объект…
              </label>
              <select
                id="roster-target"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">— выберите объект —</option>
                {objects.map((o) => (
                  <option key={o.visitObjectId} value={o.visitObjectId}>
                    {o.objectName}
                  </option>
                ))}
                <option value="__none__">снять с объекта</option>
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={picked.length === 0 || target === "" || assign.isPending}
                onClick={() =>
                  assign.mutate(
                    {
                      rows: picked.map((employeeId) => ({
                        employeeId,
                        visitObjectId: target === "__none__" ? null : target,
                      })),
                    },
                    { onSuccess: () => setPicked([]) }
                  )
                }
              >
                {assign.isPending
                  ? "Отдаю…"
                  : picked.length === 0
                    ? "Отметьте людей слева"
                    : `Отдать объекту: ${picked.length}`}
              </Button>
              {assign.isError && (
                <p role="alert" className="text-destructive-ink text-xs">
                  {assign.error?.message ?? "Не удалось отдать объекту"}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {handOver.isError && (
        <p role="alert" className="text-destructive-ink text-sm">
          {handOver.error?.message ?? "Передать не удалось"}
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Передать на расстановку с недобором?</DialogTitle>
            <DialogDescription>
              {shortfall
                .map((o) => `«${o.objectName}»: ${o.assigned} из ${o.need}`)
                .join(" · ")}
              . Старшие объектов получат состав меньше потребности — укажите,
              почему; комментарий увидят они и штаб.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Комментарий к передаче с недобором"
            placeholder="Например: остальных доберём к среде"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {handOver.isError && (
            <p role="alert" className="text-destructive-ink text-sm">
              {handOver.error?.message ?? "Передать не удалось"}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={comment.trim() === "" || handOver.isPending}
              onClick={() =>
                handOver.mutate({ comment }, { onSuccess: () => setDialogOpen(false) })
              }
            >
              {handOver.isPending ? "Передаю…" : "Передать с недобором"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
