"use client";

// Журнал «сообщено → исправлено» нативного порта /security-ops (аналог
// /changelog SPA).
//
// ═══ Чего здесь осознанно нет ═══
// · Даты сборки — версии среза достаточно, дата ломала бы воспроизводимость.
// · Личности сообщившего — и не появится: анонимность от начальства; поля
//   автора нет в самом типе (entities/ops-changelog).
// · Автоматической связи с обратной связью — её принесёт порт «Обратной
//   связи ОМ»: журнал наполняется закрытыми исправлениями, а не тикетами.
import { DashboardLayout } from "@/components/dashboard-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GitBranch } from "lucide-react";
import {
  CLOSED_FIXES,
  PORT_VERSION,
  formatJournalDate,
  sortFixesByRelease,
} from "@/entities/ops-changelog";
import type { FixEntry } from "@/entities/ops-changelog";

const HEADING = "Журнал: сообщено → исправлено";
const EMPTY_TEXT = "Исправлений пока нет.";
const EMPTY_HINT = "Журнал наполнится, когда будет закрыт первый багрепорт.";

/** Проп fixes — ШОВ: порт обратной связи заменит дефолт на запрос, а точка
 * инъекции останется. Без него ветка «есть строки» была бы недостижима. */
export function ChangelogView({
  fixes = CLOSED_FIXES,
}: {
  fixes?: readonly FixEntry[];
}) {
  // сортировка не мутирует вход — см. sortFixesByRelease
  const rows = sortFixesByRelease(fixes);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <GitBranch className="h-8 w-8 text-primary-ink" />
          <div>
            <h1 className="text-2xl font-bold">{HEADING}</h1>
            <p className="text-muted-foreground">
              Исправления в разделе «Охранные мероприятия».
            </p>
          </div>
        </div>

        <section className="rounded-xl border bg-card p-4" aria-label="Версия">
          <h2 className="mb-2 text-sm font-semibold">Версия раздела ОМ</h2>
          <p className="text-sm">
            Версия <span className="font-mono">{PORT_VERSION}</span>
          </p>
        </section>

        <section
          className="rounded-xl border bg-card p-4"
          aria-label="Закрытые исправления"
        >
          <h2 className="mb-2 text-sm font-semibold">Закрытые исправления</h2>
          {rows.length === 0 ? (
            <div className="flex flex-col gap-1">
              <p role="status" className="text-sm">
                {EMPTY_TEXT}
              </p>
              <p className="text-sm text-muted-foreground">{EMPTY_HINT}</p>
            </div>
          ) : (
            <Table className="min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Версия</TableHead>
                  <TableHead scope="col">Дата</TableHead>
                  <TableHead scope="col">Что исправлено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((fix) => (
                  <TableRow key={fix.id}>
                    <TableCell className="align-top font-mono">
                      {fix.version}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top">
                      {formatJournalDate(fix.releasedAt)}
                    </TableCell>
                    <TableCell className="align-top">{fix.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">О журнале</h2>
          <ul className="flex flex-col gap-2">
            <li className="text-xs text-muted-foreground">
              Авторы обращений в журнале не указываются.
            </li>
            <li className="text-xs text-muted-foreground">
              Здесь приведены внесённые в журнал исправления. Полный список
              версий не ведётся.
            </li>
          </ul>
        </section>
      </div>
    </DashboardLayout>
  );
}
