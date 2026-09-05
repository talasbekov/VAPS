"use client";

// Этап 8 «Проведение»: журнал штаба (инструктаж/распоряжение/инцидент),
// замена выбывшего (атомарно: снять + назначить + запись в журнал) и
// закрытие с обязательными итогами ВСЕХ направлений.
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAddJournalEntry,
  useCloseSecurityEvent,
  useCloseVisitObject,
  useScoreAll,
  useSetEvaluation,
  useVisitEvaluations,
  useReplaceAssignment,
} from "@/hooks/use-security-event-stages";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatIsoDayTime } from "@/shared/lib/date";
import { useVisitObjectScope } from "./useVisitObjectScope";
import type { VisitEvaluationRow } from "@/entities/security-event";
import { JOURNAL_TYPE_LABEL } from "@/entities/security-event";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { EVENT_MANAGE, useChainAccess } from "@/features/forces-split/ui/chain-access";
import type {
  JournalEntryType,
  SecurityEvent,
} from "@/entities/security-event";
import { PersonnelPicker } from "@/features/personnel-picker";
import { FieldErrors, StageError } from "./StageErrors";
import { JournalList } from "./JournalList";

export function ConductStage({ event }: { event: SecurityEvent }) {
  // Порядок панелей — по шестому шагу прототипа: «Закрытие и итоги» первым,
  // потому что шаг называется закрытием и ради него сюда и приходят. «Контроль
  // постов» идёт вторым — он даёт разрез той же сводки и объясняет, кого
  // менять ниже. Журнал штаба и замена выбывшего идут следом: в прототипе их
  // экрана больше нет (журнал остался плиткой в архиве), но операции живые и с
  // аудитом, поэтому они сохранены здесь, а не выброшены вслед за макетом.
  return (
    <div className="flex flex-col gap-4">
      <EvaluationPanel event={event} />
      <IncidentsPanel event={event} />
      <VisitObjectClosurePanel event={event} />
      <ClosurePanel event={event} />
      <PostControlPanel event={event} />
      <JournalPanel event={event} />
      <ReplacementPanel event={event} />
    </div>
  );
}

/**
 * Разрез укомплектованности по направлениям — «Контроль постов» прототипа.
 * Считается из ЖИВЫХ данных карточки: потребность несут посты расчёта
 * (`reconSectorPosts.need`), занятость — назначения (`placementAssignments`).
 *
 * 🔴 Недобор здесь — РЕАЛЬНОЕ состояние, а не артефакт показа. Гейт завершения
 * расстановки (`complete_placement`, apps/ops/security_events.py) требует,
 * чтобы у каждого поста был ХОТЯ БЫ ОДИН назначенный, а не чтобы пост был
 * закрыт по потребности: пост с `need: 3` и одним человеком проходит дальше.
 * До этой панели на «Проведении» о постах не было сказано ничего вовсе — карточка
 * показывает только активный этап, и карта расстановки с этого шага не видна.
 *
 * Чего в панели нет намеренно: счётчика «состав на местах» и часов проведения
 * из прототипа — присутствия домен не учитывает (у назначения есть только
 * ознакомление), а времени старта у мероприятия нет, только бизнес-дата.
 * Постовых «открытых указаний» тоже нет: запись журнала не привязана к сектору.
 */
export function postControl(event: SecurityEvent): {
  sector: string;
  filled: number;
  need: number;
  posts: { id: string; post: string; filled: number; need: number }[];
}[] {
  const filledByPost = new Map<string, number>();
  for (const assignment of event.placementAssignments) {
    filledByPost.set(
      assignment.postId,
      (filledByPost.get(assignment.postId) ?? 0) + 1
    );
  }

  const sectors: {
    sector: string;
    filled: number;
    need: number;
    posts: { id: string; post: string; filled: number; need: number }[];
  }[] = [];
  for (const post of event.reconSectorPosts) {
    const filled = filledByPost.get(post.id) ?? 0;
    let sector = sectors.find((s) => s.sector === post.sector);
    if (sector === undefined) {
      sector = { sector: post.sector, filled: 0, need: 0, posts: [] };
      sectors.push(sector);
    }
    sector.filled += filled;
    sector.need += post.need;
    sector.posts.push({ id: post.id, post: post.post, filled, need: post.need });
  }
  return sectors;
}

function PostControlPanel({ event }: { event: SecurityEvent }) {
  const sectors = postControl(event);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Контроль постов</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sectors.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Расчёт постов пуст — контролировать нечего.
          </p>
        ) : (
          sectors.map((sector) => {
            const short = sector.need - sector.filled;
            return (
              // aria-label делает блок направления адресуемым (role=region):
              // у панели нет ни таблицы, ни заголовков-якорей, и проба иначе
              // цеплялась бы за классы вёрстки.
              <section
                key={sector.sector}
                aria-label={`Направление ${sector.sector}`}
                className="rounded-md border"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                  <p className="text-sm font-semibold">{sector.sector}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {sector.filled} / {sector.need}
                    </span>
                    <span
                      className={
                        short > 0
                          ? "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                          : "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                      }
                    >
                      {short > 0 ? `Недобор ${short}` : "Штатно"}
                    </span>
                  </div>
                </div>
                <ul className="divide-y">
                  {sector.posts.map((post) => (
                    <li
                      key={post.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                    >
                      <span>{post.post}</span>
                      <span
                        className={
                          post.filled < post.need
                            ? "tabular-nums font-semibold text-amber-700"
                            : "tabular-nums text-muted-foreground"
                        }
                      >
                        {post.filled} / {post.need}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function JournalPanel({ event }: { event: SecurityEvent }) {
  const [type, setType] = useState<JournalEntryType>("INSTRUCTION");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const add = useAddJournalEntry(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Журнал штаба</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="journal-type">Тип</Label>
            <select
              id="journal-type"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as JournalEntryType)}
            >
              {(["INSTRUCTION", "ORDER", "INCIDENT"] as const).map((value) => (
                <option key={value} value={value}>
                  {JOURNAL_TYPE_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="journal-title">Заголовок *</Label>
            <Input
              id="journal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="journal-description">Описание</Label>
            <Input
              id="journal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={add.isPending}
            onClick={() => {
              setFieldErrors(null);
              add.mutate({ type, title, description });
              setTitle("");
              setDescription("");
            }}
          >
            {add.isPending ? "Запись…" : "Добавить запись"}
          </Button>
        </div>
        <FieldErrors errors={fieldErrors} />
        <StageError error={add.error} />
        <JournalList entries={event.journalEntries} />
      </CardContent>
    </Card>
  );
}

function ReplacementPanel({ event }: { event: SecurityEvent }) {
  const [assignmentId, setAssignmentId] = useState("");
  const [incomingEmployeeId, setIncomingEmployeeId] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const replace = useReplaceAssignment(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Замена выбывшего</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="replace-assignment">Кого заменить</Label>
            <select
              id="replace-assignment"
              className="h-9 min-w-56 rounded-md border border-input bg-background px-2 text-sm"
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
            >
              <option value="">— выберите назначение —</option>
              {event.placementAssignments.map((assignment) => {
                const post = postById.get(assignment.postId);
                return (
                  <option key={assignment.id} value={assignment.id}>
                    {assignment.employeeName} ({post?.post ?? assignment.postId})
                  </option>
                );
              })}
            </select>
          </div>
          {/* «Кем» стоит НЕ в этой строке, а ниже — подбор человека это
              поиск со страницами, а не выпадающий список: см. блок под
              строкой. */}
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="replace-reason">Причина *</Label>
            <Input
              id="replace-reason"
              placeholder="Например: болезнь"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              replace.isPending || assignmentId === "" || incomingEmployeeId === ""
            }
            onClick={() => {
              setFieldErrors(null);
              replace.mutate({ assignmentId, incomingEmployeeId, reasonCode });
            }}
          >
            {replace.isPending ? "Замена…" : "Заменить"}
          </Button>
        </div>
        {/* Кем заменяем — поиск и страницы НА СЕРВЕРЕ (Plane №61). Раньше тут
            стоял `select`, набитый ВСЕМ кадровым снимком: на живой базе это
            тысячи строк одним ответом и прокрутка вместо поиска. */}
        <div className="space-y-1">
          <p className="text-sm font-medium">Кем заменить</p>
          <PersonnelPicker
            value={incomingEmployeeId === "" ? null : incomingEmployeeId}
            onPick={(id) =>
              setIncomingEmployeeId((current) => (current === id ? "" : id))
            }
            pageSize={8}
          />
        </div>
        <FieldErrors errors={fieldErrors} />
        <StageError error={replace.error} />
      </CardContent>
    </Card>
  );
}

/**
 * Сводка «план / факт» из ЖИВЫХ данных карточки. Человеко-часов здесь нет,
 * хотя в прототипе они есть: учёта часов у домена ОМ не существует вовсе, и
 * посчитать их из назначений нельзя — вышла бы выдумка на месте отчётной
 * цифры.
 */
export function closureFacts(event: SecurityEvent): {
  assigned: number;
  need: number;
  replacements: number;
  incidents: number;
} {
  return {
    assigned: event.placementAssignments.length,
    need: event.reconSectorPosts.reduce((sum, post) => sum + post.need, 0),
    replacements: event.journalEntries.filter((e) => e.type === "REPLACEMENT")
      .length,
    incidents: event.journalEntries.filter((e) => e.type === "INCIDENT").length,
  };
}

/**
 * Закрытие ОБЪЕКТА посещения (`[ЗАК-05]`, Plane №404) и автозакрытие
 * мероприятия последним объектом (`[ЗАК-12]`).
 *
 * Показанный объект — тот же разрез, что у остальных этапов
 * (`useVisitObjectScope`, адрес `?visit=`). Подтверждение — диалог, а не
 * `window.confirm`: у закрытия нет обратного хода («после закрытия изменения
 * невозможны»), и модальное окно браузера ещё и ломает автоматизацию.
 * Комментарий по объекту (`[ЗАК-04]`) — необязателен, поле в том же диалоге.
 *
 * Панель «Закрытие и итоги» с итогами направлений ниже ОСТАЁТСЯ: ручное
 * закрытие мероприятия целиком — путь для ОМ без объектов и для штаба.
 */
const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * Оценка сотрудников — главный блок этапа 5 (`[ЗАК-02]`/`[МД-08]`, Plane №433).
 * По секторам и постам: ФИО · управление · ознакомлен; шкала 1–10 — клик
 * ставит, повторный снимает; комментарий необязателен, при ≤ 5 — подсказка
 * «желательно пояснить» без блокировки; «Всем 10» — только неоценённым;
 * снятый заменой показан с пометкой «снят» и без шкалы. Прогресс
 * «Оценено K из N». Оценки пишутся в модель рейтинга — средний балл
 * сотрудника считается по ним же.
 */
function EvaluationPanel({ event }: { event: SecurityEvent }) {
  const scope = useVisitObjectScope(event, event.reconSectorPosts);
  const visit = scope.visit;
  const query = useVisitEvaluations(event.id, visit?.id ?? null);
  const setScore = useSetEvaluation(event.id, visit?.id ?? "");
  const scoreAll = useScoreAll(event.id, visit?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (visit === null) return null;
  const summary = query.data;
  const closed = visit.stage === "CLOSED";
  const busy = setScore.isPending || scoreAll.isPending;
  const groups = new Map<string, VisitEvaluationRow[]>();
  for (const row of summary?.rows ?? []) {
    const key = row.sector || "Без сектора";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const commentOf = (row: VisitEvaluationRow) =>
    drafts[row.assignmentId ?? ""] ?? row.comment;
  return (
    <Card data-slot="evaluation-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Оценка сотрудников · «{visit.objectName}»</CardTitle>
          <p className="text-xs text-muted-foreground" data-slot="evaluation-progress">
            {summary ? `Оценено ${summary.evaluated} из ${summary.total}` : "Загрузка…"}
          </p>
        </div>
        {!closed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !summary || summary.evaluated === summary.total}
            onClick={() => scoreAll.mutate({ score: 10 })}
          >
            Всем 10
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <StageError error={setScore.error} />
        <StageError error={scoreAll.error} />
        {query.isError && (
          <p className="text-sm text-destructive">Оценки не загрузились — обновите страницу.</p>
        )}
        {summary && summary.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            На постах объекта никого не назначено — оценивать некого.
          </p>
        )}
        {[...groups.entries()].map(([sector, rows]) => (
          <section key={sector} className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {sector}
            </h3>
            <ul className="space-y-2">
              {rows.map((row) => {
                const low = row.score !== null && row.score <= 5;
                return (
                  <li
                    key={row.assignmentId ?? `${row.post}-${row.employeeName}`}
                    className="rounded-md border px-3 py-2"
                    data-slot="evaluation-row"
                    data-score={row.score ?? ""}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{row.post}</span>
                      <span>· {row.employeeName}</span>
                      {row.divisionName !== "" && (
                        <span className="text-muted-foreground">· {row.divisionName}</span>
                      )}
                      {row.replaced ? (
                        <span className="rounded-full bg-muted px-2 text-[11px]">снят</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.acknowledgedAt !== null
                            ? `· ознакомлен ${new Date(row.acknowledgedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                            : "· не ознакомлен"}
                        </span>
                      )}
                    </div>
                    {!row.replaced && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <div
                          className="flex flex-wrap gap-1"
                          role="group"
                          aria-label={`Оценка: ${row.employeeName}`}
                        >
                          {SCALE.map((value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={row.score === value}
                              disabled={closed || busy}
                              className={
                                "h-8 min-w-8 rounded-md border px-2 text-xs tabular-nums transition-colors disabled:opacity-60 " +
                                (row.score === value
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "bg-background hover:bg-muted")
                              }
                              onClick={() =>
                                setScore.mutate({
                                  assignmentId: row.assignmentId ?? "",
                                  score: row.score === value ? null : value,
                                  comment: commentOf(row),
                                })
                              }
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                        <div className="min-w-[220px] flex-1 space-y-1">
                          <Input
                            className="h-8 text-xs"
                            placeholder="Комментарий (необязательно)"
                            aria-label={`Комментарий к оценке: ${row.employeeName}`}
                            disabled={closed}
                            value={commentOf(row)}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.assignmentId ?? ""]: e.target.value,
                              }))
                            }
                            onBlur={() => {
                              if (row.score !== null && commentOf(row) !== row.comment) {
                                setScore.mutate({
                                  assignmentId: row.assignmentId ?? "",
                                  score: row.score,
                                  comment: commentOf(row),
                                });
                              }
                            }}
                          />
                          {low && commentOf(row).trim() === "" && (
                            <p
                              className="text-[11px] text-amber-700 dark:text-amber-300"
                              data-slot="low-score-hint"
                            >
                              Оценка {row.score} — желательно пояснить.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function VisitObjectClosurePanel({ event }: { event: SecurityEvent }) {
  const scope = useVisitObjectScope(event, event.reconSectorPosts);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const close = useCloseVisitObject(event.id, { onEvent: () => setOpen(false) });
  const access = useChainAccess();
  const visit = scope.visit;
  // Сводка оценок — для подтверждения «Оценено K из N, инцидентов N»
  // (`[ЗАК-05]`, Plane №433); неоценённые закрытию не мешают.
  const evaluations = useVisitEvaluations(event.id, visit?.id ?? null);
  if (visit === null) return null;
  const evaluated = evaluations.data?.evaluated ?? 0;
  const totalRated = evaluations.data?.total ?? 0;
  const incidents = evaluations.data?.incidents ?? closureFacts(event).incidents;
  const unrated = totalRated - evaluated;
  const others = event.visitObjects.filter((item) => item.id !== visit.id);
  const openOthers = others.filter((item) => item.stage !== "CLOSED").length;
  const isLast = openOthers === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Закрытие объекта «{visit.objectName}»</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visit.stage === "CLOSED" ? (
          <p className="text-sm">
            Объект закрыт
            {visit.closedAt !== null
              ? ` · ${new Date(visit.closedAt).toLocaleString("ru-RU")}`
              : ""}
            {visit.closingComment !== "" ? ` · ${visit.closingComment}` : ""}
            . Изменения по объекту невозможны.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {isLast
                ? event.visitObjects.length > 1
                  ? "Остальные объекты уже закрыты — закрытие этого закроет мероприятие целиком."
                  : "Единственный объект мероприятия — его закрытие закроет мероприятие целиком."
                : `Ещё не закрыто объектов: ${openOthers}. Мероприятие закроется само, когда будут закрыты все.`}
            </p>
            <StageError error={close.error} />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={!access.can(EVENT_MANAGE)}
                title={access.reason(EVENT_MANAGE) || undefined}
                onClick={() => setOpen(true)}
              >
                Закрыть объект
              </Button>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Закрыть объект «{visit.objectName}»?</DialogTitle>
                  <DialogDescription data-slot="close-summary">
                    Оценено {evaluated} из {totalRated}, инцидентов {incidents}. После
                    закрытия изменения по объекту невозможны.
                    {isLast ? " Мероприятие при этом закроется целиком." : ""}
                  </DialogDescription>
                  {unrated > 0 && (
                    <p
                      className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                      data-slot="close-unrated"
                    >
                      {unrated} сотрудников без оценки. Закрыть? Неоценённые в средний балл не
                      войдут.
                    </p>
                  )}
                </DialogHeader>
                <div className="space-y-1">
                  <Label htmlFor={`closing-comment-${visit.id}`}>
                    Итоговый комментарий по объекту (необязательно)
                  </Label>
                  <Textarea
                    id={`closing-comment-${visit.id}`}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Отмена
                  </Button>
                  <Button
                    type="button"
                    disabled={close.isPending}
                    onClick={() => close.mutate({ visitObjectId: visit.id, comment })}
                  >
                    {close.isPending ? "Закрытие…" : "Подтвердить закрытие"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ClosurePanel({ event }: { event: SecurityEvent }) {
  const closeAccess = useChainAccess();
  const [comment, setComment] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const close = useCloseSecurityEvent(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });
  const { hasPermission } = useOpsPermissions();
  const summary = event.closureSummary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Закрытие и итоги</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* `[ЗАК-01]` (Plane №448): итог одной строкой, считает сервер. */}
        <p className="text-sm tabular-nums" data-slot="closure-summary-line">
          Постов <b>{summary.posts}</b> · назначено <b>{summary.assigned} из {summary.need}</b> · замен{" "}
          <b>{summary.replacements}</b> · отказов <b>{summary.declines}</b> · инцидентов{" "}
          <b className={summary.incidents > 0 ? "text-amber-700" : ""}>{summary.incidents}</b>
        </p>
        {/* `[ЗАК-04]`: один необязательный комментарий вместо обязательных
            итогов по направлениям. */}
        <div className="space-y-1">
          <Label htmlFor="closing-comment">Итоговый комментарий (необязательно)</Label>
          <Textarea
            id="closing-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        {hasPermission("rating.evaluate") && (
          <Link
            href="/security-ops/ratings/workspace"
            className="inline-block text-xs font-semibold text-primary-ink"
          >
            Оценка участников ОМ →
          </Link>
        )}
        <FieldErrors errors={fieldErrors} />
        <StageError error={close.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={close.isPending || !closeAccess.can(EVENT_MANAGE)}
            title={closeAccess.reason(EVENT_MANAGE) || undefined}
            onClick={() => {
              setFieldErrors(null);
              close.mutate({ comment });
            }}
          >
            {close.isPending ? "Закрытие…" : "Закрыть мероприятие"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Инциденты и замечания (`[ЗАК-03]`, Plane №448): список записей журнала
 * типа «инцидент» с временем, постом, описанием и принятыми мерами;
 * «+ Добавить» — форма; пусто — одна строка «Инцидентов не было».
 */
function IncidentsPanel({ event }: { event: SecurityEvent }) {
  const [open, setOpen] = useState(false);
  const [occurredAt, setOccurredAt] = useState("");
  const [postId, setPostId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [measures, setMeasures] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(null);
  const add = useAddJournalEntry(event.id, {
    onFormError: (details) => setFieldErrors(details),
    onEvent: () => {
      setOpen(false);
      setTitle("");
      setDescription("");
      setMeasures("");
      setOccurredAt("");
    },
  });
  const incidents = event.journalEntries.filter((e) => e.type === "INCIDENT");
  const postName = (id: string | null | undefined) => {
    const post = event.reconSectorPosts.find((p) => p.id === id);
    return post ? `${post.sector} · ${post.post}` : "—";
  };
  return (
    <Card data-slot="incidents-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Инциденты и замечания</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          + Добавить
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-slot="incidents-empty">
            Инцидентов не было
          </p>
        ) : (
          <ul className="space-y-2">
            {incidents.map((entry) => (
              <li key={entry.id} className="rounded-md border px-3 py-2 text-sm" data-slot="incident-row">
                <p>
                  <span className="text-muted-foreground tabular-nums">
                    {/* Обе отметки через ОДИН защищённый форматтер (Plane
                        №730): `occurredAt` приходит из JSON мероприятия как
                        есть, и неразбираемая строка печаталась буквальным
                        «Invalid Date». Запасное «—» — то же, что показывает
                        архив на тех же данных. */}
                    {formatIsoDayTime(entry.occurredAt ?? "") !== "—"
                      ? formatIsoDayTime(entry.occurredAt ?? "")
                      : formatIsoDayTime(entry.createdAt)}
                  </span>{" "}
                  · {postName(entry.postId)} · <b>{entry.title}</b>
                </p>
                {entry.description !== "" && <p className="text-muted-foreground">{entry.description}</p>}
                {(entry.measures ?? "") !== "" && (
                  <p className="text-xs">Принятые меры: {entry.measures}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {open && (
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2" data-slot="incident-form">
            <div className="space-y-1">
              <Label htmlFor="incident-time">Время</Label>
              <Input id="incident-time" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="incident-post">Пост</Label>
              <select
                id="incident-post"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={postId}
                onChange={(e) => setPostId(e.target.value)}
              >
                <option value="">— не привязан —</option>
                {event.reconSectorPosts.map((post) => (
                  <option key={post.id} value={post.id}>
                    {post.sector} · {post.post}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="incident-title">Описание *</Label>
              <Input id="incident-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="incident-details">Подробности</Label>
              <Input id="incident-details" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="incident-measures">Принятые меры</Label>
              <Input id="incident-measures" value={measures} onChange={(e) => setMeasures(e.target.value)} />
            </div>
            <FieldErrors errors={fieldErrors} />
            <StageError error={add.error} />
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={add.isPending}
                onClick={() => {
                  setFieldErrors(null);
                  add.mutate({
                    type: "INCIDENT",
                    title,
                    description,
                    measures,
                    postId: postId || null,
                    occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
                  });
                }}
              >
                {add.isPending ? "Запись…" : "Записать инцидент"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({
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
