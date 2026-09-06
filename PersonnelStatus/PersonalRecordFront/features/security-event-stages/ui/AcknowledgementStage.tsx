"use client";

// Этап 7 «Ознакомление» — экран старшего объекта по спецификации
// `[ОЗН-02]`…`[ОЗН-04]`, `[ОЗН-08]` (Plane №432, Ш-16 плана P2):
//
//  • шапка — «Ознакомились K из N · не открыли M · открыли и молчат O ·
//    отказов D» и полоса ИЗ ЧЕТЫРЁХ цветов (зелёный — подтвердил, красный —
//    отказ, жёлтый — открыл и не ответил, серый — не открывал; №452);
//  • список НАЗНАЧЕННЫХ ПО СЕКТОРАМ И ПОСТАМ — так читает расстановку
//    старший, а плоский список на сотне строк не читается никем;
//  • у каждого — «Напомнить» (адресное уведомление ему и руководителям),
//    отказ красным с причиной и «Заменить →» тут же, на этапе 4 (замена
//    больше не ждёт «Проведения»);
//  • «Напомнить всем, кто не подтвердил» вместо кнопки «Отправить
//    уведомления» — рассылка при открытии этапа уходит сама (№402);
//  • «Завершить ознакомление» — активна, когда подтвердили все; иначе
//    подтверждение «K сотрудников не подтвердили. Завершить?» с
//    обязательным комментарием, который ложится в журнал мутаций.
//
// Панели «Экран сотрудника» на странице этапа больше нет (`[ОЗН-08]`):
// сотрудник отвечает со своей карточки в профиле (№405), а здесь — экран
// старшего. Отметка «Отметить ознакомление» за сотрудника осталась —
// «доведено лично» (`[ОЗН-05]`) старший подтверждает сам.
import { useMemo, useState } from "react";
// Роль старшего читается по данным мероприятия — так же, как это делает
// согласование (`useApprovalRights`): право этапа «Ознакомление» у сервера
// шире кода `event.manage` (Plane №612).
import { useMyEmployee } from "@/hooks/use-my-employee";
import { Bell, Check, Phone, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useAcknowledgePlacement,
  useCompleteAcknowledgement,
  useRemindAllPending,
  useRemindAssignment,
  useReplaceAssignment,
} from "@/hooks/use-security-event-stages";
import { PersonnelPicker } from "@/features/personnel-picker";
import { EVENT_MANAGE, useChainAccess } from "@/features/forces-split/ui/chain-access";
import type { PlacementAssignment, SecurityEvent } from "@/entities/security-event";
import { StageError } from "./StageErrors";
import { AccessHints, RightGate } from "@/shared/ui/right-gate";
import { formatIsoDateTime, formatIsoDayTime } from "@/shared/lib/date";
import { PEOPLE, ruPlural } from "@/lib/ru-plural";

type Scope = "all" | "pending";

type RowState = "confirmed" | "declined" | "opened" | "pending";

/**
 * Состояние строки ознакомления (`[ОЗН-02]`).
 *
 * 🔴 ЧЕТЫРЕ СОСТОЯНИЯ, А НЕ ТРИ (Plane №452). «Открыл и не нажал» —
 * отдельное положение, и оно требует ДРУГОГО действия: тому, кто не открывал,
 * напоминают; тому, кто открыл и молчит, звонят. Пока состояний было три, оба
 * лежали в «ждём», и старший не мог их различить вовсе.
 *
 * Порядок проверок — от сильного к слабому: ответ поглощает факт открытия
 * (подтвердивший его, разумеется, открывал), поэтому `viewedAt` смотрится
 * последним.
 */
function stateOf(a: PlacementAssignment): RowState {
  if (a.acknowledgedAt !== null) return "confirmed";
  if ((a.declinedAt ?? null) !== null) return "declined";
  if ((a.viewedAt ?? null) !== null) return "opened";
  return "pending";
}

export function AcknowledgementStage({ event }: { event: SecurityEvent }) {
  const access = useChainAccess();
  const acknowledge = useAcknowledgePlacement(event.id);
  const remindOne = useRemindAssignment(event.id);
  /**
   * Какое напоминание нажали ПОСЛЕДНИМ (Plane №614).
   *
   * 🔴 Блок отчёта читал `(remindOne.data ?? remindAll.data)`, а React Query
   * держит `data` после завершения мутации — панель навсегда приколачивалась
   * к результату одиночного «Напомнить»: последующее «Напомнить всем»
   * обновляло свои данные, а на экране оставалось прежнее «отправлено: 1
   * заступающим» вместе с протухшим предупреждением «не дошло до N».
   *
   * Порядок хранится ЯВНО, а не выводится из наличия данных: у мутаций нет
   * общего времени ответа, а «кто позвал последним» — это ровно то, что
   * человек и хочет видеть.
   */
  const [lastRemind, setLastRemind] = useState<"one" | "all" | null>(null);
  const remindAll = useRemindAllPending(event.id);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeComment, setCompleteComment] = useState("");
  // Мероприятие ДОШЛО до этого этапа? Его стадия — наименьшая среди объектов
  // (Plane №412), поэтому «объект здесь» и «мероприятие здесь» — разные факты,
  // а завершает этап сервер по мероприятию (Plane №528).
  const eventOnStage = event.stage === "ACKNOWLEDGEMENT";
  const behind = event.visitObjects.filter(
    (visit) => visit.stage !== "ACKNOWLEDGEMENT" && visit.stage !== "CONDUCT" && visit.stage !== "CLOSED"
  );
  const behindLabel =
    behind.length === 0
      ? "мероприятие ещё не на этом этапе"
      : `ещё не дошли объекты: ${behind.map((visit) => visit.objectName).join(", ")}`;
  /**
   * Причина, по которой ВСЕ действия этапа закрыты отставанием мероприятия.
   *
   * 🔴 №528 БЫЛ ЗАКРЫТ НА ОДНОЙ КНОПКЕ ИЗ ТРЁХ (найдено ревью №825). Сервер
   * стережёт этапом МЕРОПРИЯТИЯ не только завершение
   * (`acknowledgement_stage.complete:168`), но и оба напоминания —
   * `remind_assignment:108` и `remind_pending:141`, оба с одним и тем же
   * `_require_stage(event, "ACKNOWLEDGEMENT")`. Пока гасла только кнопка
   * завершения, на ОМ с отстающим объектом человек видел худшее из
   * возможного: одна кнопка погашена и объясняет почему, а две соседние
   * молча отвечают 422. Это читается как поломка вернее, чем если бы не
   * гасла ни одна.
   */
  const stageBehindReason = eventOnStage
    ? null
    : `Этап ведётся по всему мероприятию: ${behindLabel}`;
  const complete = useCompleteAcknowledgement(event.id);
  const [scope, setScope] = useState<Scope>("all");
  const [replacing, setReplacing] = useState<PlacementAssignment | null>(null);

  const assignments = event.placementAssignments;
  const confirmed = assignments.filter((a) => stateOf(a) === "confirmed");
  const declined = assignments.filter((a) => stateOf(a) === "declined");
  // «Открыл и не нажал» (Plane №452) — своя корзина, но для НАПОМИНАНИЯ она
  // такая же неотвеченная, как «не открывал»: обеим шлют напоминание, а
  // разница в том, что делать дальше человеку.
  const opened = assignments.filter((a) => stateOf(a) === "opened");
  const pending = assignments.filter((a) => stateOf(a) === "pending");
  const unanswered = [...opened, ...pending];
  const total = assignments.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  // Группировка по секторам и постам — в порядке расчёта постов.
  const groups = useMemo(() => {
    const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
    // «Ожидают» = ВСЕ неотвеченные: и открывшие, и не открывавшие
    // (Plane №452). Фильтр отвечает на вопрос «с кем ещё работать», а не
    // «кто не открывал».
    const rows = scope === "pending" ? unanswered : assignments;
    const bySector = new Map<string, Map<string, { post: string; rows: PlacementAssignment[] }>>();
    for (const a of rows) {
      const post = postById.get(a.postId);
      const sector = post?.sector ?? "Пост вне расчёта";
      const label = post?.post ?? a.postId;
      const posts = bySector.get(sector) ?? new Map();
      const bucket = posts.get(a.postId) ?? { post: label, rows: [] };
      bucket.rows.push(a);
      posts.set(a.postId, bucket);
      bySector.set(sector, posts);
    }
    // 🔴 КОРЗИНА НЕСЁТ СВОЙ id (Plane №615). Ключились корзины по `postId`, а
    // рисовались с `key={bucket.post}` — ПОДПИСЬЮ поста. Два разных поста с
    // одинаковым названием в одном секторе — норма расчёта («два поста
    // наружного наблюдения»), и React получал совпавшие ключи: предупреждение
    // в консоли и переиспользование состояния DOM между группами при
    // перерисовке после мутации.
    return [...bySector.entries()].map(([sector, posts]) => ({
      sector,
      posts: [...posts.entries()].map(([postId, bucket]) => ({ postId, ...bucket })),
    }));
  }, [assignments, event.reconSectorPosts, unanswered, scope]);

  /** Отчёт ПОСЛЕДНЕГО нажатия (Plane №614), а не первого попавшегося. */
  const report =
    lastRemind === "all"
      ? remindAll.data
      : lastRemind === "one"
        ? remindOne.data
        : undefined;

  /**
   * Кто ведёт этап «Ознакомление» (Plane №612/№494, `[ОЗН-09]`).
   *
   * 🔴 ЭКРАН СЧИТАЛ ПРАВО НЕ ТАК, КАК СЕРВЕР. Здесь стояло
   * `access.can(EVENT_MANAGE)`, и этим гасились ВСЕ действия этапа:
   * «Напомнить», «Напомнить всем», «Завершить», замена, кнопки строки. А
   * сервер СПЕЦИАЛЬНО пускает сюда старшего без `event.manage`
   * (`_STAGE_LEAD_ACTIONS` → `my_assignments.may_manage_stage`), и это не
   * послабление, а сама суть `[ОЗН-09]`. У той персоны, ради которой обход
   * написан, все кнопки этапа были серыми с подсказкой «это дело ведущего
   * ОМ»: путь, описанный в спецификации и реализованный на сервере, был мёртв
   * со стороны экрана.
   *
   * Правило берётся С СЕРВЕРА ДОСЛОВНО (`_placement_chiefs`): старший
   * МЕРОПРИЯТИЯ либо старший ЛЮБОГО его объекта посещения — не только
   * показанного. Роль читается по данным, как это уже делает согласование
   * (`useApprovalRights`); `useChainAccess` роли по данным моделировать
   * отказывается намеренно, и заводить их там значило бы завести вторую
   * правду об авторизации.
   *
   * ЗАМЕЩАЮЩИЙ, ВЕДУЩИЙ ОБЪЕКТ, ЗДЕСЬ ЕСТЬ (Plane №453; экранная половина
   * дописана по ревью, задача №825). Здесь стояло обратное — «замещающего
   * нет, `may_manage_stage` его не пускает», — и это было верно РОВНО ДО
   * коммита самой №453: сервер его пустил, а экран остался прежним. То есть
   * карточка закрылась наполовину, а комментарий стал утверждать
   * противоположное тому, что делает сервер, — и следующий читатель поверил
   * бы ему. Спецификация `[ОЗН-09]` даёт замещающему ту же работу, что
   * старшему объекта, КРОМЕ «Завершить».
   *
   * Наблюдатель — не замещающий: флаг `canEditPlacement` отличает того, кто
   * ВЕДЁТ объект, от внесённого «в список», и сервер спрашивает его же
   * (`_replaces_own_post`, `_leads_as_deputy`). Отсутствие ключа у старых
   * строк значит «ведёт» — умолчание модели, а не «наблюдает».
   *
   * Пока права и кадровая запись едут, действие считается доступным — та же
   * договорённость, что в `useChainAccess`: мигание «нельзя → можно» вводит в
   * заблуждение сильнее, чем секунда доступной кнопки, а сервер всё равно
   * стоит за ней.
   */
  const me = useMyEmployee();
  const myEmployeeId =
    me.data?.employee != null ? String(me.data.employee.id) : null;
  const isStageLead =
    myEmployeeId !== null &&
    ([event.chiefEmployeeId, ...event.visitObjects.map((v) => v.chiefEmployeeId)].some(
      (chief) => chief !== null && String(chief) === myEmployeeId
    ) ||
      event.visitObjects.some((visit) =>
        (visit.deputies ?? []).some(
          (deputy) =>
            String(deputy.employeeId) === myEmployeeId &&
            deputy.canEditPlacement !== false
        )
      ));
  const canManage = access.can(EVENT_MANAGE) || isStageLead;
  // 🔴 ЗАМЕНА — ТОЛЬКО НА ПОСТАХ СВОЕГО ОБЪЕКТА (Plane №613; экранная половина
  //    дописана по ревью, задача №825). Сервер с №613 отбивает замену на
  //    ЧУЖОМ объекте (`_replaces_own_post`), а экран передавал в каждую строку
  //    общий на мероприятие признак: старший объекта А видел включённую
  //    «Заменить →» на строках объекта Б и получал 403. Правообладателю
  //    (`event.manage`) сужение не касается — у него проходит любая проверка.
  const visitOfPost = new Map<string, string>(
    event.reconSectorPosts.map((post) => [
      post.id,
      String((post as { visitObjectId?: string | null }).visitObjectId ?? ""),
    ])
  );
  const myVisitIds = new Set(
    myEmployeeId === null
      ? []
      : event.visitObjects
          .filter(
            (visit) =>
              (visit.chiefEmployeeId !== null &&
                String(visit.chiefEmployeeId) === myEmployeeId) ||
              (visit.deputies ?? []).some(
                (deputy) =>
                  String(deputy.employeeId) === myEmployeeId &&
                  deputy.canEditPlacement !== false
              )
          )
          .map((visit) => String(visit.id))
  );
  const mayReplaceOn = (postId: string): boolean => {
    if (access.can(EVENT_MANAGE)) return true;
    if (myEmployeeId !== null && event.chiefEmployeeId !== null &&
        String(event.chiefEmployeeId) === myEmployeeId) {
      return true;
    }
    const owner = visitOfPost.get(postId) ?? "";
    // Неразмеченный пост у ЕДИНСТВЕННОГО объекта — его (то же правило, что у
    // сервера в `_visit_of_post`): размечать было не к чему.
    if (owner === "") {
      return event.visitObjects.length === 1
        ? myVisitIds.has(String(event.visitObjects[0]!.id))
        : false;
    }
    return myVisitIds.has(owner);
  };
  // 🔴 «ЗАВЕРШИТЬ» — ОПЕРАЦИЯ МЕРОПРИЯТИЯ, И ГЕЙТ У НЕЁ СВОЙ (Plane №453,
  //    вторая половина ревью задачи №825). Сервер держит
  //    `acknowledgement_complete` в `_EVENT_LEAD_ONLY_ACTIONS`: ни старший
  //    ОБЪЕКТА, ни его замещающий её не выполнят — она переводит на
  //    «Проведение» ВСЁ мероприятие. До сих пор кнопка гейтилась общим
  //    `canManage`, то есть у старшего объекта светилась включённой и
  //    отвечала 403 — обещание действия, которого не будет. Расширение на
  //    замещающих распространило бы это обещание и на них.
  const isEventLead =
    access.can(EVENT_MANAGE) ||
    (myEmployeeId !== null &&
      event.chiefEmployeeId !== null &&
      String(event.chiefEmployeeId) === myEmployeeId);
  const completeReason = isEventLead
    ? ""
    : "Завершает ознакомление ведущий мероприятие или старший ОМ: этап переводит на «Проведение» всё мероприятие.";
  const allConfirmed = total > 0 && confirmed.length === total;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Ознакомление</CardTitle>
            {/* Шапка одной строкой (`[ОЗН-02]`) — без дублирующего «(K/N)». */}
            <p className="mt-1 text-sm text-muted-foreground" data-testid="ack-summary">
              {/* `[ОЗН-02]` (Plane №447): «Ознакомились K из N · не открыли M ·
                  отказов D · срок подтверждения ДД.ММ ЧЧ:ММ». С №452
                  добавлено четвёртое число — «открыли и молчат»: это ДРУГОЕ
                  положение, и старший поступает с ним иначе (не напомнить, а
                  позвонить). Ставится рядом с «не открыли», чтобы два
                  неотвеченных случая читались вместе. */}
              Ознакомились {confirmed.length} из {total} · не открыли {pending.length} ·
              открыли и молчат {opened.length} · отказов{" "}
              {declined.length}
              {event.acknowledgementDeadline
                ? ` · срок подтверждения ${formatIsoDateTime(event.acknowledgementDeadline)}`
                : ""}
            </p>
          </div>
          {/* Причина отказа по праву — ВИДИМОЙ строкой и один раз на шаг
              (Plane №801): на выключенной кнопке `title` не показывается
              вовсе, браузер подавляет на ней указательные события. Связь
              кнопки с причиной держит `aria-describedby`. */}
          <div className="flex flex-col items-start gap-2">
          <AccessHints reasons={[access.reason(EVENT_MANAGE), completeReason]}>
          <div className="flex flex-wrap gap-2">
            <RightGate reason={stageBehindReason || access.reason(EVENT_MANAGE)}>
              {(describedBy) => (
            <Button
              type="button"
              variant="outline"
              disabled={
                remindAll.isPending ||
                unanswered.length === 0 ||
                !canManage ||
                !eventOnStage
              }
              aria-describedby={describedBy}
              title={
                unanswered.length === 0
                  ? "Все ответили — напоминать некому"
                  : "Напомнить каждому, кто ещё не подтвердил, и их руководителям"
              }
              onClick={() => {
                setLastRemind("all");
                remindAll.mutate({});
              }}
            >
              <Bell className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {remindAll.isPending ? "Отправка…" : `Напомнить всем, кто не подтвердил (${unanswered.length})`}
            </Button>
              )}
            </RightGate>
            {/* 🔴 ЗАВЕРШЕНИЕ ЭТАПА — ОПЕРАЦИЯ МЕРОПРИЯТИЯ, А НЕ ОБЪЕКТА
                (Plane №528). Цепочка этапов в карточке рисуется по этапу
                ПОКАЗАННОГО ОБЪЕКТА (`[МД-04]`, №412), а сервер сторожит
                `complete_acknowledgement` этапом МЕРОПРИЯТИЯ — и правильно:
                он смотрит на `placement_assignments`, которые общие, а не
                объектные. У ОМ, где один объект уже на «Ознакомлении», а
                второй ещё нет, карточка показывала этот этап с ВКЛЮЧЁННОЙ
                кнопкой, и сервер отвечал 422. Предлагать заведомо невыполнимое
                действие хуже, чем не предлагать: человек считает отказ
                поломкой.

                Кнопка гаснет и НАЗЫВАЕТ причину — сколько объектов ещё не
                дошло. Это не «нет прав» и не «не все подтвердили», а третье
                состояние, и молчать о нём нельзя. */}
            <RightGate reason={completeReason || stageBehindReason || access.reason(EVENT_MANAGE)}>
              {(describedBy) => (
            <Button
              type="button"
              disabled={
                complete.isPending || !isEventLead || total === 0 || !eventOnStage
              }
              aria-describedby={describedBy}
              title={
                !eventOnStage
                  ? `Этап завершается по всему мероприятию: ${behindLabel}`
                  : undefined
              }
              onClick={() =>
                allConfirmed ? complete.mutate({}) : setCompleteOpen(true)
              }
            >
              {complete.isPending ? "Завершение…" : "Завершить ознакомление"}
            </Button>
              )}
            </RightGate>
          </div>
          </AccessHints>
          </div>
        </div>

        {/* Полоса ЧЕТЫРЁХ цветов: подтвердил / отказ / открыл и молчит /
            не открывал (`[ОЗН-02]`, Plane №452). Здесь стояло «трёх», и это
            перестало быть правдой в тот же заход, что и правка (найдено
            ревью №825). */}
        <div
          className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct(confirmed.length)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Готовность ознакомления"
        >
          <div className="h-full bg-green-500" style={{ width: `${pct(confirmed.length)}%` }} data-segment="confirmed" />
          <div className="h-full bg-red-500" style={{ width: `${pct(declined.length)}%` }} data-segment="declined" />
          {/* ЖЁЛТЫЙ — «открыл и не нажал» (`[ОЗН-02]`, Plane №452). Стоит
              между отказом и «не открывал» намеренно: слева ответы, справа
              молчание, а этот сегмент — молчание, о котором уже известно,
              что человек его выбрал. */}
          <div className="h-full bg-amber-400" style={{ width: `${pct(opened.length)}%` }} data-segment="opened" />
          <div className="h-full bg-muted-foreground/30" style={{ width: `${pct(pending.length)}%` }} data-segment="pending" />
        </div>
        {/* Порядок легенды — ТОТ ЖЕ, ЧТО У СЕГМЕНТОВ ПОЛОСЫ (найдено ревью
            №825): полоса шла зелёный → красный → жёлтый → серый, а легенда
            зелёный → жёлтый → серый → красный, и подпись приходилось искать
            вместо того, чтобы читать слева направо вместе с полосой. */}
        <p className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground" data-testid="ack-legend">
          <span><span className="inline-block h-2 w-2 rounded-full bg-green-500" /> подтвердил</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> отказ</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> открыл, не ответил</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" /> не открывал</span>
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {unanswered.length > 0 && (
          <div className="inline-flex gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["all", `Все (${total})`],
                ["pending", `Ожидают (${unanswered.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
                className={`rounded px-2.5 py-1 text-xs font-semibold ${
                  scope === value ? "bg-background shadow-sm" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? "Назначений нет — ознакамливаться некому."
              : "В этой выборке никого нет."}
          </p>
        ) : (
          <div className="space-y-4" data-testid="ack-groups">
            {groups.map((group) => (
              <section key={group.sector} aria-label={`Сектор ${group.sector}`} className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  {group.sector}
                </h3>
                {group.posts.map((bucket) => (
                  <div key={bucket.postId} className="rounded-md border">
                    <p className="border-b bg-muted/40 px-2.5 py-1.5 text-xs font-semibold">
                      {bucket.post}
                    </p>
                    <ul className="divide-y">
                      {bucket.rows.map((assignment) => (
                        <AssignmentRow
                          key={assignment.id}
                          assignment={assignment}
                          canManage={canManage}
                          // Напоминание закрыто и отставанием мероприятия:
                          // ручка стережётся тем же `_require_stage` (№528).
                          stageBehindReason={stageBehindReason}
                          canReplace={canManage && mayReplaceOn(assignment.postId)}
                          onAcknowledge={() => acknowledge.mutate({ assignmentId: assignment.id })}
                          onRemind={() => {
                            setLastRemind("one");
                            remindOne.mutate({ assignmentId: assignment.id });
                          }}
                          onReplace={() => setReplacing(assignment)}
                          busy={acknowledge.isPending || remindOne.isPending}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        <StageError error={acknowledge.error} />
        <StageError error={remindOne.error} />
        <StageError error={remindAll.error} />
        <StageError error={complete.error} />

        {report !== undefined && (
          // 🔴 ЖЕЛТИТ ТОЛЬКО ТО, ЧТО ЧИНЯТ (Plane №900). Исходов у рассылки
          // теперь три, и два из них — не ошибки. «Нет учётки» зовёт
          // кадровика; «уволен» не зовёт никого — человека в наряде уже нет.
          // Пропущенные уволенные плашку НЕ желтят, иначе старший ходил бы
          // разбираться с тем, что работает как задумано.
          //
          // Различие несёт ТЕКСТ, а не только цвет: правило «не передавать
          // смысл одним цветом» (скилл `ui-ux-pro-max`, Accessibility →
          // Color Only) здесь и есть предмет — обе строки в одной плашке
          // отличаются как раз тем, зовут ли они что-то делать. Поэтому у
          // каждой названа ПОЧИНКА или её отсутствие, а не только число.
          <p
            className={
              report.unlinkedEmployeeIds.length > 0
                ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                : "rounded-md border px-3 py-2 text-xs text-muted-foreground"
            }
            // Одно атомарное сообщение о состоянии, а не живое число: экранный
            // читатель произносит строку целиком и не перебивает работу.
            role="status"
            aria-atomic="true"
            data-testid="remind-report"
          >
            Напоминание отправлено: {report.employees} заступающим и{" "}
            {report.supervisors} руководителям.
            {report.unlinkedEmployeeIds.length > 0 && (
              <>
                {" "}Не дошло до {report.unlinkedEmployeeIds.length}:
                у их кадровых записей нет связанной учётной записи — её
                заводит кадровик.
              </>
            )}
            {report.dismissedEmployeeIds.length > 0 && (
              <>
                {" "}Пропущено {report.dismissedEmployeeIds.length}:
                сотрудники уволены, напоминать им не нужно.
              </>
            )}
          </p>
        )}

        {replacing !== null && (
          <ReplaceInline
            event={event}
            assignment={replacing}
            onClose={() => setReplacing(null)}
          />
        )}
      </CardContent>

      {/* Подтверждение завершения при неподтвердивших (`[ОЗН-04]`). */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {total - confirmed.length} {peopleWord(total - confirmed.length)} не подтвердили. Завершить?
            </DialogTitle>
            <DialogDescription>
              Этап перейдёт на «Проведение» без их подтверждения. Комментарий
              обязателен — он ложится в журнал мутаций вместе с числом
              неподтвердивших.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="ack-complete-comment">Комментарий</Label>
            <Textarea
              id="ack-complete-comment"
              rows={3}
              placeholder="Например: доведено устно на разводе"
              value={completeComment}
              onChange={(e) => setCompleteComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={completeComment.trim() === "" || complete.isPending}
              onClick={() => {
                void complete
                  .mutateAsync({ force: true, comment: completeComment.trim() })
                  .then(() => {
                    setCompleteOpen(false);
                    setCompleteComment("");
                  })
                  .catch(() => undefined);
              }}
            >
              Завершить без подтверждения всех
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AssignmentRow({
  assignment,
  canManage,
  stageBehindReason,
  canReplace,
  onAcknowledge,
  onRemind,
  onReplace,
  busy,
}: {
  assignment: PlacementAssignment;
  canManage: boolean;
  /** Мероприятие ещё не дошло до этапа — словами; `null`, когда дошло. */
  stageBehindReason: string | null;
  /** Замена — операция ОБЪЕКТА: чужой пост её не получает (Plane №613). */
  canReplace: boolean;
  onAcknowledge: () => void;
  onRemind: () => void;
  onReplace: () => void;
  busy: boolean;
}) {
  const state = stateOf(assignment);
  return (
    <li
      className="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm"
      data-testid={`ack-row-${assignment.id}`}
      data-state={state}
    >
      <span className="font-semibold">{assignment.employeeName}</span>
      {assignment.divisionName !== "" && (
        <span className="text-xs text-muted-foreground">{assignment.divisionName}</span>
      )}
      {state === "confirmed" && (
        <span className="ml-auto inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
          Ознакомлен{assignment.acknowledgedVia === "personal" ? " лично" : ""}{" "}
          {formatIsoDateTime(assignment.acknowledgedAt ?? "")}
          {assignment.acknowledgedVia === "personal" && (assignment.acknowledgedBy ?? "") !== ""
            ? ` · ${assignment.acknowledgedBy}`
            : ""}
        </span>
      )}
      {state === "declined" && (
        <>
          <span
            className="ml-auto inline-flex max-w-[320px] rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800"
            title={assignment.declineReason ?? undefined}
          >
            <X className="mr-1 h-3 w-3" aria-hidden="true" />
            Не может заступить
            {assignment.declineReason ? `: ${assignment.declineReason}` : ""}
          </span>
          {/* 🔴 ЧЬИ ЭТО СЛОВА (Plane №588). Отказ читается как сказанное САМИМ
              сотрудником, а вписать его может и старший — гейт ручки пускает
              старшего и ведущего ОМ намеренно: человек может позвонить. Пока
              автора не было, чужая формулировка выдавалась за его собственную.
              Подпись стоит ОТДЕЛЬНОЙ строкой, а не внутри плашки: у плашки
              есть предел ширины, и длинная причина обрезала бы именно то, ради
              чего подпись добавлена.
              Показывается ТОЛЬКО когда записал не сам сотрудник: способ берётся
              полем `declinedVia`, а не сравнением подписи с фамилией — подписи
              приходят из разных источников и совпадают не всегда. */}
          {assignment.declinedVia === "personal" &&
            (assignment.declinedBy ?? "") !== "" && (
              <span className="text-[11px] text-muted-foreground">
                записал: {assignment.declinedBy}
              </span>
            )}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!canReplace}
            title={
              canReplace
                ? undefined
                : "Заменить на посту чужого объекта может только его старший"
            }
            onClick={onReplace}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Заменить →
          </Button>
        </>
      )}
      {/* НЕОТВЕЧЕННЫЕ — одна ветка на два положения (Plane №452). Кнопки у них
          одинаковые: напомнить и отметить лично можно и тому, кто открыл, и
          тому, кто не открывал. Различает их ПЛАШКА и телефон: «открыл и
          молчит» — это повод позвонить, а не напомнить ещё раз. */}
      {(state === "pending" || state === "opened") && (
        <>
          {/* 🔴 «НАПОМНИЛИ» ГОВОРИТСЯ В ОБОИХ ПОЛОЖЕНИЯХ (найдено ревью №825).
              Отметка стояла только у «не открывал», а нужна она СИЛЬНЕЕ ВСЕГО
              во втором: напомнили → человек открыл → молчит. Старший не видел,
              что напоминание уже уходило, и жал «Напомнить» повторно — то
              есть повторял действие, которое как раз и не сработало. */}
          {state === "opened" ? (
            <span
              className="ml-auto inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
              title={`Открыл свои назначения ${formatIsoDateTime(
                assignment.viewedAt ?? ""
              )} и не нажал ни «ознакомлен», ни отказ`}
            >
              {/* Момент — КОРОТКИЙ (день и время): «открыл три дня назад и
                  молчит» и «открыл минуту назад» — разные поводы, поэтому
                  время в плашке нужно, а год в строке наряда не значит
                  ничего. Полный момент остаётся в подсказке. Длинная форма
                  распирала строку так, что кнопки уезжали на второй ряд. */}
              Открыл {formatIsoDayTime(assignment.viewedAt ?? "")}, не ответил
              {(assignment.remindedAt ?? null) !== null &&
                ` · напомнили ${formatIsoDayTime(assignment.remindedAt ?? "")}`}
            </span>
          ) : (
            /* Серая, а не янтарная (найдено ревью №825): две почти одинаковые
               янтарные плашки стояли на ДВУХ ПРОТИВОПОЛОЖНЫХ положениях, и
               различались они только оттенком — то, что читают глазами первым.
               Серый совпадает с серым сегментом «не открывал» в полосе выше. */
            <span className="ml-auto inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              Не открывал
              {(assignment.remindedAt ?? null) !== null &&
                ` · напомнили ${formatIsoDateTime(assignment.remindedAt ?? "")}`}
            </span>
          )}
          {/* ☎ (`[ОЗН-03]`, Plane №452) — ССЫЛКА `tel:`, а не текст: со
              служебного планшета старший звонит нажатием, а не переписывает
              номер. Показывается только неотвеченным — у подтвердивших звонить
              не о чем, и номер там был бы лишними данными на экране. */}
          {(assignment.phone ?? "") !== "" && (
            <a
              /* Номер в `href` — только `+` и цифры (найдено ревью №825): в
                 кадровой записи он лежит форматированным («+7 701 000-10-01»),
                 а по RFC 3966 пробелов в `tel:` быть не должно — часть
                 наборников на них спотыкается. Видимым текстом остаётся
                 форматированный. */
              href={`tel:${(assignment.phone ?? "").replace(/[^+\d]/g, "")}`}
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              title={`Позвонить: ${assignment.employeeName}`}
              data-testid={`ack-phone-${assignment.id}`}
            >
              <Phone className="h-3 w-3" aria-hidden="true" />
              {assignment.phone}
            </a>
          )}
          <RightGate reason={stageBehindReason}>
            {(describedBy) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !canManage || stageBehindReason !== null}
            aria-describedby={describedBy}
            aria-label={`Напомнить: ${assignment.employeeName}`}
            onClick={onRemind}
          >
            <Bell className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Напомнить
          </Button>
            )}
          </RightGate>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !canManage}
            title="Ознакомлен лично — доведено устно, отметка старшего"
            onClick={onAcknowledge}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Ознакомлен лично
          </Button>
        </>
      )}
    </li>
  );
}

/** Замена отказавшегося прямо на этапе (`[ОЗН-03]`): кого — задано строкой,
 * кем — подбор с поиском на сервере, причина — обязательна. */
function ReplaceInline({
  event,
  assignment,
  onClose,
}: {
  event: SecurityEvent;
  assignment: PlacementAssignment;
  onClose: () => void;
}) {
  const [incomingEmployeeId, setIncomingEmployeeId] = useState("");
  const [reasonCode, setReasonCode] = useState(
    assignment.declineReason ? `Отказ: ${assignment.declineReason}` : ""
  );
  const replace = useReplaceAssignment(event.id);
  const post = event.reconSectorPosts.find((p) => p.id === assignment.postId);
  return (
    <section
      aria-label="Замена отказавшегося"
      className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3"
      data-testid="ack-replace"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm">
          Заменить <b>{assignment.employeeName}</b>
          {post ? ` на посту «${post.sector} · ${post.post}»` : ""}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть замену">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ack-replace-reason">Причина *</Label>
        <Input
          id="ack-replace-reason"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          placeholder="Например: болезнь"
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Кем заменить</p>
        <PersonnelPicker
          value={incomingEmployeeId === "" ? null : incomingEmployeeId}
          onPick={(id) => setIncomingEmployeeId((current) => (current === id ? "" : id))}
          pageSize={8}
          searchInputId="ack-replace-search"
        />
      </div>
      <StageError error={replace.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button
          type="button"
          disabled={replace.isPending || incomingEmployeeId === "" || reasonCode.trim() === ""}
          onClick={() => {
            void replace
              .mutateAsync({ assignmentId: assignment.id, incomingEmployeeId, reasonCode: reasonCode.trim() })
              .then(onClose)
              .catch(() => undefined);
          }}
        >
          {replace.isPending ? "Замена…" : "Заменить"}
        </Button>
      </div>
    </section>
  );
}

/** Правило склонения — общее (Plane №783, `lib/ru-plural.ts`). */
function peopleWord(n: number): string {
  return ruPlural(n, PEOPLE);
}
