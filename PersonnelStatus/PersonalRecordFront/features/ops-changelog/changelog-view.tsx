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
              Версия среза нативного порта и закрытые исправления раздела
              «Охранные мероприятия».
            </p>
          </div>
        </div>

        <section className="rounded-xl border bg-card p-4" aria-label="Версия">
          <h2 className="mb-2 text-sm font-semibold">Версия среза порта</h2>
          <p className="text-sm">
            Версия <span className="font-mono">{PORT_VERSION}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Растёт по очередям портирования; история очередей — в коммитах
            ветки, дата сборки намеренно не показывается.
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Версия
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Дата
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Что исправлено
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((fix) => (
                  <tr key={fix.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 align-top font-mono">
                      {fix.version}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 align-top">
                      {formatJournalDate(fix.releasedAt)}
                    </td>
                    <td className="py-2 align-top">{fix.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">Чего в журнале нет</h2>
          <ul className="flex flex-col gap-2">
            <li className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                Личность сообщившего.
              </span>{" "}
              Видимость отправителя багрепорта — только разработчику: поля
              автора нет в самом типе строки, и в вёрстку ему утечь неоткуда.
            </li>
            <li className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                История версий (список релизов).
              </span>{" "}
              Системе известна ровно одна версия — текущая; манифеста релизов у
              порта нет.
            </li>
          </ul>
        </section>
      </div>
    </DashboardLayout>
  );
}
