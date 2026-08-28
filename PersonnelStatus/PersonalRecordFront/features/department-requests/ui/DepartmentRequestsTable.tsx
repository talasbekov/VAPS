"use client";

/**
 * «Заявки» — что просят у МОЕГО департамента (Plane №272, Ш-3).
 *
 * ОБРАТНЫЙ РАЗРЕЗ ЦЕПОЧКИ. Раскладка живёт лентой входящих штаба
 * (`ForcesSplitPanel`): там человек делит потребность между департаментами и
 * смотрит «кому я раздал». Ответственному за расход департамента нужен другой
 * вопрос — «что просят у меня и сколько я уже дал», — и это не то же самое
 * представление под другим фильтром: колонки, порядок и действия другие.
 *
 * ОТКЛОНЕНИЕ ОТ ЭТАЛОНА, названное вслух. На эталоне заказчика третья колонка
 * — «Срок» (дата со временем, за сутки до мероприятия). Такого поля в модели
 * НЕТ ВООБЩЕ: у мероприятия есть своя дата и своё время, а срока сдачи списка
 * не существует. Колонка показывает то, что есть, и называется своими словами
 * — «Дата ОМ». Выдать дату мероприятия за срок сдачи значило бы нарисовать
 * правило, которого в системе нет. Заведена карточка; разбор — в
 * `Frontend/Decisions`.
 *
 * Прогресс — И ЧИСЛОМ, И ПОЛОСОЙ. Полоса сама по себе не читается
 * вспомогательными технологиями и не отвечает на вопрос «сколько именно»;
 * число без полосы не даёт увидеть отставание одним взглядом по столбцу.
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
  DepartmentRequestRow,
  ForceAllocationStatus,
} from "@/entities/security-event";
import { useDepartmentRequests } from "@/hooks/use-department-requests";
import { DepartmentRequestCard } from "./DepartmentRequestCard";
import { formatIsoDate } from "@/shared/lib/date";

/** Подписи те же, что у ленты штаба: одно состояние — одно слово в системе. */
const STATUS_LABEL: Record<ForceAllocationStatus, string> = {
  DRAFT: "Сбор идёт",
  NOTIFIED: "Управления оповещены",
  SUBMITTED: "Список отправлен в штаб",
  ACCEPTED: "Принято штабом",
  RETURNED: "Возвращено департаменту",
};

function Progress({ assigned, need }: { assigned: number; need: number }) {
  const percent = need > 0 ? Math.min(100, Math.round((assigned / need) * 100)) : 0;
  // ПЕРЕБОР ВИДЕН, А НЕ СПРЯТАН. Полоса упирается в 100% и у «5 из 2»
  // выглядит ровно как у «2 из 2» — то есть «всё в порядке». А это разные
  // вещи: во втором случае департамент отдал больше, чем с него просили, и
  // человек имеет право это заметить. Разница названа И цветом, И словом —
  // цвет в одиночку не отвечает на вопрос «что не так» и не читается
  // вспомогательными технологиями.
  const over = need > 0 && assigned > need;
  return (
    <div className="min-w-[120px]">
      <p className="text-sm tabular-nums">
        {assigned} из {need}
        {/* Тем же цветом, которым перебор красит лента штаба
            (`ForcesSplitPanel`): своего токена под это раздел не заводит, а
            выдуманный `warning` не существует в системе вовсе и молча
            отрисовался бы как ничто. */}
        {over && (
          <span className="text-destructive-ink ml-1 text-xs">
            · перебор {assigned - need}
          </span>
        )}
      </p>
      <div
        className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={assigned}
        aria-valuemin={0}
        aria-valuemax={need}
        aria-label={
          over
            ? `Выделено ${assigned} из ${need} — перебор на ${assigned - need}`
            : `Выделено ${assigned} из ${need}`
        }
      >
        <div
          className={`h-full rounded-full transition-[width] ${
            over ? "bg-destructive" : "bg-primary"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function DepartmentRequestsTable({ enabled = true }: { enabled?: boolean }) {
  const requests = useDepartmentRequests({ enabled });
  const rows = requests.data?.results ?? [];
  // Карточка открывается НА МЕСТЕ таблицы, как на эталоне («← Назад к
  // заявкам»), а не уводит на карточку мероприятия: та собрана для штаба и
  // показывает раскладку по ВСЕМ департаментам.
  const [opened, setOpened] = useState<string | null>(null);

  if (opened !== null) {
    return (
      <DepartmentRequestCard allocationId={opened} onBack={() => setOpened(null)} />
    );
  }

  return (
    <section aria-labelledby="department-requests-heading" className="space-y-3">
      <div>
        <h2 id="department-requests-heading" className="text-lg font-semibold">
          Заявки департаменту
        </h2>
        <p className="text-muted-foreground text-sm">
          Мероприятия, на которые штаб запросил силы с вашего департамента
        </p>
      </div>

      {/* Таблица шире экрана прокручивается ВНУТРИ себя: страница вбок
          ездить не должна. */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Мероприятие</TableHead>
              <TableHead className="text-right">Требуется</TableHead>
              <TableHead>Дата ОМ</TableHead>
              <TableHead>Выделено</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody aria-busy={requests.isPending}>
            {requests.isPending &&
              [0, 1, 2].map((index) => (
                <TableRow key={index}>
                  <TableCell colSpan={6}>
                    {/* Заглушка тем же приёмом, что у соседнего борда расхода:
                        второй способ рисовать загрузку в одном разделе — это
                        два разных «подождите» на соседних экранах. */}
                    <div
                      className="bg-muted h-9 w-full animate-pulse rounded"
                      aria-hidden
                    />
                  </TableCell>
                </TableRow>
              ))}

            {!requests.isPending && requests.isError && (
              <TableRow>
                <TableCell colSpan={6}>
                  {/* Отказ ОБЪЯВЛЯЕТСЯ, а не только краснеет: без role=alert
                      его не услышит тот, кто читает экран не глазами. */}
                  <p role="alert" className="text-destructive-ink text-sm">
                    {requests.error?.message ??
                      "Заявки не загрузились — список показать нечем"}
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!requests.isPending && !requests.isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="whitespace-normal">
                  <p className="text-muted-foreground text-sm">
                    Заявок нет — штаб пока не запрашивал силы с вашего
                    департамента
                  </p>
                </TableCell>
              </TableRow>
            )}

            {!requests.isPending &&
              !requests.isError &&
              rows.map((row: DepartmentRequestRow) => (
                <TableRow key={`${row.eventId}-${row.allocationId}`}>
                  <TableCell>
                    {/* Иерархия ячейки: код — метка, название — то, что
                        читают, место и время — уточнение. Три уровня, а не
                        три строки одного веса. */}
                    <Badge variant="secondary" className="mb-1 font-mono text-[11px]">
                      {row.code}
                    </Badge>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {/* ДЕПАРТАМЕНТ НАЗВАН В СТРОКЕ. У одного мероприятия
                          заявок столько, между сколькими департаментами штаб
                          разделил потребность, и без имени две такие строки
                          читаются как дубль — так они и выглядели на первом
                          снимке. Человеку со своей областью видна одна строка,
                          и лишним имя не станет; администратору без области
                          видны все, и без имени таблица врёт. */}
                      {row.departmentName} · {row.location}
                      {row.eventTime !== null ? ` · ${row.eventTime}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {row.need}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatIsoDate(row.businessDate)}
                  </TableCell>
                  <TableCell>
                    <Progress assigned={row.assigned} need={row.need} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABEL[row.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setOpened(row.allocationId)}
                      aria-label={`Открыть заявку ${row.code} для «${row.departmentName}»`}
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
