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
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ForceCollectionRow } from "@/entities/security-event";
import { useForceCollections } from "@/hooks/use-force-collections";
import { ForceCollectionCard } from "./ForceCollectionCard";
import { ForceCampaignsPanel } from "./ForceCampaignsPanel";
import { formatIsoDate } from "@/shared/lib/date";
import styles from "./ForceCollectionsTable.module.css";


function Progress({ done, need }: { done: number; need: number }) {
  const percent = need > 0 ? Math.min(100, Math.round((done / need) * 100)) : 0;
  const over = need > 0 && done > need;
  return (
    <div className={styles.progress}>
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /**
   * Карточка открывается НА МЕСТЕ списка, как у департамента (№272) и как на
   * эталоне («← Назад к списку сборов»).
   *
   * 🔴 ОТКРЫТЫЙ СБОР ЖИВЁТ В АДРЕСЕ (`?collection=`, Plane №779). Он стоял в
   * `useState`, и адреса у доски не было вовсе: уведомление штабу «Первый
   * департамент выделяет 2 из 3» вести было НЕКУДА, ссылку у него выставили
   * `null` осознанно. Теперь ссылка ведёт прямо в дело — как у запроса
   * управлению с №392.
   *
   * `replace`, а не `push`: открытие карточки — не шаг навигации, и «назад»
   * после трёх сборов обязано вернуть туда, откуда пришли, а не пройти их в
   * обратном порядке. То же решение, что у выбора объекта посещения (№388).
   */
  //
  // 🔴 ПУСТОЕ ЗНАЧЕНИЕ — ЭТО «НЕ ОТКРЫТО» (найдено ревью №825). `?collection=`
  // (без значения) даёт `""`, а не `null`: проверка `opened !== null` его
  // пропускала, карточка монтировалась с пустым `eventId` и просила у сервера
  // `…/forces/collection//`.
  const opened = searchParams.get("collection") || null;
  const openedCampaign = searchParams.get("campaign") || null;
  const setOpened = useCallback(
    (value: string | null) => {
      const next = new URLSearchParams(searchParams);
      next.delete("campaign");
      if (value === null) next.delete("collection");
      else next.set("collection", value);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );
  const setOpenedCampaign = useCallback(
    (value: string | null) => {
      const next = new URLSearchParams(searchParams);
      next.delete("collection");
      if (value === null) next.delete("campaign");
      else next.set("campaign", value);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  if (opened !== null) {
    // `enabled` доезжает и до карточки (найдено ревью №825): раньше её можно
    // было открыть только нажатием по строке загруженного списка, то есть
    // выключённый список молчал за обоих. С переездом в адрес карточка
    // открывается прямой ссылкой, и без этой передачи она уходила на сервер
    // в обход собственного гарда экрана.
    return (
      <ForceCollectionCard
        eventId={opened}
        enabled={enabled}
        onBack={() => setOpened(null)}
      />
    );
  }

  if (openedCampaign !== null) {
    return (
      <ForceCampaignsPanel
        enabled={enabled}
        collectionRows={rows}
        openedId={openedCampaign}
        onOpen={setOpenedCampaign}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <ForceCampaignsPanel
        enabled={enabled}
        collectionRows={rows}
        openedId={null}
        onOpen={setOpenedCampaign}
      />
    <section aria-labelledby="force-collections-heading" className="space-y-3">
      <div>
        <h2 id="force-collections-heading" className="text-lg font-semibold">
          Сборы сил
        </h2>
        <p className="text-muted-foreground text-sm">
          Один сбор на всё ОМ: потребность и распределение сил по всем объектам посещения
        </p>
      </div>

      {collections.isPending ? (
        <div data-slot="table-container" role="status" aria-busy className="space-y-3 rounded-lg border p-4">
          <p className="text-muted-foreground text-sm">Загрузка сборов…</p>
          {[0, 1, 2].map((index) => (
            <div key={index} className="bg-muted h-9 w-full animate-pulse rounded" aria-hidden />
          ))}
        </div>
      ) : collections.isError ? (
        <div data-slot="table-container" className="min-w-0 space-y-3 rounded-lg border p-4">
          <p role="alert" className="text-destructive-ink break-words text-sm">
            {collections.error?.message ?? "Не удалось загрузить сборы"}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 whitespace-normal"
            disabled={!enabled || collections.isFetching}
            onClick={() => { if (enabled) void collections.refetch(); }}
          >
            {collections.isFetching ? "Загружаю…" : "Повторить загрузку сборов"}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div data-slot="table-container" className="space-y-3 rounded-lg border p-4">
          <p role="status" className="text-muted-foreground text-sm">
            Сборов нет. Обновите список, чтобы проверить, появились ли новые сборы.
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!enabled || collections.isFetching}
            onClick={() => { if (enabled) void collections.refetch(); }}
          >
            {collections.isFetching ? "Обновляю…" : "Обновить сборы"}
          </Button>
        </div>
      ) : (
      <div className={`${styles.wrap} rounded-lg border`}>
        <Table className={styles.table} role="table" aria-label="Сборы сил">
          <TableHeader>
            <TableRow>
              {/* Колонки `[СБС-10]` (Plane №426): код · название · дата ·
                  потребность · выделяют · прислано · статус. */}
              <TableHead>Мероприятие</TableHead>
              <TableHead>Дата ОМ</TableHead>
              <TableHead className="text-right">Потребность</TableHead>
              <TableHead className="text-right">Запрошено</TableHead>
              <TableHead className="text-right">Выделяют</TableHead>
              <TableHead>Прислано</TableHead>
              <TableHead className="text-right">Недобор</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={collections.isFetching}>
            {rows.map((row: ForceCollectionRow) => (
                <TableRow
                  key={row.eventId}
                  data-slot="force-collection-row"
                  data-urgent={row.urgent ? "true" : "false"}
                  data-new={row.isNew ? "true" : "false"}
                >
                  <TableCell>
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {row.code}
                      </Badge>
                      {/* «Срочно» и «Новая» — бейджи `[СБС-10]`; порядок строк
                          (срочные и новые сверху) задаёт сервер. */}
                      {row.urgent && (
                        <Badge variant="destructive" data-slot="collection-urgent">
                          Срочно
                        </Badge>
                      )}
                      {row.isNew && (
                        <Badge variant="outline" data-slot="collection-new">
                          Новая
                        </Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpened(row.eventId)}
                      className="hover:text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm text-left font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2"
                    >
                      {row.title}
                    </button>
                    {row.visitObjects === undefined ? (
                      <p className="text-muted-foreground text-xs">
                        Объекты посещения — в карточке сбора
                      </p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Объекты ОМ: {row.visitObjects.length}</p>
                        {row.visitObjects.length > 0 && (
                          <ol aria-label="Объекты посещения" className="flex max-w-md flex-wrap gap-x-3 gap-y-1 text-xs">
                            {row.visitObjects.map((visit, index) => (
                              <li key={visit.visitObjectId} className="whitespace-normal break-words">
                                <span className="text-muted-foreground">{index + 1}. </span>{visit.objectName}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                    <p className="text-muted-foreground text-xs">
                      {[
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
                    <span className={styles.label} aria-hidden="true">Дата ОМ</span>
                    {formatIsoDate(row.businessDate)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    <span className={styles.label} aria-hidden="true">Потребность</span>
                    {row.need}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={styles.label} aria-hidden="true">Запрошено</span>
                    <span data-slot="collection-requested">{row.requested}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={styles.label} aria-hidden="true">Выделяют</span>
                    <span data-slot="collection-allocating">{row.allocating}</span>
                  </TableCell>
                  <TableCell data-slot="collection-sent">
                    <span className={styles.label} aria-hidden="true">Прислано</span>
                    <Progress done={row.sent} need={row.need} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums"><span className={styles.label} aria-hidden="true">Недобор</span><span data-slot="collection-shortage">{row.shortage}</span></TableCell>
                  <TableCell>
                    <span className={styles.label} aria-hidden="true">Статус</span>
                    <Badge variant="outline" data-slot="collection-status">
                      {row.boardStatus.label}
                    </Badge>
                    {(row.overdueCount ?? 0) > 0 && (
                      <p className="text-destructive-ink mt-1 text-xs">
                        просрочено заявок: {row.overdueCount ?? 0}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpened(row.eventId)}
                      aria-label={`Открыть сбор ${row.code}`}
                      className="min-h-11 whitespace-nowrap"
                    >
                      Открыть сбор
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      )}
    </section>
    </div>
  );
}
