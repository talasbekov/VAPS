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
import { useVisitObjectScope } from "./useVisitObjectScope";
import { JOURNAL_TYPE_LABEL } from "@/entities/security-event";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
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
function VisitObjectClosurePanel({ event }: { event: SecurityEvent }) {
  const scope = useVisitObjectScope(event, event.reconSectorPosts);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const close = useCloseVisitObject(event.id, { onEvent: () => setOpen(false) });
  const visit = scope.visit;
  if (visit === null) return null;
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
              <Button type="button" variant="outline" onClick={() => setOpen(true)}>
                Закрыть объект
              </Button>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Закрыть объект «{visit.objectName}»?</DialogTitle>
                  <DialogDescription>
                    После закрытия изменения по объекту невозможны.
                    {isLast ? " Мероприятие при этом закроется целиком." : ""}
                  </DialogDescription>
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
  // направления = секторы расчёта; итог обязателен по каждому
  const directions = [...new Set(event.reconSectorPosts.map((p) => p.sector))];
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const close = useCloseSecurityEvent(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });
  const { hasPermission } = useOpsPermissions();

  const facts = closureFacts(event);
  const ready = directions.filter(
    (direction) => (summaries[direction] ?? "").trim() !== ""
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Закрытие и итоги</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Fact value={`${facts.assigned} / ${facts.need}`} label="назначено / потребность" />
          <Fact value={String(facts.replacements)} label="замен" />
          <Fact
            value={String(facts.incidents)}
            label="инцидентов"
            alarming={facts.incidents > 0}
          />
        </div>

        {/* Готовность к закрытию — из прототипа: до этого о нехватке итогов
            узнавали только по 422 после нажатия. Кнопка при этом НЕ
            блокируется: владелец правила один — сервер, и клиентский гард
            рядом с ним лишь маскировал бы его отказ. */}
        <div className="rounded-md border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div>
              <p className="text-sm font-semibold">Готовность к закрытию</p>
              <p className="text-xs text-muted-foreground">
                Итоги обязательны по каждому направлению — частичное закрытие
                невозможно.
              </p>
            </div>
            <span
              className={
                ready.length === directions.length && directions.length > 0
                  ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                  : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
              }
            >
              {ready.length} из {directions.length} готовы
            </span>
          </div>
          {directions.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              Направлений нет — расчёт постов пуст.
            </p>
          ) : (
            <div className="space-y-3 p-3">
              {directions.map((direction) => {
                const filled = (summaries[direction] ?? "").trim() !== "";
                return (
                  <div key={direction} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`closure-${direction}`}>{direction} *</Label>
                      <span
                        className={
                          filled
                            ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10.5px] font-semibold text-green-800"
                            : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800"
                        }
                      >
                        {filled ? "Готово" : "Ожидается"}
                      </span>
                    </div>
                    <Textarea
                      id={`closure-${direction}`}
                      value={summaries[direction] ?? ""}
                      onChange={(e) =>
                        setSummaries((prev) => ({
                          ...prev,
                          [direction]: e.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Оценка участников — живой отдельный экран (§19), а не копия его
            таблицы здесь: две точки ввода оценок расходились бы. */}
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
            disabled={close.isPending}
            onClick={() => {
              setFieldErrors(null);
              close.mutate({
                directionSummaries: directions.map((direction) => ({
                  direction,
                  summary: summaries[direction] ?? "",
                })),
              });
            }}
          >
            {close.isPending ? "Закрытие…" : "Закрыть мероприятие"}
          </Button>
        </div>
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
