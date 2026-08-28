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
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
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
  useSplitDirectorateQuotas,
} from "@/hooks/use-department-requests";
import { formatIsoDate } from "@/shared/lib/date";

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
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Черновик наполняется ИЗ ОТВЕТА, а не заводится пустым: пустое поле над
  // сохранённой квотой читается как «ноль», и человек сохранил бы ноль,
  // ничего не набрав.
  useEffect(() => {
    if (allocation === undefined) return;
    setDraft(
      Object.fromEntries(
        allocation.directorates.map((row) => [row.divisionId, String(row.need ?? 0)])
      )
    );
  }, [allocation]);

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
              {allocation.directorates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal">
                    <p className="text-muted-foreground text-sm">
                      Управления ещё не оповещены — списка нет
                    </p>
                  </TableCell>
                </TableRow>
              )}
              {allocation.directorates.map((row: ForceAllocationDirectorate) => (
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

        {!locked && allocation.directorates.length > 0 && (
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
      </section>
    </div>
  );
}
