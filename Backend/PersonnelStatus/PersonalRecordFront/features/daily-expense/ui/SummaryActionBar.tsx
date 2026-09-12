"use client";

// Главное действие экрана ответственного — сборка и явная отправка свода
// оперативному дежурному (Plane №1221, `[РАСХ-РШ-03]`, §20.4 п.6).
//
// До №1221 обе ступени жили в шапке блока «Суточный свод» ПОД таблицей по
// бланку, а состояние свода читалось только по тому, какая кнопка сейчас
// отрисована. Заказчик увидел на экране «нет кнопки отправить» (№1220 — она
// была ещё и невидимой). Теперь блок стоит в верхнем блоке «Сдали N из M»:
//   • чип состояния `role="status"` с ПОЛНЫМ текстом («Свод не собран»,
//     «Свод собран · v2 · ожидает отправки», «Отправлен 12.09 17:04 · кто»),
//     а не голый бейдж — ux-guideline «Contextual Live Badge Updates»;
//   • одна главная кнопка по состоянию: «Собрать свод» → «Отправить
//     дежурному» → (неполный свод) поле причины с ВИДИМОЙ подписью и
//     «Подтвердить отправку». Имена кнопок и тексты сообщений — прежние:
//     их читают `department-summary.spec.ts`, `main-daily-expense-walkthrough`,
//     `role-driven-acceptance` и мок-пробы борда.
//
// Данные — ТОТ ЖЕ запрос и ключ кэша, что у списка версий (`SummaryVersions`,
// `["daily-expense-board","summaries",date,divisionId]`): react-query
// сливает их в один запрос, и чип наверху не может разойтись с историей внизу
// (`[ДОП-20-04]`: не копия, а тот же источник). Мутации — общие хуки
// `useAssembleSummary`/`useSendSummary`, они же инвалидируют оба ключа.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  SUMMARY_ASSEMBLE_PERMISSION,
  useAssembleSummary,
  useSendSummary,
} from "@/hooks/use-daily-summary-write";
import { DAILY_SUBMISSIONS_PATH, parseSubmissionList } from "@/entities/daily-grid";
import { formatIsoDateTime } from "@/shared/lib/date";
import {
  assembleFailureText,
  sendFailureText,
  sendLaggardsOf,
  type DailySummaryRow,
} from "./SummaryVersions";
import styles from "./responsible-daily.module.css";

interface SummaryActionBarProps {
  businessDate: string;
  /** Департамент, за который собирается свод — область роли, уже выведенная
   * экраном (`useResponsibleDaily().scopeId`). */
  divisionId: number;
  labelOfDivision: (divisionId: number) => string;
}

type Tone = "off" | "wait" | "ok";

/** Якорь блока — на него ведёт карточка «Расход» рабочего стола (№1199). */
export const SUMMARY_ACTION_ANCHOR = "summary-action";

export function SummaryActionBar({ businessDate, divisionId, labelOfDivision }: SummaryActionBarProps) {
  const query = useQuery({
    queryKey: ["daily-expense-board", "summaries", businessDate, divisionId],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${divisionId}&business_date=${encodeURIComponent(businessDate)}`
      ),
  });
  const versions: DailySummaryRow[] = query.isSuccess ? parseSubmissionList(query.data) : [];
  const current = versions.find((version) => version.is_current) ?? null;
  const assembled = current !== null;
  const sent = current !== null && current.sent_at !== null;

  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const canAssemble = hasPermission(SUMMARY_ASSEMBLE_PERMISSION);
  const assemble = useAssembleSummary();
  const send = useSendSummary();
  const [reason, setReason] = useState("");

  const assembleFailure = assemble.error === null ? null : assembleFailureText(assemble.error);
  const laggards = sendLaggardsOf(send.error);
  const needsReason = laggards !== null && laggards.length > 0 && !send.isSuccess;
  const sendFailure = sendFailureText(send.error, labelOfDivision, laggards);

  let tone: Tone = "off";
  let chip = "Свод: проверяем…";
  if (query.isError) chip = "Свод: состояние неизвестно";
  else if (query.isSuccess && !assembled) chip = "Свод не собран";
  else if (current !== null && !sent) { tone = "wait"; chip = `Свод собран · v${current.version} · ожидает отправки`; }
  else if (current !== null && sent) { tone = "ok"; chip = `Свод отправлен · v${current.version} · ${formatIsoDateTime(current.sent_at as string)}`; }

  const ready = query.isSuccess && !permissionsLoading && canAssemble;
  const sendNow = () => send.mutate({ division_id: divisionId, business_date: businessDate, reason });

  return (
    <section role="region" aria-label="Суточный свод" id={SUMMARY_ACTION_ANCHOR} className={styles.summaryBar}>
      <div className={styles.summaryHead}>
        <span role="status" aria-atomic="true" className={`${styles.chip} ${styles[`chip_${tone}`]}`}>{chip}</span>
        {ready && !assembled && (
          <Button type="button" disabled={assemble.isPending} onClick={() => { assemble.reset(); assemble.mutate({ division_id: divisionId, business_date: businessDate }); }}>
            {assemble.isPending ? "Собираем…" : "Собрать свод"}
          </Button>
        )}
        {ready && assembled && !sent && (
          <Button type="button" disabled={send.isPending || (needsReason && reason.trim() === "")} onClick={sendNow}>
            {send.isPending ? "Отправляем…" : "Отправить дежурному"}
          </Button>
        )}
      </div>
      {ready && !assembled && <p className={styles.hint}>Свод собирается из действующих сдач управлений; недостающие остаются видны как «не сдали» — отправка неполного свода потребует явной причины.</p>}
      {ready && assembled && !sent && !needsReason && <p className={styles.hint}>Свод собран. Отправка уходит оперативному дежурному, который сводит расход за организацию, — отдельным действием со своим моментом и автором.</p>}
      {ready && sent && current !== null && (
        <p className={styles.hint}>
          Отправлено {formatIsoDateTime(current.sent_at as string)} · {current.sent_by}
          {current.incomplete_reason !== "" && <> — неполный свод: «{current.incomplete_reason}»</>}
        </p>
      )}
      {query.isSuccess && !permissionsLoading && !canAssemble && <p className={styles.hint}>Сборка и отправка свода закрыты правом «Суточный отчёт: генерация» — свод собирает и отправляет ответственный за расход департамента.</p>}
      {assembleFailure !== null && <p role="alert" className={styles.hint}>{assembleFailure}</p>}
      {assemble.isSuccess && !sent && <p role="status" className={styles.hint}>Свод собран — новая версия в списке ниже</p>}
      {sendFailure !== null && <p role="alert" className={styles.hint}>{sendFailure}</p>}
      {needsReason && (
        <div className={styles.reason}>
          <label htmlFor="summary-send-reason">Причина неполной отправки <span aria-hidden="true">*</span></label>
          <div>
            <input
              id="summary-send-reason"
              type="text"
              value={reason}
              required
              aria-required="true"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Причина неполной отправки — обязательна"
            />
            <Button type="button" variant="outline" disabled={send.isPending || reason.trim() === ""} onClick={sendNow}>Подтвердить отправку</Button>
          </div>
        </div>
      )}
      {send.isSuccess && <p role="status" className={styles.hint}>Свод отправлен дежурному</p>}
    </section>
  );
}
