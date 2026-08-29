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
import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

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
import type {
  ForceAllocationRow,
  ForceCollectionStatus,
} from "@/entities/security-event";
import { useForceCollection } from "@/hooks/use-force-collections";
import { formatIsoDate } from "@/shared/lib/date";

const STATUS_LABEL: Record<ForceCollectionStatus, string> = {
  NEW: "Новый",
  NOTIFIED: "Разнарядка разослана",
  IN_PROGRESS: "Сбор идёт",
};

function DepartmentRow({ row }: { row: ForceAllocationRow }) {
  const [open, setOpen] = useState(false);
  const members = row.members ?? [];
  const need = row.need ?? 0;
  const percent = need > 0 ? Math.min(100, Math.round((members.length / need) * 100)) : 0;
  const over = need > 0 && members.length > need;

  return (
    <>
      <TableRow>
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
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{need}</TableCell>
        <TableCell>
          <div className="min-w-[130px]">
            <p className="text-sm tabular-nums">
              {members.length} из {need}
              {over && (
                <span className="text-destructive-ink ml-1 text-xs">
                  · сверх {members.length - need}
                </span>
              )}
            </p>
            <div
              className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={members.length}
              aria-valuemin={0}
              aria-valuemax={need}
              aria-label={`${row.departmentName}: собрано ${members.length} из ${need}`}
            >
              <div
                className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">
          {row.status === "DRAFT" ? "Разнарядка не разослана" : "Разнарядка разослана"}
        </TableCell>
      </TableRow>

      {open && (
        <TableRow>
          <TableCell colSpan={4} className="bg-muted/40">
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
                    {/* Откуда человек взялся — штабу это нужно не меньше, чем
                        департаменту: строку «по статусу» он не выделял. */}
                    <Badge variant={member.source === "STATUS" ? "secondary" : "outline"}>
                      {member.source === "STATUS" ? "По статусу" : "Выделен штабом"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </TableCell>
        </TableRow>
      )}
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
          <Badge variant="outline">{STATUS_LABEL[data.collectionStatus]}</Badge>
        </div>
        <h2 className="text-xl font-semibold">{data.title}</h2>
        <p className="text-muted-foreground text-sm">
          {[formatIsoDate(data.businessDate), data.location, data.eventTime]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>

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
                <TableHead>Департамент</TableHead>
                <TableHead className="text-right">Квота</TableHead>
                <TableHead>Собрано</TableHead>
                <TableHead>Разнарядка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      Раскладки нет — штаб ещё не решил, кому сколько.
                      Разложить можно в ленте входящих на этом же экране.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {data.allocations.map((row) => (
                <DepartmentRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
