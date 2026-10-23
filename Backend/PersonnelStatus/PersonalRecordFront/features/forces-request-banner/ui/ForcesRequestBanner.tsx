"use client";

/**
 * Баннер «Запрос на ОМ-…: выделено X из Y» на «Статусах сотрудников»
 * (Plane №394, `[СБС-30]`).
 *
 * Отдельной страницы у запроса нет — так в эталоне: начальник управления
 * приходит из уведомления («Выделите N сотрудников на ОМ-… (дата)»), и
 * экран, где он отмечает людей, обязан сказать, ЗАЧЕМ он здесь и сколько
 * ещё нужно. Без баннера уведомление привело бы на обычную таблицу, и
 * человек искал бы глазами, что от него хотят.
 *
 * Адрес запроса — `?forcesRequest=<allocationId>`: его кладёт ссылка
 * уведомления (`notifications-api.ts`).
 *
 * 🔴 БЕЗ ПАРАМЕТРА БАННЕР ТОЖЕ РАБОТАЕТ (Plane №487). Раньше здесь стояло
 * «нет параметра — нет баннера», и это оказалось дырой во всю цепочку:
 * статус «Участие в ОМ» вручную запрещён (№427, сервер отвечает 422 и шлёт
 * сюда), а сюда можно было попасть ТОЛЬКО по ссылке из уведомления. Человек,
 * открывший «Статусы сотрудников» из меню, не мог поставить статус ничем —
 * это и есть жалоба заказчика «с модуля не ставятся статус Участие на ОМ».
 * Уведомление к тому же доставляется не всегда (идемпотентность рассылки по
 * дню, получатели без фильтра прав — отдельные карточки), поэтому опираться
 * на него одно нельзя. Теперь баннер сам спрашивает «что просят у моего
 * управления».
 *
 * ЧТО ПОКАЗЫВАЕТ. Только СВОЮ строку управления: цифру раскладки
 * департамента и сколько уже проставлено «Участие в ОМ» (считает сервер по
 * статусам — `_with_directorate_progress`), плюс чекбоксы таблицы ниже →
 * «Участие в ОМ» (`[СБС-31]`, Plane №395).
 *
 * НЕСКОЛЬКО ЗАПРОСОВ — ВЫБОР ЧИПАМИ В ТОМ ЖЕ БАННЕРЕ, а не отдельный экран:
 * выделение всегда идёт в ОДИН запрос, и вопрос «в какой» — часть этого же
 * действия. Пока не выбран — активного нет и кнопки выделения нет: молча
 * подставить первый значило бы отправить людей не на то мероприятие. Когда
 * запрос ровно один, выбирать нечего, и он подставляется сам.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  useDirectorateForcesRequest,
  useDirectorateForcesRequests,
} from "@/hooks/use-forces-request-banner";
import { RequestCandidatePicker } from "./RequestCandidatePicker";
import { useOpsReadAccess } from "@/hooks/use-ops-protected-read";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { useParticipationCatalog } from "@/hooks/use-participation-catalog";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor } from "@/entities/portal-access";
import {
  ParticipationKindPicker,
  type ParticipationBranch,
} from "@/features/event-participation/ui/ParticipationKindPicker";

/** Подпись адресата списка (Plane №941): слово берётся у сервера — он один
 * знает, чья это область; экран видит только строки. Нет поля — «управлению»,
 * как было до №941. */
const ADDRESSEE_LABEL = {
  directorate: "Вашему управлению",
  department: "Вашему департаменту",
  organization: "Службе",
} as const;

export function ForcesRequestBanner({
  onSelected,
  compact = false,
}: {
  /** Keep the outstanding request visible while leaving the roster in focus. */
  compact?: boolean;
  /** После выделения — таблице пора перечитать статусы и снять отметки. */
  onSelected?: () => void;
}) {
  const searchParams = useSearchParams();
  const access = useOpsPermissions();
  const candidateAccess = useOpsReadAccess("status.manage");
  const linkedId = searchParams.get("forcesRequest");
  // Список нужен, только когда человек пришёл БЕЗ ссылки: по ссылке предмет
  // разговора уже назван, и лишний запрос за соседними заявками ничего к
  // нему не добавит.
  const mine = useDirectorateForcesRequests({ enabled: linkedId === null });
  const rows = mine.data?.results ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  // Физнаряд — отдельный резерв без ОМ; специальная группа сразу относится
  // к тому мероприятию, из которого пришёл запрос (Plane №977).
  const [kindCode, setKindCode] = useState("PHYSICAL_SQUAD");
  const [roleCode, setRoleCode] = useState("");
  const [participationBranch, setParticipationBranch] =
    useState<ParticipationBranch>("PHYSICAL");
  // Порядок значим: ссылка из уведомления сильнее выбора и списка — человек
  // пришёл по конкретному адресу. Дальше — его собственный выбор. И только
  // когда запрос ровно один, он подставляется сам.
  // Выбор живёт, ПОКА ЗАПРОС В СПИСКЕ (Plane №755). Запрос, снятый штабом
  // после того, как человек его выбрал, отвечает 404 — и без этой проверки
  // выбор остался бы намертво указывать на мёртвую заявку: перечитывание
  // списка ничего бы не меняло, потому что `picked` сильнее его. Забытый
  // выбор — не потеря: список стал другим, и подставится либо единственный
  // оставшийся, либо ни один (тогда баннер спросит заново).
  const pickedAlive =
    picked !== null && rows.some((row) => row.allocationId === picked)
      ? picked
      : null;
  const allocationId =
    linkedId ?? pickedAlive ?? (rows.length === 1 ? rows[0].allocationId : null);
  const request = useDirectorateForcesRequest(allocationId);
  const participationCatalog = useParticipationCatalog(allocationId !== null);
  // The keyed picker owns the draft and mutation report for this request.
  useEffect(() => {
    setKindCode("PHYSICAL_SQUAD");
    setRoleCode("");
    setParticipationBranch("PHYSICAL");
  }, [allocationId]);
  const selectedKind = (participationCatalog.data ?? []).find(
    (kind) => kind.code === kindCode
  );
  const participationIncomplete =
    participationBranch === "GROUP" &&
    (kindCode === "" ||
      ((selectedKind?.roles.length ?? 0) > 0 && roleCode === ""));

  // A disabled query remains pending. A reader following a request link
  // needs a reason, rather than a skeleton for a query that will never run.
  // Keep this guard after every hook to preserve hook order as rights load.
  if (access.isLoading) return null;
  if (access.error) {
    return linkedId === null ? null : (
      <p role="alert" className="rounded-lg border px-4 py-3 text-sm">
        Не удалось проверить доступ к запросу на сбор сил. Обновите страницу.
      </p>
    );
  }
  if (!access.hasPermission("status.manage")) {
    return linkedId === null ? null : (
      <section
        role="region"
        aria-label="Запрос на сбор сил недоступен"
        className="space-y-1 rounded-lg border px-4 py-3 text-sm"
      >
        <p>У вашей роли нет права выделять сотрудников по этому запросу.</p>
        <p className="text-muted-foreground">
          Статусы доступны для просмотра. По запросу обратитесь к начальнику
          управления или ответственному за статусы.
        </p>
      </section>
    );
  }

  // Пока список едет — НЕ рисуем скелет: на «Статусах сотрудников» запроса
  // чаще всего нет вовсе, и полоса-заглушка обещала бы содержимое, которого
  // не будет. По ссылке скелет ниже уместен: там содержимое обещано адресом.
  if (linkedId === null && (mine.isPending || rows.length === 0)) return null;

  // 🔴 ВЫБОР ЗАПРОСА (Plane №487). Показывается, только когда запросов
  // БОЛЬШЕ ОДНОГО: у одного выбирать нечего. Активный виден, а не угадывается
  // (правило «Active State»), и до выбора кнопки выделения нет вовсе.
  const chooser =
    linkedId === null && rows.length > 1 ? compact ? (
      <label className="grid max-w-xl gap-1 text-xs text-muted-foreground">
        <span>Запрос для подбора сотрудников · {rows.length}</span>
        <select
          aria-label="Запрос для подбора сотрудников"
          className="h-11 min-w-0 w-full rounded-md border bg-background px-3 text-sm text-foreground"
          value={allocationId ?? ""}
          onChange={(event) => setPicked(event.target.value || null)}
        >
          <option value="">Выберите запрос</option>
          {rows.map((row) => (
            <option key={row.allocationId} value={row.allocationId}>
              {row.code} · {formatIsoDate(row.businessDate)} · {row.directorates.reduce((sum, item) => sum + item.assigned, 0)} из {row.directorates.reduce((sum, item) => sum + item.need, 0)}
            </option>
          ))}
        </select>
      </label>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          Запрос, по которому отмечаете людей:
        </span>
        {rows.map((row) => {
          const active = row.allocationId === allocationId;
          const need = row.directorates.reduce((sum, item) => sum + item.need, 0);
          const assigned = row.directorates.reduce((sum, item) => sum + item.assigned, 0);
          return (
            <button
              key={row.allocationId}
              type="button"
              aria-pressed={active}
              onClick={() => setPicked(row.allocationId)}
              // ЗОНА НАЖАТИЯ 44 px (Plane №782, образец — №684). Было
              // `px-3 py-1`: около 24 px в высоту, вдвое меньше минимума.
              // Чип — это ВЫБОР МЕРОПРИЯТИЯ, на которое уедут люди, а
              // «Статусы сотрудников» открывают и с планшета: промах пальцем
              // по соседнему чипу отправляет выделение не на то ОМ. Высота
              // задана КОНТЕЙНЕРУ (`min-h-11` + `inline-flex items-center`),
              // шрифт остался `text-xs` — раздутый шрифт разнёс бы строку и
              // сделал чипы шире экрана.
              className={
                "inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted")
              }
            >
              {row.code} · {assigned} из {need}
            </button>
          );
        })}
      </div>
    ) : null;

  if (allocationId === null) {
    // Запросов несколько, ни один не выбран: баннер называет задачу и ждёт
    // выбора — но НЕ подставляет первый сам.
    return (
      <section
        role="status"
        aria-label="Запросы на сбор сил"
        data-slot="forces-request-chooser"
        className="border-primary/40 bg-primary/5 space-y-2 rounded-lg border px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Megaphone className="text-primary-ink h-4 w-4" aria-hidden="true" />
          <span className="font-semibold">
            {ADDRESSEE_LABEL[mine.data?.addressee ?? "directorate"]} адресованы
            запросы на сбор сил: {rows.length}
          </span>
        </div>
        {chooser}
      </section>
    );
  }
  if (request.isPending) {
    return (
      <div className="bg-muted h-14 w-full animate-pulse rounded-lg" aria-hidden />
    );
  }
  if (request.isError || request.data === undefined) {
    // Заявка чужая или снята — сказать словами, а не молча спрятать баннер:
    // человек вправе узнать, почему на этом месте ничего нет.
    //
    // 🔴 ПЕРЕКЛЮЧАТЕЛЬ ОСТАЁТСЯ ЗДЕСЬ (Plane №755). Раньше эта ветка рисовала
    // одну строку текста, и вместе с баннером с экрана уезжали чипы: у
    // начальника с несколькими запросами отказ ОДНОГО уносил возможность
    // вернуться к остальным — выйти из тупика можно было только
    // перезагрузкой страницы. Отказ — не повод отбирать органы управления, из
    // которых человек в него попал; правило «ошибка называет следующий шаг»
    // требует ровно обратного.
    //
    // ТЕКСТ РАЗЛИЧАЕТ ДВА ПУТИ. Пришёл по ссылке из уведомления — «по ссылке»
    // (эту формулировку читает и проба `department-requests`); выбрал чип сам
    // — «выбранный запрос», потому что никакой ссылки он не открывал и фраза
    // про неё отправила бы его искать несуществующее письмо.
    return (
      <section
        aria-label="Запрос на сбор сил не найден"
        data-slot="forces-request-missing"
        className="space-y-2 rounded-lg border px-4 py-3"
      >
        <p role="alert" className="text-muted-foreground text-sm">
          {linkedId === null
            ? "Выбранный запрос на сбор сил не найден — возможно, его сняли, пока страница была открыта."
            // Без слова сервера об адресате (`mine` здесь выключен): «другому
            // управлению» врало начальнику департамента (ревью №825 по №941).
            : "Запрос на сбор сил по ссылке не найден — возможно, он снят или адресован не вам."}
        </p>
        {chooser}
        {/* Запрос был ровно один — чипов нет, и без этой кнопки ветка стала бы
            тем же тупиком, из которого её вынимали: список запросов
            перечитывается здесь же, без перезагрузки страницы. По ссылке
            перечитывать нечего — там список не запрашивался вовсе. */}
        {linkedId === null && rows.length <= 1 ? (
          <Button
            type="button"
            variant="outline"
            // 44 px, как и всё остальное в баннере (Plane №782): `size="sm"`
            // даёт h-8. Единственный орган управления этой ветки — промах по
            // нему читается как «баннер не отвечает».
            className="h-11"
            disabled={mine.isFetching}
            onClick={() => void mine.refetch()}
          >
            {mine.isFetching ? "Обновляю…" : "Обновить список запросов"}
          </Button>
        ) : null}
      </section>
    );
  }

  const data = request.data;
  const selectedNeed = data.needByKind?.[kindCode] ?? (kindCode === "PHYSICAL_SQUAD" ? data.directorates.reduce((sum, row) => sum + row.need, 0) : 0);
  const selectedAssigned = data.assignedByKind?.[kindCode] ?? (data.assignedByKind ? 0 : kindCode === "PHYSICAL_SQUAD" ? data.directorates.reduce((sum, row) => sum + row.assigned, 0) : 0);
  const kindLabel = kindCode === "PHYSICAL_SQUAD" ? "Физический наряд" : selectedKind?.label || "Специальная группа";
  return (
    <section
      role="status"
      aria-label={`Запрос на ${data.code}`}
      data-slot="forces-request-banner"
      className="border-primary/40 bg-primary/5 space-y-2 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Megaphone className="text-primary-ink h-4 w-4" aria-hidden="true" />
        <span className="font-semibold">
          Запрос на {data.code} ({formatIsoDate(data.businessDate)}{data.businessDateEnd && data.businessDateEnd !== data.businessDate ? ` — ${formatIsoDate(data.businessDateEnd)}` : ""})
        </span>
        <span className="text-muted-foreground text-sm">
          {data.title} · от «{data.departmentName}»
          {data.dueAt ? ` · срок ${formatIsoDateTime(data.dueAt)}` : ""}
        </span>
      </div>
      <p className="text-sm" data-slot="request-selection-context">{data.location || "Объект назначит Штаб"} · {kindLabel} · нужно {selectedNeed} · выделено {selectedAssigned}</p>
      {moduleOpenFor("/security-ops/events", access.hasPermission) && <Link href={`/security-ops/events/${data.eventId}/`} className="text-sm text-primary-ink hover:underline">Карточка мероприятия →</Link>}
      {chooser}
      <RequestDetails
        compact={compact}
        linked={linkedId ?? pickedAlive}
        summary={`${kindLabel}: выделено ${selectedAssigned} из ${selectedNeed}`}
      >
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {data.directorates.map((row) => {
          return (
            <li key={row.divisionId} className="flex items-center gap-2">
              <span>{row.name}:</span>
              {/* `text-green-700` — тот же класс, что у `StatCard tone="success"`:
                  «своих» токенов вроде `text-success-ink` в системе нет, и
                  выдуманный класс молча отрисовался бы как ничто. */}
              <b className="tabular-nums">
                всего сотрудников: {row.assigned}
              </b>
              <span className="text-muted-foreground">· квота физического наряда: {row.need}</span>
            </li>
          );
        })}
      </ul>
      {(data.groupDemands ?? []).length > 0 && (
        <div className="rounded-md border border-primary/20 bg-background/70 p-2 text-sm">
          <p className="font-medium">Специальные группы по запросу</p>
          <ul className="mt-1 space-y-1">
            {(data.groupDemands ?? []).map((demand) => (
              <li key={demand.id}>
                {demand.specification || demand.kindCode} · {demand.need} · {demand.place}
                {[demand.requirements, demand.shift].filter(Boolean).length > 0
                  ? ` · ${[demand.requirements, demand.shift].filter(Boolean).join(" · ")}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid max-w-xl gap-1">
        <Label>Участие ОМ</Label>
        <ParticipationKindPicker
          id="forces-participation"
          branch={participationBranch}
          kindCode={kindCode}
          roleCode={roleCode}
          kinds={participationCatalog.data ?? []}
          onBranchChange={(branch) => {
            setParticipationBranch(branch);
            setKindCode(branch === "PHYSICAL" ? "PHYSICAL_SQUAD" : "");
            setRoleCode("");
          }}
          onKindChange={(value) => {
            setKindCode(value);
            setRoleCode("");
          }}
          onRoleChange={setRoleCode}
        />
        <p className="text-muted-foreground text-xs">
          {participationBranch === "PHYSICAL"
            ? "Физнаряд пока не получает статус участия: конкретное мероприятие, объект и даты назначит Штаб."
            : `Выбранная группа сразу получит статус участия в ${data.code}; объект назначит Штаб. Выбор чужой группы не расширяет список сотрудников.`}
        </p>
      </div>
      <RequestCandidatePicker key={JSON.stringify([allocationId, kindCode, roleCode, candidateAccess.scope, data.businessDate, data.businessDateEnd, data.location, data.status])}
        request={data} kindCode={kindCode} roleCode={roleCode} incomplete={participationIncomplete} onSelected={onSelected} />
      </RequestDetails>
    </section>
  );
}

function RequestDetails({ compact, linked, summary, children }: {
  compact: boolean;
  linked: string | null;
  summary: string;
  children: ReactNode;
}) {
  if (!compact) return <>{children}</>;
  return (
    <details key={linked ?? "menu"} open>
      <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-medium tabular-nums">{summary}</span>
        <span className="ml-3 text-primary-ink">Подбор сотрудников</span>
      </summary>
      <div className="space-y-3 pt-2">{children}</div>
    </details>
  );
}
