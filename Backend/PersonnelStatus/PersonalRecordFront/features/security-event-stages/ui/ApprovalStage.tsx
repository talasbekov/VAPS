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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAddApprover,
  useDecideApprover,
  useMoveApprover,
  useRemoveApprover,
  useResolveRemark,
  useSendForApproval,
  useWithdrawApproval,
} from "@/hooks/use-security-event-stages";
import type {
  ApprovalRemark,
  SecurityEvent,
  VisitObject,
} from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";
import { formatIsoDateTime } from "@/shared/lib/date";
import { useVisitObjectScope, type VisitObjectScope } from "./useVisitObjectScope";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useMyEmployee } from "@/hooks/use-my-employee";
import { useRenderEventDocument } from "@/hooks/use-ops-reports";
import { saveBinaryFile } from "@/features/ops-reports/report-shared";
import { formatIsoDate } from "@/shared/lib/date";

/**
 * Кто что может на этапе 3 (`[СОГ-12]`, Plane №401).
 *
 * Правило раздела: недоступное действие ВЫКЛЮЧАЕТСЯ и говорит, чьё оно, а не
 * прячется (см. `forces-split/ui/chain-access.ts`). Клиент гейтит по КОДУ
 * права и по РОЛИ В ДАННЫХ показанного объекта — тем же двум признакам, по
 * которым решает сервер (`permission_override` у вьюсета): старший объекта
 * отправляет и отзывает, его замещающий отвечает на замечания, и ни тому, ни
 * другому для этого не нужен общий `event.manage`. Область права клиент не
 * считает — её проверяет сервер, и его отказ человек читает словами там же.
 */
interface ApprovalRights {
  /** Маршрут (добавить / снять / переставить) — настройка процесса, ведущий. */
  manageRoute: boolean;
  /** Отправить и отозвать — ведущий мероприятие или старший объекта. */
  send: boolean;
  /** Ответить на замечание — то же плюс замещающий объекта. */
  answerRemarks: boolean;
  approve: boolean;
  returnBack: boolean;
}

const RIGHT_REASON = {
  manageRoute: "Маршрут согласования настраивает ведущий мероприятие",
  send: "Отправляет и отзывает старший объекта или ведущий мероприятие",
  answerRemarks:
    "На замечания отвечает старший объекта, его замещающий или ведущий мероприятие",
  approve: "Согласовывает расстановку утверждающий",
  returnBack: "Возвращает расстановку на доработку утверждающий",
} as const;

/** Подсказка выключенной кнопки; `undefined` — кнопка доступна. */
function reasonUnless(allowed: boolean, key: keyof typeof RIGHT_REASON) {
  return allowed ? undefined : RIGHT_REASON[key];
}

function useApprovalRights(
  event: SecurityEvent,
  visit: VisitObject | null | undefined
): ApprovalRights {
  const { hasPermission, permissions } = useOpsPermissions();
  const me = useMyEmployee();
  // Пока права не пришли, кнопки НЕ выключаются с ложной причиной: серверный
  // отказ всё равно стоит за ними, а мигание «нельзя → можно» вводит в
  // заблуждение сильнее, чем секунда доступной кнопки.
  const loading = permissions === undefined;
  const myId = me.data?.employee ? String(me.data.employee.id) : null;
  const manage = loading || hasPermission("event.manage");
  const chiefId = visit ? visit.chiefEmployeeId : event.chiefEmployeeId;
  const isChief = myId !== null && chiefId !== null && chiefId === myId;
  const isDeputy =
    myId !== null &&
    (visit?.deputies ?? []).some((deputy) => deputy.employeeId === myId);
  return {
    manageRoute: manage,
    send: manage || isChief,
    answerRemarks: manage || isChief || isDeputy,
    approve: loading || hasPermission("assignment.approve"),
    returnBack: loading || hasPermission("assignment.return"),
  };
}

/**
 * Согласование ПОКАЗАННОГО объекта посещения (Plane №411, Ш-5 плана №385).
 *
 * Требование `[МД-04]`: «У объекта свои этапы 1–5 и свой документ „Расстановка
 * сил“ с версиями». До этого шага маршрут, замечания и снимок состава были
 * полями МЕРОПРИЯТИЯ: у ОМ с двумя объектами согласующий подписывался под
 * общим списком, где посты двух разных мест лежали вперемешку, а вернуть на
 * доработку один объект было нельзя вовсе.
 *
 * Объектов нет вовсе — отвечают поля мероприятия: у ОМ, заведённых без
 * объекта, согласование ещё лежит там, и подменять его пустотой значило бы
 * стереть с экрана живые данные. Версии документа у них нет — её завёл сам
 * объект, и `null` здесь означает «спрашивать не у кого», а не «версия 0».
 */
interface ApprovalView {
  visitObjectId?: string;
  status: SecurityEvent["approvalStatus"];
  comment: string;
  route: SecurityEvent["approvalRoute"];
  remarks: SecurityEvent["approvalRemarks"];
  stale: boolean;
  documentVersion: number | null;
  /** История версий документа объекта (`[СОГ-04]`, Plane №398); у ОМ без
   * объектов — пусто: документ принадлежит объекту. */
  documentVersions: VisitObject["documentVersions"];
  documentStatus: VisitObject["documentStatus"];
}

function approvalViewOf(
  event: SecurityEvent,
  visit: VisitObject | null
): ApprovalView {
  if (visit === null) {
    return {
      status: event.approvalStatus,
      comment: event.approvalComment,
      route: event.approvalRoute,
      remarks: event.approvalRemarks,
      stale: event.approvalStale,
      documentVersion: null,
      documentVersions: [],
      documentStatus: null,
    };
  }
  return {
    visitObjectId: visit.id,
    status: visit.approvalStatus,
    comment: visit.approvalComment,
    route: visit.approvalRoute,
    remarks: visit.approvalRemarks,
    stale: visit.approvalStale,
    documentVersion: visit.documentVersion,
    documentVersions: visit.documentVersions,
    documentStatus: visit.documentStatus,
  };
}

/** Подписи статуса версии документа — `[СОГ-01]`: Черновик → На согласовании
 *  → Согласовано → Возвращено. Словами, не цветом: статус читается и без
 *  палитры (скилл: «Compact Label Semantics»). */
const DOCUMENT_STATUS_LABEL: Record<
  NonNullable<VisitObject["documentStatus"]>,
  string
> = {
  DRAFT: "Черновик",
  SUBMITTED: "На согласовании",
  APPROVED: "Согласовано",
  RETURNED: "Возвращено",
};

const DOCUMENT_STATUS_CLASS: Record<
  NonNullable<VisitObject["documentStatus"]>,
  string
> = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-blue-100 text-blue-900",
  APPROVED: "bg-green-100 text-green-800",
  RETURNED: "bg-amber-100 text-amber-900",
};

/**
 * «История версий» документа «Расстановка сил» (`[СОГ-04]`, Plane №398).
 *
 * Показывается, когда версий больше одной ЛИБО единственная уже не черновик:
 * у свежего черновика история — это он сам, и отдельный блок повторял бы
 * подпись «документ v1» у маршрута. Отменённые версии помечены словом, а не
 * только приглушены: «отменена» — факт, который должен читаться и в
 * чёрно-белом снимке.
 *
 * Пилюли статические: по версии здесь ничего не делают — diff и PDF версии
 * приходят с `[ВОЗ-06]`/`[СОГ-03]`, и делать пилюлю кнопкой заранее значило бы
 * обещать действие, которого нет.
 */
function DocumentVersionHistory({ view }: { view: ApprovalView }) {
  const versions = view.documentVersions;
  if (versions.length === 0) return null;
  if (versions.length === 1 && versions[0].status === "DRAFT") return null;
  const current = versions[versions.length - 1];
  return (
    <section className="rounded-md border" aria-label="История версий документа">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-semibold">История версий документа «Расстановка сил»</p>
        <p className="text-[11px] text-muted-foreground" data-slot="version-counter">
          {/* Счётчик по `[ВОЗ-08]` (Plane №446): «Версия N · возврат K-й». */}
          Версия {current.number}
          {versions.length > 1 ? ` · возврат ${versions.length - 1}-й` : ""}
        </p>
      </div>
      <ul className="divide-y">
        {[...versions].reverse().map((version) => (
          <li
            key={version.number}
            className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${
              version.supersededAt !== null ? "text-muted-foreground" : ""
            }`}
          >
            <span className="font-semibold tabular-nums">v{version.number}</span>
            <span
              className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${DOCUMENT_STATUS_CLASS[version.status]}`}
            >
              {DOCUMENT_STATUS_LABEL[version.status]}
            </span>
            {version.supersededAt !== null && (
              <span className="inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]">
                отменена
              </span>
            )}
            {version.diff != null && (
              /* Diff с предыдущей версией (`[ВОЗ-06]`, Plane №431): что
                 согласующий подписывает заново — словами, не «изменилась». */
              <span className="block w-full text-[11px]" data-slot="version-diff">
                {version.diff.addedPosts.length === 0 &&
                version.diff.removedPosts.length === 0 &&
                version.diff.replacedPeople.length === 0
                  ? "Изменений против предыдущей версии нет"
                  : [
                      ...version.diff.addedPosts.map((p) => `добавлен пост ${p}`),
                      ...version.diff.removedPosts.map((p) => `снят пост ${p}`),
                      ...version.diff.replacedPeople.map(
                        (r) => `${r.post}: ${r.was.join(", ") || "—"} → ${r.now.join(", ") || "—"}`
                      ),
                    ].join(" · ")}
              </span>
            )}
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              заведена {formatIsoDateTime(version.createdAt)}
              {version.createdBy !== "" ? ` · ${version.createdBy}` : ""}
              {version.sentAt !== null
                ? ` · отправлена ${formatIsoDateTime(version.sentAt)}`
                : ""}
              {version.decidedAt !== null
                ? ` · решение ${formatIsoDateTime(version.decidedAt)}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const REMARK_STATUS_LABEL: Record<ApprovalRemark["status"], string> = {
  OPEN: "Открыто",
  RESOLVED: "Устранено",
  DISAGREED: "Не согласен",
};

const REMARK_STATUS_CLASS: Record<ApprovalRemark["status"], string> = {
  OPEN: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-green-100 text-green-800",
  // Несогласие с ответом — ЗАКРЫТОЕ состояние, не тревога: цвет нейтральный,
  // иначе честный ответ читался бы как невыполненная работа.
  DISAGREED: "bg-muted text-muted-foreground",
};

const VISIT_APPROVAL_LABEL: Record<SecurityEvent["approvalStatus"], string> = {
  PENDING: "ожидает",
  APPROVED: "согласовано",
  RETURNED: "возвращено",
};

const VISIT_APPROVAL_CLASS: Record<SecurityEvent["approvalStatus"], string> = {
  PENDING: "bg-muted text-muted-foreground",
  APPROVED: "bg-green-100 text-green-800",
  RETURNED: "bg-amber-100 text-amber-900",
};

/** Подпись версии документа. `0` — не «версия ноль», а «не отправлялся»:
 *  число на бумаге читалось бы как номер выпуска, которого не было. */
function documentVersionLabel(
  version: number | null,
  status: VisitObject["documentStatus"] = null
): string | null {
  if (version === null) return null;
  if (version === 0) return "документ не отправлялся";
  // Статус документа словами (`[СОГ-01]`) — рядом с номером, а не отдельной
  // плиткой: это одно утверждение «какая версия и в каком она состоянии».
  return status === null
    ? `документ v${version}`
    : `документ v${version} · ${DOCUMENT_STATUS_LABEL[status].toLowerCase()}`;
}

/**
 * Состояние согласования ПО ВСЕМ объектам одной строкой.
 *
 * Почему здесь НЕ селект-переключатель, как на рекогносцировке и расстановке
 * ([[Frontend/Decisions]], 03.09.2026): там переключатель отвечает на «что
 * показано» и о состоянии объекта не говорит ничего. Здесь состояние объекта —
 * сама суть экрана: «у первого согласовано, у второго возврат» человек обязан
 * видеть НЕ ПЕРЕКЛЮЧАЯСЬ, иначе он узнает о возврате, только заглянув. Ряд
 * кнопок отвечает на оба вопроса одним элементом вместо двух.
 *
 * Выбор берётся у общего разреза `useVisitObjectScope` — того же, что у
 * соседних этапов: своё состояние здесь развело бы «объект в шапке» и «объект
 * на этапе», а это ровно тот дефект, который чинила №388.
 */
function VisitObjectApprovalStrip({
  event,
  scope,
}: {
  event: SecurityEvent;
  scope: VisitObjectScope;
}) {
  if (event.visitObjects.length < 2) return null;
  return (
    <section
      className="rounded-md border bg-muted/30 px-3 py-2"
      aria-label="Согласование по объектам посещения"
    >
      <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
        Согласуется объект посещения — у каждого свой маршрут, свои замечания и
        свой документ «Расстановка сил»
      </p>
      <div className="flex flex-wrap gap-1.5">
        {event.visitObjects.map((visit) => {
          const shown = visit.id === scope.shown;
          return (
            <button
              key={visit.id}
              type="button"
              /* Кнопка с `aria-pressed`, а не кликабельный div: состояние
                 «выбран» обязано быть слышно, а не только видно. */
              aria-pressed={shown}
              onClick={() => scope.setShown(visit.id)}
              className={`inline-flex min-h-8 items-center gap-2 rounded-md border px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                shown ? "border-foreground/40 bg-background" : "hover:bg-muted"
              }`}
            >
              <span className="font-semibold">{visit.objectName}</span>
              <span
                className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${VISIT_APPROVAL_CLASS[visit.approvalStatus]}`}
              >
                {VISIT_APPROVAL_LABEL[visit.approvalStatus]}
              </span>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                {documentVersionLabel(visit.documentVersion)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ApprovalStage({ event }: { event: SecurityEvent }) {
  // Кнопки решения выключаются, если права нет, и говорят ЧЬЁ это действие:
  // с 28.08.2026 подпись и возврат — работа утверждающего, а не ведущего
  // мероприятие (решение заказчика, Plane №267). Спрятать их было бы хуже —
  // человек не узнал бы, к кому идти.

  // Разрез по объекту — ТОТ ЖЕ хук, что у рекогносцировки и расстановки:
  // второй ответ на «какой объект сейчас ведём» разошёлся бы с первым при
  // первом же переходе по ссылке из реестра.
  const scope = useVisitObjectScope(event, event.reconSectorPosts);
  const view = approvalViewOf(event, scope.visit);
  const rights = useApprovalRights(event, scope.visit);

  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
  const postLabel = (postId: string): string => {
    const post = postById.get(postId);
    return post ? `${post.sector} · ${post.post}` : postId;
  };

  // СЧИТАЕМ ПО ПОСТАМ ОБЪЕКТА, а не мероприятия: сводка над маршрутом должна
  // отвечать про то, что согласуют. Ровно тот же разрез держит сервер, когда
  // считает снимок расстановки объекта (`placement_signature`), — иначе
  // «назначено 5 из 12» на экране и «расстановка изменилась» от сервера
  // говорили бы о разных наборах постов.
  const scopedPostIds = new Set(scope.rows.map((post) => post.id));
  const scopedAssignments = event.placementAssignments.filter((a) =>
    scopedPostIds.has(a.postId)
  );
  const totalNeed = scope.rows.reduce((sum, post) => sum + post.need, 0);
  const understaffed = scope.rows.filter(
    (post) =>
      scopedAssignments.filter((a) => a.postId === post.id).length < post.need
  ).length;

  return (
    // Область с именем вместо снятого заголовка — см. ReconStage (Plane №70).
    <Card role="region" aria-label="Согласование расстановки">
      {/* Имени этапа здесь НЕТ намеренно (Plane №70): оно стоит НАД
          карточкой, в шапке страницы («Этап N из 5 · …»). Второй заголовок
          читался бы как вложенный раздел, которого нет, и отнимал строку у
          содержимого. Подзаголовки внутри карточки остаются — они называют
          блоки, а не этап. */}
      <CardContent className="space-y-4">
        <VisitObjectApprovalStrip event={event} scope={scope} />

        {view.status === "RETURNED" && view.comment !== "" && (
          <Alert>
            <AlertDescription>
              Прошлый возврат: {view.comment}
            </AlertDescription>
          </Alert>
        )}

        {/* Баннер эталона. Признак считает СЕРВЕР: по нему же он блокирует
            завершение этапа, и второй расчёт на клиенте разошёлся бы с ним
            молча. */}
        {view.stale && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertDescription className="text-amber-900">
              Расстановка изменилась после отправки. Необходимо повторное
              согласование — отправьте её согласующим заново.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-4 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <Kpi value={String(scope.rows.length)} label="постов" />
          <Kpi
            value={`${scopedAssignments.length} / ${totalNeed}`}
            label="назначено / потребность"
          />
          <Kpi
            value={String(understaffed)}
            label="не укомплектовано"
            alarming={understaffed > 0}
          />
          {/* Плитки «обходов предупреждений» здесь НЕТ (`[СОГ-11]`, Plane
              №446): обходы — предмет аудита, не согласования. */}
          <Kpi value={formatIsoDateTime(event.updatedAt)} label="обновлено" />
        </div>

        <ApprovalRoute event={event} view={view} rights={rights} />

        <ApprovalRemarks event={event} view={view} rights={rights} />

        <DocumentVersionHistory view={view} />

        <PrintedPlacement
          event={event}
          visit={scope.visit ?? null}
          posts={scope.rows}
          assignments={scopedAssignments}
          approved={view.status === "APPROVED"}
        />

        {/* `[СОГ-11]` (Plane №399): здесь НЕТ блока «Обходы предупреждений»
            (его место — аудит; число обходов остаётся плиткой сводки), НЕТ
            постоянного поля «Причина возврата» (причину спрашивает строка
            возврата в маршруте) и НЕТ кнопки «Завершить этап и перейти
            далее»: этап завершается сам последней подписью (`[СОГ-09]`), а
            возврат согласующего возвращает объект сразу (`[СОГ-08]`). Одно
            решение — в одном месте. Ручки `approve/`/`return/` на сервере
            остались под админа и API. */}
        <p className="text-[11px] text-muted-foreground" data-slot="approval-autocomplete-note">
          Этап завершится сам, когда подпишут все согласующие и не останется
          замечаний без ответа. Возврат любым согласующим возвращает объект на
          «Расстановку».
        </p>
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
function ApprovalRoute({
  event,
  view,
  rights,
}: {
  event: SecurityEvent;
  view: ApprovalView;
  rights: ApprovalRights;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [position, setPosition] = useState("");
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Замечания модалки возврата (`[ВОЗ-01]`, Plane №431): список, каждое с
  // привязкой к посту и своей срочностью; пустой список — одно замечание из
  // причины (старый контракт).
  const [returnRemarks, setReturnRemarks] = useState<
    { text: string; postId: string; urgent: boolean }[]
  >([]);
  // Посты, к которым можно привязать замечание, — посты ПОКАЗАННОГО объекта
  // (тот же разрез, что у сводки этапа); у ОМ без объектов — все.
  const returnPosts = event.reconSectorPosts.filter(
    (post) =>
      view.visitObjectId === undefined ||
      event.visitObjects.length === 1 ||
      post.visitObjectId === view.visitObjectId
  );

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
  /**
   * Закрыть окно возврата и ЗАБЫТЬ набранное (Plane №667).
   *
   * 🔴 ОДИН ПУТЬ ЗАКРЫТИЯ НА ВСЕ СПОСОБЫ. «Отмена», Esc и клик по подложке
   * чистили только `returnFor` — само окно; причина, список замечаний и
   * ошибки полей сбрасывались лишь в `onEvent`, то есть ТОЛЬКО после
   * успешного возврата. Брошенные черновики всплывали при следующем открытии
   * окна — и уезжали против ДРУГОЙ строки согласующего: окно одно на весь
   * маршрут, а кого возвращаем, помнит `returnFor`.
   *
   * Набранное теряется осознанно: замечание, приписанное не тому
   * согласующему, хуже, чем замечание, которое придётся набрать заново.
   * Обычное поведение диалога — закрытие отменяет ввод, и человек его ждёт.
   */
  const closeReturnDialog = () => {
    setReturnFor(null);
    setReason("");
    setReturnRemarks([]);
    setDecideErrors(null);
  };

  const decide = useDecideApprover(event.id, {
    onFormError: (details) => setDecideErrors(details),
    onEvent: closeReturnDialog,
  });

  /**
   * «Согласовано» с версией — и БЕЗ СКОБКИ, когда версии нет (Plane №719).
   *
   * У ОМ без объектов посещения документ не принадлежит никому:
   * `approvalViewOf` отдаёт таким `documentVersion: null` и пустую историю.
   * Прежняя строка печатала «Согласовано (версия —)» — скобка не несёт
   * сведений и читается как сбой данных. Раньше такие ОМ показывали
   * «Отправлено на согласование», то есть вопроса про версию не возникало
   * вовсе; он появился вместе с версиями документа объекта (№398).
   */
  const approvedSubtitle = (
    number: number | null,
    version: { decidedAt?: string | null } | null,
  ) => {
    if (number === null) return "Согласовано";
    const when = version?.decidedAt
      ? ` от ${formatIsoDateTime(version.decidedAt)}`
      : "";
    return `Согласовано (версия ${number}${when})`;
  };

  const route = view.route;
  const visitObjectId = view.visitObjectId;
  const sent = route.some((approver) => approver.status !== "NOT_SENT");
  /** Кто-то ЖДЁТ решения — только таких снимает отзыв (`[СОГ-07]`). */
  const awaiting = route.some((approver) => approver.status === "PENDING");
  const signed = route.some((approver) => approver.status === "APPROVED");
  // Статус документа словами по `[СОГ-01]` (Plane №446): «Черновик → На
  // согласовании → Согласовано (версия N от ДД.ММ ЧЧ:ММ) → Возвращено».
  const lastVersion = view.documentVersions[view.documentVersions.length - 1] ?? null;
  // 🔴 ИСТОЧНИК ПОДЗАГОЛОВКА — СТАТУС ДОКУМЕНТА, А НЕ СОСТАВ МАРШРУТА
  // (Plane №716). `sent` считался как «хоть одна строка не NOT_SENT», а
  // `_return_visit` сбрасывает в NOT_SENT только APPROVED и PENDING: строка
  // ВЕРНУВШЕГО намеренно остаётся RETURNED. Поэтому после «Вернуть» —
  // основного пути по `[СОГ-08]` — `sent` оставался истинным, ветка
  // «RETURNED && !sent» пропускалась, и подзаголовок читался «На
  // согласовании», тогда как ярлык версии в ТОЙ ЖЕ СТРОКЕ дописывал
  // «· документ v1 · возвращено». Две половины одного предложения
  // противоречили друг другу.
  //
  // `documentStatus` отвечает на этот вопрос прямо и приходит с сервера;
  // маршрут остаётся запасным путём для ОМ без объектов посещения, где
  // документа нет вовсе.
  const routeSubtitle = view.status === "RETURNED" && !sent
    ? "Возвращено"
    : sent
      ? "На согласовании"
      : "Черновик";
  const subtitle = view.stale
    ? "Согласование сброшено: расстановка изменена"
    : view.documentStatus === "APPROVED" || view.status === "APPROVED"
      ? approvedSubtitle(
          view.documentVersion ?? lastVersion?.number ?? null,
          lastVersion,
        )
      : view.documentStatus !== null
        ? DOCUMENT_STATUS_LABEL[view.documentStatus]
        : routeSubtitle;
  // Номер версии стоит РЯДОМ С КНОПКОЙ ОТПРАВКИ, потому что растит его именно
  // она: увидев «документ v2», человек знает, что следующая отправка сделает
  // третью. Отдельной плиткой в сводке версия отвечала бы на вопрос, которого
  // в сводке никто не задаёт.
  const versionLabel = documentVersionLabel(view.documentVersion, view.documentStatus);

  return (
    <section className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <p className="text-xs font-semibold">Маршрут согласования</p>
          <p
            className="text-[11px] text-muted-foreground"
            data-slot="approval-subtitle"
          >
            {subtitle}
            {versionLabel !== null && (
              /* `role="status"` с целой фразой, а не голым числом: смена
                 версии обязана прочитаться осмысленно, а не как «2». */
              <>
                {" · "}
                <span role="status">{versionLabel}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* «+ Добавить согласующего» и стрелок порядка на объекте НЕТ
              (`[СОГ-05]`, Plane №429): маршрут задаётся в настройках раздела,
              объект получает его копию. Ручки маршрута на сервере остались
              под админа и API. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            /* «Отозвать» имеет смысл, ПОКА ЕСТЬ ЧТО ОТЗЫВАТЬ (Plane №716):
               отзыв снимает строки PENDING, и без них вызов сервера ничего не
               делает. Прежнее условие `sent` держало кнопку включённой и
               после возврата — строка вернувшего остаётся RETURNED, — то есть
               предлагало действие, которое гарантированно ничего не изменит. */
            disabled={withdraw.isPending || !awaiting || signed || !rights.send}
            title={
              !rights.send
                ? RIGHT_REASON.send
                : !sent
                  ? "Расстановка ещё не отправлена."
                  : !awaiting
                    ? "Отзывать нечего: никто не ждёт решения."
                    : signed
                      ? "Отозвать можно, пока никто не подписал (`[СОГ-07]`)."
                      : undefined
            }
            onClick={() => withdraw.mutate({ visitObjectId })}
          >
            Отозвать с согласования
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={send.isPending || route.length === 0 || !rights.send}
            title={
              !rights.send
                ? RIGHT_REASON.send
                : route.length === 0
                  ? "Маршрут согласования пуст."
                  : undefined
            }
            onClick={() => send.mutate({ visitObjectId })}
          >
            {send.isPending ? "Отправка…" : "Отправить на согласование"}
          </Button>
        </div>
      </div>

      {adding && rights.manageRoute && false && (
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
            onClick={() =>
              add.mutate({ name, unit, position, visitObjectId })
            }
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
        <p className="px-3 py-3 text-xs text-muted-foreground" data-slot="approval-route-empty">
          Маршрут согласования не настроен — подписантов задаёт администратор в{" "}
          <Link href="/security-ops/settings" className="font-semibold text-primary-ink">
            «Администрировании»
          </Link>
          ; объект получит маршрут при отправке.
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
                      {/* Порядок — только число: стрелки сняты (`[СОГ-05]`,
                          Plane №429), маршрут задаётся в настройках. */}
                      <span className="tabular-nums">{index + 1}</span>
                    </td>
                    <td className="px-2 py-1.5 font-semibold">
                      {approver.name}
                      {(approver.username ?? "") !== "" && (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          учётка {approver.username}
                        </span>
                      )}
                      {approver.signature != null && (
                        /* Реквизиты подписи (`[СОГ-10]`): кто, кем, когда,
                           под какой версией — те же, что в подвале PDF. */
                        <span
                          className="block text-[11px] font-normal text-muted-foreground"
                          data-slot="approval-signature"
                        >
                          Согласовано {formatIsoDateTime(approver.signature.signedAt)} ·{" "}
                          {approver.signature.fullName}
                          {approver.signature.position !== "" && `, ${approver.signature.position}`}
                          {" · версия "}
                          {approver.signature.versionNumber} · {approver.signature.versionHash}
                        </span>
                      )}
                    </td>
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
                              disabled={decide.isPending || !rights.approve}
                              title={reasonUnless(rights.approve, "approve")}
                              onClick={() =>
                                decide.mutate({
                                  approverId: approver.id,
                                  decision: "APPROVED",
                                  comment: "",
                                  visitObjectId,
                                })
                              }
                            >
                              Согласовать
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!rights.returnBack}
                              title={reasonUnless(rights.returnBack, "returnBack")}
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
                      </span>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Модалка «Вернуть на доработку» (`[ВОЗ-01]`, Plane №431): общая
          причина (обязательна) + список замечаний с привязкой к посту и
          «Срочно» у каждого. До неё причина вводилась строкой в таблице, а
          замечание было одно. Автосрочность (`[ВОЗ-02]`) считает сервер по
          порогу из настроек — подпись под списком говорит об этом. */}
      <Dialog
        open={returnFor !== null}
        onOpenChange={(open) => {
          if (!open) closeReturnDialog();
        }}
      >
        <DialogContent className="max-w-2xl" data-slot="return-dialog">
          <DialogHeader>
            <DialogTitle>Вернуть на доработку</DialogTitle>
            <DialogDescription>
              Расстановка вернётся на этап 2, подписи снимутся, маршрут пройдётся заново.
              Замечания увидит старший объекта над деревом постов.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block text-[11px] font-semibold" htmlFor="return-reason">
              Общая причина *
              <Input
                id="return-reason"
                className="mt-0.5 h-8 text-xs"
                placeholder="Что необходимо исправить"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold">Замечания</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setReturnRemarks((prev) => [...prev, { text: "", postId: "", urgent: false }])
                  }
                >
                  + Замечание
                </Button>
              </div>
              {returnRemarks.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Без отдельных замечаний причина станет единственным замечанием.
                </p>
              )}
              <ul className="space-y-2" aria-label="Замечания возврата">
                {returnRemarks.map((remark, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                    <Input
                      className="h-8 min-w-[14rem] flex-1 text-xs"
                      aria-label={`Текст замечания ${index + 1}`}
                      placeholder="Текст замечания"
                      value={remark.text}
                      onChange={(e) =>
                        setReturnRemarks((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, text: e.target.value } : r))
                        )
                      }
                    />
                    <select
                      aria-label={`Пост замечания ${index + 1}`}
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      value={remark.postId}
                      onChange={(e) =>
                        setReturnRemarks((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, postId: e.target.value } : r))
                        )
                      }
                    >
                      <option value="">Общее</option>
                      {returnPosts.map((post) => (
                        <option key={post.id} value={post.id}>
                          {post.sector} · {post.post}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        aria-label={`Срочно ${index + 1}`}
                        checked={remark.urgent}
                        onChange={(e) =>
                          setReturnRemarks((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, urgent: e.target.checked } : r))
                          )
                        }
                      />
                      Срочно
                    </label>
                    <button
                      type="button"
                      className="rounded px-1 text-muted-foreground hover:bg-muted"
                      aria-label={`Убрать замечание ${index + 1}`}
                      onClick={() => setReturnRemarks((prev) => prev.filter((_, i) => i !== index))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                «Срочно» ставится само, если до даты мероприятия осталось не больше порога из
                «Администрирования» (Политика согласования); вручную — в любой момент.
              </p>
            </div>
            <FieldErrors errors={decideErrors} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeReturnDialog}>
              Отмена
            </Button>
            <Button
              type="button"
              // Пустую причину отбивает СЕРВЕР (400 с полем) — кнопка не
              // выключается: так проба и человек видят одну и ту же причину
              // отказа, а не молчаливую серую кнопку.
              disabled={decide.isPending || !rights.returnBack}
              title={reasonUnless(rights.returnBack, "returnBack")}
              onClick={() =>
                returnFor !== null &&
                decide.mutate({
                  approverId: returnFor,
                  decision: "RETURNED",
                  comment: reason,
                  remarks: returnRemarks
                    .filter((r) => r.text.trim() !== "")
                    .map((r) => ({ text: r.text.trim(), postId: r.postId === "" ? null : r.postId, urgent: r.urgent })),
                  visitObjectId,
                })
              }
            >
              {decide.isPending ? "Возвращаем…" : "Подтвердить возврат"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
function ApprovalRemarks({
  event,
  view,
  rights,
}: {
  event: SecurityEvent;
  view: ApprovalView;
  rights: ApprovalRights;
}) {
  // «Не согласен» требует ответа (`[ВОЗ-04]`) — поле раскрывается под
  // строкой, как причина возврата у согласующего, и только для одного
  // замечания за раз.
  const [respondFor, setRespondFor] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [respondErrors, setRespondErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const resolve = useResolveRemark(event.id, {
    onFormError: (details) => setRespondErrors(details),
    onEvent: () => {
      setRespondFor(null);
      setResponse("");
      setRespondErrors(null);
    },
  });
  const remarks = view.remarks;
  const open = remarks.filter((remark) => remark.status === "OPEN").length;
  const postById = new Map(event.reconSectorPosts.map((p) => [p.id, p]));
  // Блок «Замечания» — только если они есть (`[СОГ-06]`, Plane №446):
  // пустая лента «возвратов не было» занимала место, не сообщая ничего.
  if (remarks.length === 0) return null;
  const postLabel = (postId: string | null): string => {
    if (postId === null) return "общее";
    const post = postById.get(postId);
    return post ? `${post.sector} · ${post.post}` : `пост ${postId}`;
  };

  return (
    <section className="rounded-md border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-semibold">Замечания</p>
        <p className="text-[11px] text-muted-foreground">
          Формируются при возврате на доработку ·{" "}
          {remarks.length === 0
            ? "замечаний нет"
            : `${open} без ответа · ${remarks.length} всего`}
        </p>
      </div>
      {remarks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Замечаний нет — возвратов на доработку не было.
        </p>
      ) : (
        <ul className="divide-y">
          {remarks.map((remark) => (
            <li key={remark.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block">{remark.text}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {remark.author} · {formatIsoDateTime(remark.createdAt)} ·{" "}
                    {postLabel(remark.postId)} · документ v{remark.documentVersion}
                  </span>
                  {remark.response !== "" && (
                    <span className="mt-1 block text-xs">
                      <span className="text-muted-foreground">Ответ: </span>
                      {remark.response}
                    </span>
                  )}
                </span>
                {remark.urgent && (
                  <span className="inline-flex whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                    Срочно
                  </span>
                )}
                <span
                  className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${REMARK_STATUS_CLASS[remark.status]}`}
                >
                  {REMARK_STATUS_LABEL[remark.status]}
                </span>
                {remark.status === "OPEN" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resolve.isPending || !rights.answerRemarks}
                      title={reasonUnless(rights.answerRemarks, "answerRemarks")}
                      onClick={() =>
                        resolve.mutate({
                          remarkId: remark.id,
                          decision: "RESOLVED",
                          visitObjectId: view.visitObjectId,
                        })
                      }
                    >
                      Устранено
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!rights.answerRemarks}
                      title={reasonUnless(rights.answerRemarks, "answerRemarks")}
                      onClick={() =>
                        setRespondFor((prev) =>
                          prev === remark.id ? null : remark.id
                        )
                      }
                    >
                      Не согласен
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resolve.isPending || !rights.answerRemarks}
                    title={reasonUnless(rights.answerRemarks, "answerRemarks")}
                    onClick={() =>
                      resolve.mutate({
                        remarkId: remark.id,
                        decision: "OPEN",
                        visitObjectId: view.visitObjectId,
                      })
                    }
                  >
                    Вернуть в работу
                  </Button>
                )}
              </div>
              {respondFor === remark.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label
                    className="text-[11px] font-semibold"
                    htmlFor={`respond-${remark.id}`}
                  >
                    Почему не согласны *
                  </label>
                  <Input
                    id={`respond-${remark.id}`}
                    className="h-8 w-72 text-xs"
                    placeholder="Ответ согласующему"
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={resolve.isPending || !rights.answerRemarks}
                    title={reasonUnless(rights.answerRemarks, "answerRemarks")}
                    onClick={() =>
                      resolve.mutate({
                        remarkId: remark.id,
                        decision: "DISAGREED",
                        response,
                        visitObjectId: view.visitObjectId,
                      })
                    }
                  >
                    Подтвердить несогласие
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <FieldErrors errors={respondErrors} />
      <StageError error={resolve.error} />
    </section>
  );
}

/**
 * Печатный вид «Расчёт расстановки сил» (`[СОГ-02]`, Plane №430) — ровно то,
 * что уйдёт в PDF: шапка, секторы, посты с людьми, итог. До этого блок был
 * списком «ФИО — Сектор · Пост», и согласующий подписывал не то, что печатают.
 *
 * «Скачать PDF» — всегда (`[СОГ-03]`): до согласования сервер кладёт на
 * страницы водяной знак «Проект», после — чистый документ. Подпись у кнопки
 * говорит об этом заранее, чтобы «Проект» на бумаге не читался как сбой.
 *
 * Звание и вооружение в строке не печатаются: назначение их не несёт
 * (звания нет в составе, вооружение раздел не хранит) — печатать пустые
 * колонки значило бы обещать данные, которых нет.
 */
function PrintedPlacement({
  event,
  visit,
  posts,
  assignments,
  approved,
}: {
  event: SecurityEvent;
  visit: VisitObject | null;
  posts: SecurityEvent["reconSectorPosts"];
  assignments: SecurityEvent["placementAssignments"];
  approved: boolean;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const render = useRenderEventDocument((file) => {
    saveBinaryFile(file.fileName, file.contentBase64, file.contentType);
    setSaved(file.fileName);
  });
  const unitOf = new Map(
    event.forceRoster.map((member) => [member.employeeId, member.divisionName])
  );
  const byPost = new Map<string, SecurityEvent["placementAssignments"]>();
  for (const assignment of assignments) {
    byPost.set(assignment.postId, [...(byPost.get(assignment.postId) ?? []), assignment]);
  }
  const sectors = Array.from(new Set(posts.map((post) => post.sector)));
  const need = posts.reduce((sum, post) => sum + post.need, 0);
  const shortage = posts.reduce(
    (sum, post) => sum + Math.max(0, post.need - (byPost.get(post.id)?.length ?? 0)),
    0
  );
  const chief = visit === null ? event.chiefName : visit.chiefName;

  return (
    <section
      className="rounded-md border"
      aria-label="Расчёт расстановки сил"
      data-slot="printed-placement"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs font-semibold">Расчёт расстановки сил</p>
        <div className="flex flex-wrap items-center gap-2">
          {!approved && (
            <span className="text-[11px] text-muted-foreground">
              до согласования — с водяным знаком «Проект»
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={render.isPending}
            aria-busy={render.isPending}
            onClick={() => {
              setSaved(null);
              render.mutate({
                kind: "placement",
                eventCode: event.code,
                format: "pdf",
                visitObjectId: visit?.id,
              });
            }}
          >
            {render.isPending ? "Собираем…" : "Скачать PDF"}
          </Button>
        </div>
      </div>
      <div className="px-3 py-2 text-sm">
        <p className="text-[11px] font-bold uppercase tracking-[.08em]">
          Расчёт расстановки сил
        </p>
        <p className="text-xs text-muted-foreground">
          {event.code} «{event.title}»
          {visit !== null && ` · Объект «${visit.objectName}»`}
          {" · "}
          {formatIsoDate(visit?.visitDay ?? event.businessDate)}
          {" · Старший объекта: "}
          {chief === "" ? "не назначен" : chief}
        </p>
        {sectors.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Посты не рассчитаны.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {sectors.map((sector) => (
              <div key={sector}>
                <p className="text-xs font-semibold">Сектор «{sector}»</p>
                <ul className="mt-0.5 space-y-0.5">
                  {posts
                    .filter((post) => post.sector === sector)
                    .map((post) => {
                      const people = byPost.get(post.id) ?? [];
                      return (
                        <li key={post.id} className="pl-3 text-xs">
                          <span className="font-semibold">{post.post}</span>
                          {post.task !== "" && ` · ${post.task}`}
                          {(post.shift ?? "") !== "" && ` · ${post.shift}`}
                          {" · "}
                          {people.length === 0 ? (
                            <span className="text-amber-800">не назначено</span>
                          ) : (
                            people
                              .map((a) => {
                                const unit = unitOf.get(a.employeeId);
                                return unit ? `${a.employeeName}, ${unit}` : a.employeeName;
                              })
                              .join("; ")
                          )}
                          {post.requirements !== "" && (
                            <span className="text-muted-foreground"> · {post.requirements}</span>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs" data-slot="printed-placement-total">
          Итого: секторов {sectors.length} · постов {posts.length} · сотрудников{" "}
          {assignments.length} · потребность {need} · недобор {shortage}
        </p>
        {render.error !== null && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            Документ не собрался: {render.error.message}
          </p>
        )}
        {saved !== null && (
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            Сохранён файл «{saved}».
          </p>
        )}
      </div>
    </section>
  );
}
