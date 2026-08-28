"use client";

import { X } from "lucide-react";

// Этап 6 «Согласование»: утверждение расстановки (сразу открывает
// «Ознакомление») либо возврат на доработку с обязательной причиной.
//
// Компоновка — из прототипа Smart Josparlau (экран «Согласование
// расстановки»): сводка сверху, расчёт по секторам, отдельный блок с тем, что
// согласующий обязан увидеть до решения, и решение внизу.
//
// Приведён к эталону задачей заказчика «ОМ-37.3»: маршрут согласующих
// таблицей с порядком, «Отправить на согласование» / «Отозвать», решение по
// каждому, замечания от возвратов и баннер «расстановка изменилась» — сервер
// хранит снимок состава, под которым подписывались.
//
// Чего из прототипа НЕТ и почему:
//
// * ЭЦП: подписи домен не хранит вовсе. В эталоне, к слову, её тоже нет —
//   подзаголовок про ЭЦП есть, а кнопки подписи нет ни одной;
// * «ЛИЧНЫЙ СОСТАВ: ЗАПРОС И УТВЕРЖДЕНИЕ» (руководство срезает запрошенную
//   численность): у нас это живёт шагом РАНЬШЕ — на «Запросе сил», где
//   выделение считается по заявкам департаментов с реальными числами. Второй
//   вход в то же решение развёл бы правду о численности по двум экранам;
// * «КОНФЛИКТЫ ТЕКУЩЕЙ РАССТАНОВКИ» отдельной таблицей: поле conflictsCount
//   заводится нулём и НИКОГДА не пересчитывается — таблица из него всегда
//   говорила бы «конфликтов не выявлено», то есть врала бы уверенно. Вместо
//   него показано то, что бэк действительно записывает: обходы мягкого
//   предупреждения по рейтингу с причиной, введённой при назначении.
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  APPROVAL_APPROVE,
  APPROVAL_RETURN,
  useChainAccess,
} from "@/features/forces-split/ui/chain-access";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddApprover,
  useApprovePlacement,
  useDecideApprover,
  useMoveApprover,
  useRemoveApprover,
  useResolveRemark,
  useReturnPlacement,
  useSendForApproval,
  useWithdrawApproval,
} from "@/hooks/use-security-event-stages";
import type { SecurityEvent } from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";
import { formatIsoDateTime } from "@/shared/lib/date";

export function ApprovalStage({ event }: { event: SecurityEvent }) {
  // Кнопки решения выключаются, если права нет, и говорят ЧЬЁ это действие:
  // с 28.08.2026 подпись и возврат — работа утверждающего, а не ведущего
  // мероприятие (решение заказчика, Plane №267). Спрятать их было бы хуже —
  // человек не узнал бы, к кому идти.
  const access = useChainAccess();
  const approve = useApprovePlacement(event.id);
  const [comment, setComment] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const returnBack = useReturnPlacement(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
  const postLabel = (postId: string): string => {
    const post = postById.get(postId);
    return post ? `${post.sector} · ${post.post}` : postId;
  };

  const totalNeed = event.reconSectorPosts.reduce(
    (sum, post) => sum + post.need,
    0
  );
  const understaffed = event.reconSectorPosts.filter(
    (post) =>
      event.placementAssignments.filter((a) => a.postId === post.id).length <
      post.need
  ).length;
  const overrides = event.placementAssignments.filter(
    (a) => a.ratingOverrideReason !== null
  );

  return (
    // Область с именем вместо снятого заголовка — см. ReconStage (Plane №70).
    <Card role="region" aria-label="Согласование расстановки">
      {/* Имени этапа здесь НЕТ намеренно (Plane №70): оно стоит НАД
          карточкой, в шапке страницы («Этап N из 5 · …»). Второй заголовок
          читался бы как вложенный раздел, которого нет, и отнимал строку у
          содержимого. Подзаголовки внутри карточки остаются — они называют
          блоки, а не этап. */}
      <CardContent className="space-y-4">
        {event.approvalStatus === "RETURNED" && event.approvalComment !== "" && (
          <Alert>
            <AlertDescription>
              Прошлый возврат: {event.approvalComment}
            </AlertDescription>
          </Alert>
        )}

        {/* Баннер эталона. Признак считает СЕРВЕР: по нему же он блокирует
            завершение этапа, и второй расчёт на клиенте разошёлся бы с ним
            молча. */}
        {event.approvalStale && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertDescription className="text-amber-900">
              Расстановка изменилась после отправки. Необходимо повторное
              согласование — отправьте её согласующим заново.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Kpi value={String(event.reconSectorPosts.length)} label="постов" />
          <Kpi
            value={`${event.placementAssignments.length} / ${totalNeed}`}
            label="назначено / потребность"
          />
          <Kpi
            value={String(understaffed)}
            label="не укомплектовано"
            alarming={understaffed > 0}
          />
          <Kpi
            value={String(overrides.length)}
            label="обходов предупреждений"
            alarming={overrides.length > 0}
          />
          <Kpi value={formatIsoDateTime(event.updatedAt)} label="обновлено" />
        </div>

        <ApprovalRoute event={event} />

        <ApprovalRemarks event={event} />

        <section>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Расчёт на согласование
          </p>
          {event.placementAssignments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Назначений нет.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {event.placementAssignments.map((assignment) => (
                <li key={assignment.id} className="rounded-md border p-2.5 text-sm">
                  <span className="font-semibold">{assignment.employeeName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {postLabel(assignment.postId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Обходы предупреждений — то, ради чего согласующий и смотрит расчёт:
            назначения, прошедшие мимо требования поста к рейтингу. */}
        <section>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Обходы предупреждений при назначении
          </p>
          {overrides.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Обходов не было — все назначения прошли без предупреждений.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {overrides.map((assignment) => (
                <li
                  key={assignment.id}
                  className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm"
                >
                  <span className="font-semibold">{assignment.employeeName}</span>{" "}
                  <span className="text-muted-foreground">
                    — {postLabel(assignment.postId)}
                  </span>
                  <p className="text-xs text-amber-800">
                    Обоснование: {assignment.ratingOverrideReason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-1">
          <Label htmlFor="approval-comment">Причина возврата (при возврате)</Label>
          <Textarea
            id="approval-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <FieldErrors errors={fieldErrors} />
        <StageError error={approve.error} />
        <StageError error={returnBack.error} />

        {/* Причина словами и ОДИН раз на шаг: у обеих кнопок она одна и та
            же, и повтор превратил бы низ карточки в частокол. */}
        {access.reason(APPROVAL_APPROVE) !== "" && (
          <p className="text-xs text-muted-foreground">
            {access.reason(APPROVAL_APPROVE)}
          </p>
        )}

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={returnBack.isPending || !access.can(APPROVAL_RETURN)}
            aria-disabled={!access.can(APPROVAL_RETURN)}
            title={access.reason(APPROVAL_RETURN) || "Вернуть расстановку на доработку"}
            onClick={() => {
              setFieldErrors(null);
              returnBack.mutate({ comment });
            }}
          >
            {returnBack.isPending ? "Возврат…" : "Вернуть на доработку"}
          </Button>
          <Button
            type="button"
            disabled={approve.isPending || !access.can(APPROVAL_APPROVE)}
            aria-disabled={!access.can(APPROVAL_APPROVE)}
            title={access.reason(APPROVAL_APPROVE) || "Согласовать расстановку"}
            onClick={() => approve.mutate({})}
          >
            {approve.isPending
              ? "Утверждение…"
              : "Завершить этап и перейти далее"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({
  value,
  label,
  alarming = false,
}: {
  value: string;
  label: string;
  alarming?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <b className={`text-sm tabular-nums ${alarming ? "text-amber-700" : ""}`}>
        {value}
      </b>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

const APPROVER_STATUS_LABEL: Record<string, string> = {
  NOT_SENT: "Не отправлено",
  PENDING: "На согласовании",
  APPROVED: "Согласовано",
  RETURNED: "Возвращено",
};

const APPROVER_STATUS_CLASS: Record<string, string> = {
  NOT_SENT: "bg-secondary text-secondary-foreground",
  PENDING: "bg-blue-100 text-blue-800",
  APPROVED: "bg-green-100 text-green-800",
  RETURNED: "bg-red-100 text-red-800",
};

/**
 * Маршрут согласования из эталона: кто согласует, в каком порядке и с каким
 * решением.
 *
 * ТАБЛИЦЕЙ, а не списком: у согласующего шесть граф (порядок, ФИО,
 * подразделение, должность, статус, дата, комментарий), и в свободной строке
 * они сливались в предложение, которое приходится разбирать глазами.
 *
 * Порядок — позиция в списке, и он значим: по нему читают, кто согласует
 * первым. Меняется стрелками, а не перетаскиванием: перетаскивание в таблице
 * с полями ввода отбирает клик у самих полей.
 */
function ApprovalRoute({ event }: { event: SecurityEvent }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [position, setPosition] = useState("");
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const add = useAddApprover(event.id, {
    onEvent: () => {
      setAdding(false);
      setName("");
      setUnit("");
      setPosition("");
    },
  });
  const remove = useRemoveApprover(event.id);
  const move = useMoveApprover(event.id);
  const send = useSendForApproval(event.id);
  const withdraw = useWithdrawApproval(event.id);
  // Детали 400 показываем полем: без onFormError пользователь видел бы только
  // общее «Проверьте заполнение формы», а причина отказа («укажите причину
  // возврата») оставалась бы в ответе сервера.
  const [decideErrors, setDecideErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const decide = useDecideApprover(event.id, {
    onFormError: (details) => setDecideErrors(details),
    onEvent: () => {
      setReturnFor(null);
      setReason("");
      setDecideErrors(null);
    },
  });

  const route = event.approvalRoute;
  const sent = route.some((approver) => approver.status !== "NOT_SENT");
  const subtitle = event.approvalStale
    ? "Согласование сброшено: расстановка изменена"
    : sent
      ? "Отправлено на согласование"
      : "Не отправлено";

  return (
    <section className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <p className="text-xs font-semibold">Маршрут согласования</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding((prev) => !prev)}
          >
            + Добавить согласующего
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={withdraw.isPending || !sent}
            title={sent ? undefined : "Расстановка ещё не отправлена."}
            onClick={() => withdraw.mutate({})}
          >
            Отозвать с согласования
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={send.isPending || route.length === 0}
            title={
              route.length === 0 ? "Маршрут согласования пуст." : undefined
            }
            onClick={() => send.mutate({})}
          >
            {send.isPending ? "Отправка…" : "Отправить на согласование"}
          </Button>
        </div>
      </div>

      {adding && (
        <div className="flex flex-wrap gap-2 border-b p-2">
          <Input
            className="h-8 w-48 text-xs"
            placeholder="ФИО"
            aria-label="ФИО согласующего"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            className="h-8 w-44 text-xs"
            placeholder="Подразделение"
            aria-label="Подразделение согласующего"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <Input
            className="h-8 w-40 text-xs"
            placeholder="Должность"
            aria-label="Должность согласующего"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={add.isPending}
            onClick={() => add.mutate({ name, unit, position })}
          >
            Добавить
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAdding(false)}
          >
            Отмена
          </Button>
        </div>
      )}

      {route.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Маршрут пуст — согласующие не назначены.
        </p>
      ) : (
        /* Семь граф не сжимаются до читаемости — скроллится таблица, а не
           страница (тот же приём, что в расчёте постов). */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="w-[86px] px-2 py-1">Порядок</th>
                <th scope="col" className="px-2 py-1">ФИО</th>
                <th scope="col" className="px-2 py-1">Подразделение</th>
                <th scope="col" className="px-2 py-1">Должность</th>
                <th scope="col" className="w-[130px] px-2 py-1">Статус</th>
                <th scope="col" className="w-[120px] px-2 py-1">Дата решения</th>
                <th scope="col" className="px-2 py-1">Комментарий</th>
                <th scope="col" className="w-[186px] px-2 py-1">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {route.map((approver, index) => (
                <Fragment key={approver.id}>
                  <tr className="border-t align-top text-xs">
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-0.5">
                        <span className="tabular-nums">{index + 1}</span>
                        <button
                          type="button"
                          className="rounded px-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                          aria-label={`Выше: ${approver.name}`}
                          disabled={index === 0 || move.isPending}
                          onClick={() =>
                            move.mutate({
                              approverId: approver.id,
                              direction: "UP",
                            })
                          }
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="rounded px-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                          aria-label={`Ниже: ${approver.name}`}
                          disabled={index === route.length - 1 || move.isPending}
                          onClick={() =>
                            move.mutate({
                              approverId: approver.id,
                              direction: "DOWN",
                            })
                          }
                        >
                          ▼
                        </button>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-semibold">{approver.name}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {approver.unit === "" ? "—" : approver.unit}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {approver.position === "" ? "—" : approver.position}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${APPROVER_STATUS_CLASS[approver.status]}`}
                      >
                        {APPROVER_STATUS_LABEL[approver.status]}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                      {approver.decidedAt === null
                        ? "—"
                        : formatIsoDateTime(approver.decidedAt)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {approver.comment === "" ? "—" : approver.comment}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex flex-wrap gap-1">
                        {/* Решают только те, кому ОТПРАВИЛИ: у остальных
                            кнопок решения нет, как и в эталоне. */}
                        {approver.status === "PENDING" && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({
                                  approverId: approver.id,
                                  decision: "APPROVED",
                                  comment: "",
                                })
                              }
                            >
                              Согласовать
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setReturnFor((prev) =>
                                  prev === approver.id ? null : approver.id
                                )
                              }
                            >
                              Вернуть
                            </Button>
                          </>
                        )}
                        {approver.status === "NOT_SENT" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Снять согласующего ${approver.name}`}
                            disabled={remove.isPending}
                            onClick={() =>
                              remove.mutate({ approverId: approver.id })
                            }
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                  {returnFor === approver.id && (
                    <tr className="text-xs">
                      <td />
                      <td className="px-2 pb-2" colSpan={7}>
                        <span className="flex flex-wrap items-center gap-2">
                          <label
                            className="text-[11px] font-semibold"
                            htmlFor={`return-${approver.id}`}
                          >
                            Причина возврата *
                          </label>
                          <Input
                            id={`return-${approver.id}`}
                            className="h-8 w-72 text-xs"
                            placeholder="Укажите, что необходимо исправить"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={decide.isPending}
                            onClick={() =>
                              decide.mutate({
                                approverId: approver.id,
                                decision: "RETURNED",
                                comment: reason,
                              })
                            }
                          >
                            Подтвердить возврат
                          </Button>
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FieldErrors errors={decideErrors} />
      <StageError error={add.error} />
      <StageError error={remove.error} />
      <StageError error={move.error} />
      <StageError error={send.error} />
      <StageError error={withdraw.error} />
      <StageError error={decide.error} />
    </section>
  );
}

/**
 * Замечания — то, что порождают ВОЗВРАТЫ согласующих. Отдельным списком, а не
 * строкой у согласующего: один человек возвращает дважды по разным поводам, и
 * закрывают их по одному. Пока хоть одно открыто, этап не завершается — это
 * правило сервера, экран только называет его вслух.
 */
function ApprovalRemarks({ event }: { event: SecurityEvent }) {
  const resolve = useResolveRemark(event.id);
  const remarks = event.approvalRemarks;
  const open = remarks.filter((remark) => !remark.resolved).length;

  return (
    <section className="rounded-md border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-semibold">Замечания</p>
        <p className="text-[11px] text-muted-foreground">
          Формируются при возврате на доработку ·{" "}
          {remarks.length === 0
            ? "замечаний нет"
            : `${open} не устранено · ${remarks.length} всего`}
        </p>
      </div>
      {remarks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Замечаний нет — возвратов на доработку не было.
        </p>
      ) : (
        <ul className="divide-y">
          {remarks.map((remark) => (
            <li
              key={remark.id}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block">{remark.text}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {remark.author} · {formatIsoDateTime(remark.createdAt)}
                </span>
              </span>
              <span
                className={
                  remark.resolved
                    ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                    : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                }
              >
                {remark.resolved ? "Устранено" : "Не устранено"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate({
                    remarkId: remark.id,
                    resolved: !remark.resolved,
                  })
                }
              >
                {remark.resolved ? "Вернуть в работу" : "Отметить устранённым"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <StageError error={resolve.error} />
    </section>
  );
}
