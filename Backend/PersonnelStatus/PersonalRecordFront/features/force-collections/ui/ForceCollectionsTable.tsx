"use client";

/**
 * «Сборы» — список мероприятий, с которых штаб собирает силы (Plane №271, Ш-1).
 *
 * ЗЕРКАЛО ДЕПАРТАМЕНТСКОГО РАЗРЕЗА (№272). Департамент спрашивает «что просят
 * у меня», штаб — «сколько я раздал и сколько мне вернули». Колонки, порядок и
 * действия не совпадают, поэтому это своя таблица, а не та же под фильтром.
 *
 * СРОК ПОЯВИЛСЯ, НО ОН НЕ У МЕРОПРИЯТИЯ (Plane №287). На эталоне колонка
 * называется «Срок сбора»; в системе срок сдачи списка принадлежит КАЖДОЙ
 * заявке отдельно — штаб назначает его департаментам по отдельности, и общей
 * даты у сбора нет. Поэтому колонка здесь по-прежнему «Дата ОМ», а про сроки
 * строка отвечает единственным, что имеет смысл для сбора целиком: сколько
 * заявок просрочено. Сами сроки — в разрезе департамента (№272).
 *
 * Прогресс — И ЧИСЛОМ, И ПОЛОСОЙ, и с объявлением для тех, кто читает экран
 * не глазами: полоса сама по себе не отвечает на вопрос «сколько именно».
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ForceCollectionRow,
  ForceCollectionStatus,
} from "@/entities/security-event";
import { useForceCollections } from "@/hooks/use-force-collections";
import { ForceCollectionCard } from "./ForceCollectionCard";
import { formatIsoDate } from "@/shared/lib/date";

/** Подписи ровно те, что на эталоне заказчика. */
const STATUS_LABEL: Record<ForceCollectionStatus, string> = {
  NEW: "Новый",
  NOTIFIED: "Разнарядка разослана",
  IN_PROGRESS: "Сбор идёт",
};

function Progress({ done, need }: { done: number; need: number }) {
  const percent = need > 0 ? Math.min(100, Math.round((done / need) * 100)) : 0;
  const over = need > 0 && done > need;
  return (
    <div className="min-w-[130px]">
      <p className="text-sm tabular-nums">
        {done} из {need}
        {over && (
          <span className="text-destructive-ink ml-1 text-xs">
            · сверх {done - need}
          </span>
        )}
      </p>
      <div
        className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={need}
        aria-label={`Собрано ${done} из ${need}`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function ForceCollectionsTable({ enabled = true }: { enabled?: boolean }) {
  const collections = useForceCollections({ enabled });
  const rows = collections.data?.results ?? [];
  // Карточка открывается НА МЕСТЕ списка, как у департамента (№272) и как на
  // эталоне («← Назад к списку сборов»).
  const [opened, setOpened] = useState<string | null>(null);

  if (opened !== null) {
    return <ForceCollectionCard eventId={opened} onBack={() => setOpened(null)} />;
  }

  return (
    <section aria-labelledby="force-collections-heading" className="space-y-3">
      <div>
        <h2 id="force-collections-heading" className="text-lg font-semibold">
          Сборы сил
        </h2>
        <p className="text-muted-foreground text-sm">
          Мероприятия, с которых штаб собирает силы с департаментов
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Мероприятие</TableHead>
              <TableHead>Дата ОМ</TableHead>
              <TableHead className="text-right">Требуется</TableHead>
              <TableHead>Прогресс сбора</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={collections.isPending}>
            {collections.isPending &&
              [0, 1, 2].map((index) => (
                <TableRow key={index}>
                  <TableCell colSpan={6}>
                    <div
                      className="bg-muted h-9 w-full animate-pulse rounded"
                      aria-hidden
                    />
                  </TableCell>
                </TableRow>
              ))}

            {!collections.isPending && collections.isError && (
              <TableRow>
                <TableCell colSpan={6}>
                  <p role="alert" className="text-destructive-ink text-sm">
                    {collections.error?.message ??
                      "Сборы не загрузились — список показать нечем"}
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!collections.isPending && !collections.isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="whitespace-normal">
                  <p className="text-muted-foreground text-sm">
                    Сборов нет — ни у одного мероприятия ещё не посчитана
                    потребность в силах
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!collections.isPending &&
              !collections.isError &&
              rows.map((row: ForceCollectionRow) => (
                <TableRow key={row.eventId}>
                  <TableCell>
                    <Badge variant="secondary" className="mb-1 font-mono text-[11px]">
                      {row.code}
                    </Badge>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {/* Место может быть не заполнено — тогда не печатаем
                          пустой разделитель, он читается как потерянные
                          данные. */}
                      {[
                        row.location,
                        row.eventTime,
                        row.departments > 0
                          ? `департаментов: ${row.departments}`
                          : "раскладки нет",
                      ]
                        .filter((part) => part !== null && part !== "")
                        .join(" · ")}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatIsoDate(row.businessDate)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {row.need}
                  </TableCell>
                  <TableCell>
                    <Progress done={row.gathered} need={row.need} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {STATUS_LABEL[row.collectionStatus]}
                    </Badge>
                    {/* ОТСТАЮЩИЕ НАЗВАНЫ ЧИСЛОМ И СЛОВОМ. Штабу важно не
                        «когда срок», а «есть ли те, кто его прошёл»: сроки у
                        заявок разные, и одна дата на сбор была бы выдумкой. */}
                    {(row.overdueCount ?? 0) > 0 && (
                      <p className="text-destructive-ink mt-1 text-xs font-medium">
                        Просрочено заявок: {row.overdueCount}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setOpened(row.eventId)}
                      aria-label={`Открыть сбор ${row.code}`}
                      className="text-muted-foreground hover:text-foreground inline-flex size-11 items-center justify-center rounded-md"
                    >
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
