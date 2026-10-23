"use client";

/**
 * Карточка заявки департаменту (Plane №272, Ш-4).
 *
 * Текущая задача, сохранённый ответ, распределение по управлениям и состав.
 * Разделы раскрываются без размонтирования полей и потери черновиков.
 *
 * Начальники управлений выделяют сотрудников по запросу. Физический наряд
 * сначала попадает в общий резерв; финальное участие создаётся при
 * распределении Штабом. Специальные группы выделяются на конкретное ОМ.
 *
 * ПРАВКА КВОТ ЗАПЕРТА ПОСЛЕ ЗАПРОСА УПРАВЛЕНИЙ — правило сервера (Ш-1), и
 * экран его ПОВТОРЯЕТ, а не заменяет: поля выключаются и рядом стоит причина.
 * Выключить без объяснения значит оставить человека гадать, что он сделал не
 * так.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/load-failure";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  STAGE_LABEL,
  type ForceAllocationDirectorate,
  type ForceGroupOffer,
} from "@/entities/security-event";
import {
  useDepartmentRequest,
  useNotifyDepartmentDirectorates,
  useRespondDepartmentAllocation,
  useSplitDirectorateQuotas,
  useSubmitDepartmentAllocation,
  useWithdrawDepartmentAllocation,
} from "@/hooks/use-department-requests";
import { apiClient, type CoreDivision } from "@/lib/api";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { useParticipationCatalog } from "@/hooks/use-participation-catalog";

/**
 * Статусы, при которых разбивка по управлениям уже не правится: решение
 * перешло к штабу (Plane №554). Зеркало серверного `_QUOTAS_LOCKED_STATUSES`.
 *
 * ОТКАЗА (`DECLINED`) здесь НЕТ, и это главное в списке: «0» — ответ
 * департамента, а не действие штаба, и передумать после него можно, пока
 * управления не запрошены.
 */
const QUOTAS_LOCKED_STATUSES: string[] = ["SUBMITTED", "ACCEPTED", "RETURNED"];

/** Open the relevant section on entry, then keep the operator's choice even
 * when a mutation or background refresh changes the next recommended action.
 * Native details keep every child mounted, including unsaved form values. */
function RequestSection({
  name,
  title,
  summary,
  initiallyOpen = false,
  children,
}: {
  name: string;
  title: string;
  summary: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      data-slot={`department-${name}-section`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 rounded-xl border bg-card"
    >
      <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <span className="ml-1 font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{summary}</span>
      </summary>
      {children}
    </details>
  );
}

/**
 * Управления ДЕПАРТАМЕНТА заявки — из общего справочника оргструктуры, а не
 * из `allocation.directorates` (Plane №389).
 *
 * 🔴 ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ЗАПРОС, А НЕ `allocation.directorates` НАПРЯМУЮ.
 * `directorates[]` заводит ПЕРВОЕ действие цепочки (`split` или `notify`,
 * обе службы читают дерево оргструктуры сами) — до него список пуст. Таблица
 * ниже рендерилась ИЗ ЭТОГО ПОЛЯ и потому была пуста при первом визите
 * ВСЕГДА: ни строки, ни поля ввода, ни кнопки «Сохранить раскладку» — форма
 * штатного Ш-4 не могла создать первую раскладку сама, только править уже
 * существующую. `/api/core/divisions/` не требует `forces.*` вовсе (это
 * справочник оргструктуры, не звено цепочки), поэтому годится ответственному
 * за департамент, у которого `event.view` нет и не будет.
 */
function useDepartmentDirectorates(departmentId: string | undefined) {
  const divisions = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
    enabled: departmentId !== undefined,
  });
  const directorates = useMemo(() => {
    if (departmentId === undefined) return [];
    const parent = Number(departmentId);
    return (divisions.data ?? []).filter(
      (division) =>
        division.type_code === "directorate" &&
        division.parent === parent &&
        // 🔴 АРХИВНЫЕ УПРАВЛЕНИЯ СЮДА НЕ ПОПАДАЮТ (Plane №530). Сервер
        // (`split_directorate_quotas`) знает только `is_active=True` и
        // отбивает ВСЁ тело «Управление не найдено в департаменте» — то есть
        // одно архивное управление в департаменте делало сохранение
        // раскладки невозможным вообще, а пустое состояние карточки при этом
        // обещало «действующих управлений».
        division.is_active !== false
    );
  }, [divisions.data, departmentId]);
  // 🔴 ОТКАЗ СПРАВОЧНИКА — НЕ ФАКТ ОБ ОРГСТРУКТУРЕ (Plane №531). `isLoading`
  // деструктурировался и выбрасывался, а `isError` не возвращался вовсе:
  // пока справочник грузился или если он отказал, экран УТВЕРЖДАЛ, что у
  // департамента нет управлений, и молча прятал блок сохранения с кнопкой
  // рассылки. Человек читал поломку связи как решённый вопрос про структуру.
  return {
    directorates,
    isLoading: divisions.isPending,
    isError: divisions.isError,
    error: divisions.error,
    refetch: divisions.refetch,
  };
}

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
  // These later stages conclusively close the collection actions. Earlier
  // RECON may already collect against published demand; keep that server rule.
  const collectionClosed = ["APPROVAL", "ACKNOWLEDGEMENT", "CONDUCT", "CLOSED"].includes(detail?.stage ?? "");
  // 🔴 РАЗБИВКУ ЗАПИРАЕТ ФАКТ ЗАПРОСА УПРАВЛЕНИЙ, А НЕ «СТАТУС НЕ DRAFT»
  // (Plane №554). Прежнее условие ловило заодно ОТКАЗ: департамент, ответивший
  // «0» ещё до рассылки, получал погашенные поля квот, спрятанную кнопку
  // «Отправить в управления» и подпись «Управления уже запрошены» — хотя ни
  // одного управления не запрашивали. Чтобы вернуть себе форму, он должен был
  // сам догадаться отозвать свой отказ, а текст вёл его в другую сторону.
  //
  // Зеркалит сервер (`split_directorate_quotas`): момент оповещения плюс
  // статусы, где решение уже у штаба. Расхождение здесь означало бы, что экран
  // разрешает то, что ручка отобьёт, — или наоборот прячет разрешённое.
  const locked =
    allocation !== undefined &&
    (collectionClosed || allocation.notifiedAt !== null ||
      QUOTAS_LOCKED_STATUSES.includes(allocation.status));

  const split = useSplitDirectorateQuotas(detail?.eventId ?? "", allocationId);
  const notify = useNotifyDepartmentDirectorates(detail?.eventId ?? "", allocationId);
  const submit = useSubmitDepartmentAllocation(detail?.eventId ?? "", allocationId);
  const respond = useRespondDepartmentAllocation(detail?.eventId ?? "", allocationId);
  const participationCatalog = useParticipationCatalog();
  const withdraw = useWithdrawDepartmentAllocation(detail?.eventId ?? "", allocationId);
  const [submitOpen, setSubmitOpen] = useState(false);
  // Запрос управлений НЕОБРАТИМ (Plane №532): после него сервер запирает
  // квоты (`DIRECTORATE_QUOTAS_LOCKED`) навсегда — отзыв списка возвращает
  // заявку в `NOTIFIED`, а не в `DRAFT`. Такое действие спрашивают, а не
  // выполняют по одному щелчку.
  const [notifyOpen, setNotifyOpen] = useState(false);
  // Ответ «Выделяем: X · Комментарий» (Plane №391). Черновик наполняется ИЗ
  // ОТВЕТА сервера тем же доводом, что и квоты ниже: пустое поле над
  // сохранённой цифрой читалось бы как «ноль», а ноль здесь — отказ.
  const [answer, setAnswer] = useState<{ allocating: string; comment: string }>({
    allocating: "",
    comment: "",
  });
  const [groupOffers, setGroupOffers] = useState<ForceGroupOffer[]>([]);
  // 🔴 ЗАВИСИМОСТИ — ЗНАЧЕНИЯ СЕРВЕРА, А НЕ ОБЪЕКТ ЗАЯВКИ (Plane №555).
  //
  // Эффект стоял на `[allocation]`, то есть на ИДЕНТИЧНОСТИ объекта, а её
  // меняет ЛЮБОЙ рефетч: и `notify`, и `split` гасят ключ
  // `['ops-department-request', allocationId]` на успехе. Ответственный
  // набирал «Выделяем: 3» с пояснением, не нажимая «Сохранить ответ», жал
  // «Сохранить раскладку» — и набранное откатывалось к серверному молча, без
  // единого слова о том, куда оно делось.
  //
  // На значениях эффект молчит, пока сервер отвечает то же самое, и
  // срабатывает, когда цифра или комментарий ДЕЙСТВИТЕЛЬНО изменились —
  // после собственного «Сохранить ответ» в том числе. `allocationId` в
  // списке потому, что у СОСЕДНЕЙ заявки значения могут совпасть с
  // текущими: без него переход между заявками оставил бы чужой черновик.
  const serverAllocating =
    allocation === undefined || allocation.allocating === null || allocation.allocating === undefined
      ? ""
      : String(allocation.allocating);
  const serverComment = allocation?.answerComment ?? "";
  const serverGroupOffers = JSON.stringify(allocation?.groupOffers ?? []);
  const serverGroupState = JSON.stringify({
    demands: allocation?.groupDemands ?? [],
    offers: allocation?.groupOffers ?? [],
  });
  const groupOffersDirty = JSON.stringify(groupOffers) !== serverGroupOffers;
  useEffect(() => {
    if (allocation === undefined) return;
    setAnswer({ allocating: serverAllocating, comment: serverComment });
    const saved = allocation.groupOffers ?? [];
    const savedByDemand = new Map(
      saved.filter((row) => row.demandRowId).map((row) => [row.demandRowId, row])
    );
    setGroupOffers([
      ...(allocation.groupDemands ?? []).map(
        (demand): ForceGroupOffer =>
          savedByDemand.get(demand.id) ?? {
            demandRowId: demand.id,
            kindCode: demand.kindCode ?? "",
            count: 0,
            place: demand.place ?? demand.sector,
            specification: demand.specification ?? "",
            comment: "",
          }
      ),
      ...saved.filter((row) => row.demandRowId === null),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `allocation` в
    // списке и есть дефект: объект новый на каждом рефетче.
  }, [allocationId, serverAllocating, serverComment, serverGroupState]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [groupDraft, setGroupDraft] = useState<Record<string, string[]>>({});

  const {
    directorates: orgDirectorates,
    isLoading: orgLoading,
    isError: orgFailed,
    error: orgError,
    refetch: refetchOrg,
  } = useDepartmentDirectorates(allocation?.departmentId);
  /** Строки таблицы = дерево оргструктуры, дополненное тем, что уже известно
   *  заявке (квота, выделено, оповещено). Управление, выбывшее из дерева, но
   *  ещё живущее в заявке (см. `split_directorate_quotas`), не теряется —
   *  тем же правилом, что и на сервере: его след — факт. */
  const directorateRows = useMemo(() => {
    const known = new Map(allocation?.directorates.map((row) => [row.divisionId, row]) ?? []);
    const merged: ForceAllocationDirectorate[] = orgDirectorates.map((division) => {
      const id = String(division.id);
      const existing = known.get(id);
      known.delete(id);
      return (
        existing ?? {
          id: `force-directorate-${id}`,
          divisionId: id,
          name: division.name,
          need: 0,
          assigned: 0,
          notifiedAt: null,
        }
      );
    });
    return [...merged, ...known.values()];
  }, [orgDirectorates, allocation?.directorates]);

  // Черновик наполняется ИЗ СВОДНОГО СПИСКА, а не из одного `allocation.
  // directorates` (Plane №389, `[СБС-21]`/`[СБС-22]`): до первого действия
  // цепочки заявка не знает о СВОИХ управлениях ничего, и форма, читавшая
  // только `allocation.directorates`, была пуста при первом визите ВСЕГДА —
  // ни строки, ни поля, ни кнопки «Сохранить». Пустое поле над сохранённой
  // квотой читается как «ноль», и человек сохранил бы ноль, ничего не
  // набрав, — черновик поэтому не заводится пустым.
  // 🔴 ЗАВИСИМОСТЬ — ЗНАЧЕНИЯ СЕРВЕРА, А НЕ ИДЕНТИЧНОСТЬ СПИСКА (доводка №555
  // по ревью №825). Эффект стоял на `[directorateRows]`, то есть на ссылке, и
  // сбрасывал набранные квоты при ЛЮБОМ рефетче ключа — тот же дефект, что
  // чинила №555 у поля «Выделяем», в том же файле, двадцатью строками ниже.
  // Комментарий у `splitDirty` прямо описывает эту потерю как факт («набранное
  // молча исчезает»), а путь «Отправить в управления» залатан обходом
  // (`splitDirty` + «кнопка диалога сперва зовёт save()»). Путь «набрал квоты
  // → нажал „Сохранить ответ“» обхода не имел и держался ТОЛЬКО на
  // `structuralSharing` TanStack: `respond` меняет `allocating`, а ссылка на
  // `directorates` уцелевает. Основание ненадёжное — сама №555 объявила его
  // таким: стоит соседнему оператору изменить `assigned` в любой строке, и
  // ссылка обновится.
  //
  // Подпись собирается по СТРОКАМ, а не по сумме: две правки, гасящие друг
  // друга (+2 одному, −2 другому), дают ту же сумму — ровно тот довод, что
  // стоит у `splitDirty`.
  const serverSplit = directorateRows
    .map((row) => `${row.divisionId}:${row.need ?? 0}`)
    .join("|");
  // Группы меняются независимо от числовых квот. Их собственная подпись
  // обновляет выбор с сервера, не стирая набранные квоты (и наоборот).
  const serverGroupSplit = JSON.stringify(
    directorateRows.map((row) => [row.divisionId, row.groupDemandIds ?? []])
  );
  useEffect(() => {
    setDraft(
      Object.fromEntries(directorateRows.map((row) => [row.divisionId, String(row.need ?? 0)]))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocationId, serverSplit]);
  useEffect(() => {
    setGroupDraft(
      Object.fromEntries(
        directorateRows.map((row) => [row.divisionId, row.groupDemandIds ?? []])
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocationId, serverGroupSplit]);

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
        <LoadFailure what="заявку на силы" description={request.error?.message} onRetry={() => void request.refetch()} isRetrying={request.isFetching} />
      </div>
    );
  }

  const quota = allocation.need;
  const groupAnswerLocked =
    collectionClosed || allocation.status === "SUBMITTED" || allocation.status === "ACCEPTED" || respond.isPending;
  const eventStageLabel = detail.stage && Object.prototype.hasOwnProperty.call(STAGE_LABEL, detail.stage)
    ? STAGE_LABEL[detail.stage]
    : undefined;
  // ПРЕДЕЛ РАСКЛАДКИ — ОТ «ВЫДЕЛЯЕМ» (`[СБС-22]`, Plane №392): раскладывать
  // между управлениями департамент обязан СВОЮ цифру, а не запрос штаба.
  // Пока ответа нет — запрос штаба, как и раньше.
  const splitCap =
    allocation.allocating === null || allocation.allocating === undefined
      ? quota
      : allocation.allocating;
  const splitTotal = allocation.directorates.reduce(
    (sum, row) => sum + (row.need ?? 0),
    0
  );
  const assigned = allocation.members.length;
  // Своя цифра департамента (`[СБС-21]`/`[СБС-23]`): против неё считается
  // подтверждение отправки. Ответа нет — запрос штаба.
  const ownFigure = splitCap;
  const hasAnswer = allocation.allocating !== null && allocation.allocating !== undefined;
  const sent = allocation.status === "SUBMITTED" || allocation.status === "ACCEPTED";
  const answerDirty = answer.allocating !== serverAllocating || answer.comment !== serverComment || groupOffersDirty;
  const hasSpecialGroups = (allocation.groupDemands ?? []).length > 0 || groupOffers.length > 0;
  // A zero physical answer is DECLINED even when positive group offers were
  // saved. Only server offers establish that fact; the editable draft does not.
  const declinedWithGroups = allocation.status === "DECLINED" &&
    (allocation.groupOffers ?? []).some((offer) => offer.count > 0);
  const canSubmit = !collectionClosed && (allocation.status === "NOTIFIED" || allocation.status === "RETURNED");
  // Guidance is not a new workflow gate: splitting before an answer, sending a
  // partial list and withdrawing after collection closes keep their own guards.
  const next = (() => {
    if (collectionClosed) return {
      actor: "Штаб", title: "Сбор сил на этом этапе завершён", section: null,
      description: allocation.status === "SUBMITTED"
        ? "Список у Штаба. Ответ, раскладка и отправка списка на этом этапе недоступны; сохранённые сведения можно раскрыть ниже."
        : "Ответ, раскладка и отправка списка на этом этапе недоступны. Сохранённые сведения можно раскрыть ниже.",
    };
    if (allocation.status === "SUBMITTED") return {
      actor: "Штаб", title: "Список у Штаба", section: "send",
      description: "Ожидаем решения Штаба. Если список нужно изменить, сначала отзовите его в разделе передачи списка.",
    };
    if (allocation.status === "ACCEPTED") return {
      actor: "Штаб", title: "Список принят Штабом", section: null,
      description: "Дополнительных действий департамента по этому списку сейчас нет. Ответ, раскладка и состав доступны ниже.",
    };
    if (declinedWithGroups) {
      if (allocation.notifiedAt !== null) return {
        actor: assigned > 0 ? "Ответственный департамента" : "Начальники управлений",
        title: assigned > 0 ? "Проверьте состав специальных групп" : "Ожидаем сотрудников специальных групп",
        section: "members",
        description: "Специальные группы сохранены, управления оповещены. По физическому наряду сохранено «Выделяем: 0». Сотрудники появляются в составе по мере выделения управлениями.",
      };
      const hasGroupDemands = (allocation.groupDemands ?? []).length > 0;
      return {
        actor: "Ответственный департамента",
        title: hasGroupDemands ? "Распределите специальные группы" : "Проверьте сохранённые специальные группы",
        section: hasGroupDemands ? "split" : "answer",
        description: hasGroupDemands
          ? "Специальные группы сохранены. По физическому наряду — 0. Проверьте распределение запрошенных групп по управлениям и отправьте им заявку."
          : "Специальные группы сохранены. По физическому наряду — 0. Состав, место и комментарии групп доступны в ответе департамента.",
      };
    }
    if (allocation.status === "DECLINED") return {
      actor: "Ответственный департамента", title: "Сохранён отказ департамента", section: "answer",
      description: "В ответе сохранено «Выделяем: 0». Если решение изменилось, исправьте количество и сохраните ответ. Специальные группы доступны в том же разделе.",
    };
    if (allocation.status === "RETURNED") return {
      actor: "Ответственный департамента", title: "Проверьте возвращённый список", section: assigned > 0 ? "send" : "members",
      description: assigned > 0
        ? "Учтите замечание Штаба, проверьте состав и отправьте список повторно. Недобор не запрещает отправку."
        : "Учтите замечание Штаба и уточните состав у начальников управлений. Для повторной отправки нужен хотя бы один сотрудник.",
    };
    if (allocation.notifiedAt !== null || allocation.status === "NOTIFIED") return assigned > 0 ? {
      actor: "Ответственный департамента", title: "Проверьте и отправьте список Штабу", section: "send",
      description: `В списке ${assigned} сотрудников. Его можно отправить с недобором; окончательное решение примет Штаб.`,
    } : {
      actor: "Начальники управлений", title: "Ожидаем сотрудников от управлений", section: "members",
      description: "Управления получили запрос. Выделенные сотрудники появятся в составе автоматически; пустой список отправить нельзя.",
    };
    if (!hasAnswer) return {
      actor: "Ответственный департамента", title: hasSpecialGroups && quota === 0 ? "Подготовьте ответ по специальным группам" : "Подготовьте ответ департамента", section: "answer",
      description: hasSpecialGroups && quota === 0
        ? "Физический наряд не запрошен. Проверьте специальные группы в ответе; их распределение по управлениям доступно отдельным разделом."
        : `Штаб запросил ${quota} сотрудников. Укажите, сколько выделяет департамент, и при необходимости добавьте комментарий.`,
    };
    return {
      actor: "Ответственный департамента", title: "Проверьте распределение по управлениям", section: "split",
      description: orgFailed
        ? "Справочник подразделений не ответил. Повторите загрузку в разделе распределения — сохранённый ответ и черновики остаются на месте."
        : "Разложите людей и специальные группы по управлениям. Перед отправкой проверьте адресатов: после оповещения раскладка закрепляется.",
    };
  })();
  // Группы списка по управлениям (`[СБС-23]`): порядок — как в таблице
  // управлений; люди вне управлений заявки — последней группой, названной
  // словами, а не молча выброшенной.
  const memberGroups = (() => {
    const map = detail.memberDirectorateById ?? {};
    const groups = directorateRows.map((row) => ({
      divisionId: row.divisionId as string | null,
      name: row.name,
      need: row.need ?? 0,
      members: allocation.members.filter((m) => map[m.employeeId] === row.divisionId),
    }));
    const placed = new Set(groups.flatMap((g) => g.members.map((m) => m.employeeId)));
    const rest = allocation.members.filter((m) => !placed.has(m.employeeId));
    if (rest.length > 0) {
      groups.push({ divisionId: null, name: "Вне управлений заявки", need: 0, members: rest });
    }
    return groups.filter((g) => g.members.length > 0);
  })();
  const draftTotal = Object.values(draft).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );
  // Набрано, но не сохранено (Plane №532). Оповещение перерисовывает карточку
  // ответом сервера, и `useEffect` выше сбрасывает черновик на сохранённые
  // цифры — набранное молча исчезает. Разница считается по СТРОКАМ таблицы,
  // а не по сумме: две правки, гасящие друг друга (+2 одному, −2 другому),
  // дают ту же сумму и тоже пропадут.
  // Строки, которые ПРАВЯТСЯ: только действующие управления дерева. Выбывшие
  // остаются в таблице (их след — факт), но без поля ввода и мимо запроса.
  const orgIds = new Set(orgDirectorates.map((division) => String(division.id)));
  const editableRows = directorateRows.filter((row) => orgIds.has(row.divisionId));
  const splitDirty = directorateRows.some(
    (row) => (Number(draft[row.divisionId]) || 0) !== (row.need ?? 0)
  ) || directorateRows.some(
    (row) =>
      JSON.stringify(groupDraft[row.divisionId] ?? []) !==
      JSON.stringify(row.groupDemandIds ?? [])
  );

  // 🔴 ЧТО ИМЕННО УЕДЕТ ПРИ НАЖАТИИ «ОТПРАВИТЬ В УПРАВЛЕНИЯ» (Plane №808,
  // уточнено ревью). Отправляется НАБРАННОЕ, когда оно расходится с
  // сохранённым: кнопка диалога сперва зовёт `save()` и только потом `notify`.
  const effectiveNeed = (row: ForceAllocationDirectorate) =>
    splitDirty ? Number(draft[row.divisionId]) || 0 : row.need ?? 0;
  const effectiveGroupDemandIds = (row: ForceAllocationDirectorate) =>
    splitDirty ? groupDraft[row.divisionId] ?? [] : row.groupDemandIds ?? [];
  const effectiveTotal = splitDirty ? draftTotal : splitTotal;
  // 🔴 «МОЛЧАЩИЕ» СЧИТАЮТСЯ ПО СТРОКАМ, А НЕ ПО СУММЕ. Сумма на этот вопрос не
  // отвечает, и ошибалась она в обе стороны: потолок 3, всё отдано одному
  // управлению из трёх — сумма равна потолку, предупреждения нет, а двум
  // начальникам письма не уйдут и дописать их после нажатия нельзя (самый
  // частый случай); и наоборот, потолок 5 при двух управлениях по 2 — сумма
  // меньше потолка, а молчащих управлений нет вовсе.
  // Уведомление с нулём не шлётся (`forces_notify.notify_directorate_heads`
  // складывает такие строки в `without_quota`), поэтому «ноль в строке» и
  // означает «этому начальнику не придёт ничего».
  const silentRows = directorateRows.filter(
    (row) => effectiveNeed(row) <= 0 && effectiveGroupDemandIds(row).length === 0
  );
  const nothingWillBeSent =
    directorateRows.length > 0 && silentRows.length === directorateRows.length;
  const someWillBeSilent =
    silentRows.length > 0 && silentRows.length < directorateRows.length;

  async function save() {
    if (collectionClosed) return;
    await split.mutateAsync({
      // 🔴 УЕЗЖАЮТ ТОЛЬКО СТРОКИ ДЕРЕВА (Plane №530). Таблица показывает и
      // управления, ВЫБЫВШИЕ из оргструктуры, но ещё живущие в заявке — их
      // след это факт, и стирать его нельзя (сервер их тоже сохраняет). Но
      // отправлять их в запрос нельзя тем более: сервер сверяет каждую строку
      // с действующими управлениями департамента и отбивает ВСЁ тело целиком.
      // Раскладка не сохранялась вовсе, а убрать выбывшую строку из формы
      // человеку было нечем.
      rows: editableRows.map((row) => ({
        divisionId: row.divisionId,
        need: Number(draft[row.divisionId]) || 0,
        groupDemandIds: groupDraft[row.divisionId] ?? [],
      })),
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Назад к заявкам
        </Button>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Входящий запрос Штаба</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {detail.code}
          </Badge>
          <Badge variant="outline">{allocation.departmentName}</Badge>
          <Badge variant="outline">{allocation.status === "ACCEPTED" ? "Принято Штабом" : allocation.status === "SUBMITTED" ? "Отправлено в Штаб" : allocation.status === "DECLINED" ? declinedWithGroups ? "Отказ по физическому наряду" : "Отказ" : allocation.status === "RETURNED" ? "Возвращено Штабом" : allocation.notifiedAt !== null ? collectionClosed || !eventStageLabel ? "Управления оповещены" : "Собираем людей" : collectionClosed || !eventStageLabel ? "Ответ департамента" : "Ответ формируется"}</Badge>
        </div>
        <h2 className="text-xl font-semibold">{detail.title}</h2>
        <p className="text-muted-foreground text-sm">
          {formatIsoDate(detail.businessDate)} · {detail.location}
          {detail.eventTime !== null ? ` · ${detail.eventTime}` : ""}
        </p>
        <p role="status" className="text-sm text-muted-foreground">
          Запрошено {quota} · выделяем {allocation.allocating ?? "ответ ещё не сохранён"} · собрано {assigned}
        </p>
        <p role="status" className="text-sm text-muted-foreground">
          {eventStageLabel ? `Этап мероприятия: ${eventStageLabel}` : "Этап мероприятия не определён"}
          {collectionClosed && ". Ответ, распределение по управлениям, их оповещение и отправка списка на этом этапе недоступны."}
        </p>
        <p className={`text-sm ${allocation.overdue || allocation.submittedLate ? "text-destructive-ink" : "text-muted-foreground"}`}>
          {allocation.dueAt ? `Срок сдачи: ${formatIsoDateTime(allocation.dueAt)}` : "Срок сдачи не назначен"}
          {allocation.overdue ? " · Срок истёк" : allocation.submittedLate ? " · Отправлено после срока" : ""}
        </p>
      </div>

      <section aria-labelledby="request-next-heading" data-slot="department-next-action" className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
        <p className="text-xs font-semibold text-muted-foreground">{next.actor}</p>
        <h3 id="request-next-heading" className="text-lg font-semibold">{next.title}</h3>
        <p className="text-sm">{next.description}</p>
        {allocation.status === "RETURNED" && allocation.decisionComment !== "" && (
          <p role="alert" className="text-sm text-destructive-ink">Возвращено Штабом: {allocation.decisionComment}</p>
        )}
      </section>

      {/* ШАПКА-ОТВЕТ (`[СБС-21]`, Plane №391): «Запрошено штабом: N ·
          Выделяем: [ввод] · Комментарий: [ввод]». Цифру ставит только
          ответственный, штаб читает. Ограничений нет — меньше, больше, 0;
          «0» закрывает запрос статусом «Отказ». Правится до отправки
          списка. Комментарий необязателен: при цифре меньше запрошенной —
          подсказка «желательно пояснить», без блокировки. */}
      <RequestSection
        key={`answer-${allocationId}`}
        name="answer"
        title="Ответ департамента"
        summary={`${hasAnswer ? `Выделяем ${allocation.allocating} · физический наряд` : "Ответ количеством ещё не сохранён"}${hasSpecialGroups ? " · есть специальные группы" : ""}${answerDirty ? " · есть несохранённые изменения" : ""}`}
        initiallyOpen={next.section === "answer"}
      >
      <section
        aria-labelledby="answer-heading"
        className="space-y-3 border-t p-4 sm:p-5"
        data-slot="department-answer"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="answer-heading" className="font-semibold">
            Физический наряд
          </h3>
        </div>
        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {collectionClosed ? "Изменения на этом этапе недоступны." : "Укажите физический наряд и специальные группы ниже, затем сохраните ответ. Можно выделить меньше, больше или 0; группы считаются отдельно."}
        </p>
        {(() => {
          const answerLocked =
            collectionClosed || allocation.status === "SUBMITTED" || allocation.status === "ACCEPTED";
          const parsed = Number(answer.allocating);
          const invalidCount = answer.allocating !== "" && (!Number.isSafeInteger(parsed) || parsed < 0);
          const short = Number.isFinite(parsed) && parsed > 0 && parsed < quota;
          const dirty = answerDirty;
          return (
            <>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="answer-allocating">Выделяем</Label>
                  <Input
                    id="answer-allocating"
                    type="number"
                    min={0}
                    step={1}
                    aria-invalid={invalidCount}
                    aria-describedby={invalidCount ? "answer-allocating-error" : undefined}
                    inputMode="numeric"
                    className="tabular-nums"
                    disabled={answerLocked || respond.isPending}
                    value={answer.allocating}
                    onChange={(event) =>
                      setAnswer((prev) => ({ ...prev, allocating: event.target.value }))
                    }
                  />
                  {invalidCount && <p id="answer-allocating-error" role="alert" className="text-sm text-destructive-ink">Укажите целое неотрицательное число сотрудников.</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="answer-comment">Комментарий</Label>
                  <Input
                    id="answer-comment"
                    disabled={answerLocked || respond.isPending}
                    value={answer.comment}
                    placeholder={short ? "Желательно пояснить, почему меньше" : "Необязательно"}
                    onChange={(event) =>
                      setAnswer((prev) => ({ ...prev, comment: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant={hasAnswer ? "outline" : "default"}
                  aria-busy={respond.isPending}
                  disabled={answerLocked || respond.isPending || answer.allocating === "" || invalidCount || !dirty}
                  onClick={() => {
                    if (answerLocked || respond.isPending || answer.allocating === "" || invalidCount || !dirty) return;
                    respond.mutate({
                      allocating: parsed,
                      comment: answer.comment,
                      groupOffers,
                    });
                  }}
                >
                  {respond.isPending ? "Сохраняю…" : "Сохранить ответ"}
                </Button>
                {answerLocked ? (
                  <p className="text-muted-foreground text-sm">
                    {collectionClosed ? "Изменение ответа на этом этапе недоступно" : "Список уже у штаба — цифра правится до отправки"}
                  </p>
                ) : short && answer.comment.trim() === "" ? (
                  // Подсветка без блокировки — ровно как в спецификации.
                  <p className="text-sm text-amber-700">
                    Меньше запрошенного на {quota - parsed} — желательно пояснить
                  </p>
                ) : parsed === 0 && answer.allocating !== "" ? (
                  <p className="text-muted-foreground text-sm">
                    «0» закроет запрос отказом
                  </p>
                ) : null}
              </div>
              {respond.isError && (
                <p role="alert" className="text-destructive-ink text-sm">
                  {respond.error?.message ?? "Ответ не сохранился"}
                </p>
              )}
              {respond.isSuccess && !dirty && !answerLocked && (
                <p role="status" className="text-muted-foreground text-sm">
                  Ответ сохранён. Проверьте распределение по управлениям ниже.
                </p>
              )}
            </>
          );
        })()}
      </section>

      <section
        role="region"
        aria-label="Специальные группы"
        className="space-y-3 border-t p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Специальные группы</h3>
            <p className="text-muted-foreground text-sm">
              Сохраняются вместе с количеством и комментарием кнопкой «Сохранить ответ» выше.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={groupAnswerLocked}
            onClick={() => {
              const kind = (participationCatalog.data ?? []).find(
                (item) => item.code !== "PHYSICAL_SQUAD"
              );
              setGroupOffers((current) => [
                ...current,
                {
                  demandRowId: null,
                  kindCode: kind?.code ?? "SCREENING_GROUP",
                  count: 1,
                  place: "",
                  specification: "",
                  comment: "",
                },
              ]);
            }}
          >
            <Plus className="mr-1 size-4" aria-hidden="true" />
            Своя группа
          </Button>
        </div>
        {(allocation.groupDemands ?? []).length === 0 && groupOffers.length === 0 ? (
          <p className="text-muted-foreground text-sm">Специальные группы не запрошены.</p>
        ) : (
          <div className="space-y-3">
            {groupOffers.map((offer, index) => {
              const demand = (allocation.groupDemands ?? []).find(
                (row) => row.id === offer.demandRowId
              );
              const kindLabel =
                (participationCatalog.data ?? []).find(
                  (item) => item.code === offer.kindCode
                )?.label ?? offer.kindCode;
              const patchOffer = (next: Partial<ForceGroupOffer>) =>
                setGroupOffers((current) =>
                  current.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, ...next } : row
                  )
                );
              return (
                <div key={`${offer.demandRowId ?? "own"}-${index}`} className="rounded-md bg-muted/30 p-3">
                  <p className="mb-2 text-sm font-medium">
                    {kindLabel} · {demand?.need ?? offer.count} · {demand?.place ?? offer.place}
                  </p>
                  {demand && (
                    <p className="text-muted-foreground mb-2 text-xs">
                      {[demand.specification, demand.requirements, demand.shift]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                    <select
                      aria-label={`Вид группы, строка ${index + 1}`}
                      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                      disabled={groupAnswerLocked || Boolean(demand)}
                      value={offer.kindCode}
                      onChange={(event) => patchOffer({ kindCode: event.target.value })}
                    >
                      {(participationCatalog.data ?? [])
                        .filter((item) => item.code !== "PHYSICAL_SQUAD")
                        .map((item) => (
                          <option key={item.code} value={item.code}>{item.label}</option>
                        ))}
                    </select>
                    <Input
                      type="number"
                      min={0}
                      disabled={groupAnswerLocked}
                      aria-label={`Количество групп, строка ${index + 1}`}
                      value={offer.count}
                      onChange={(event) => patchOffer({ count: Number(event.target.value) || 0 })}
                    />
                    <Input
                      aria-label={`Место группы, строка ${index + 1}`}
                      disabled={groupAnswerLocked}
                      placeholder="Место"
                      value={offer.place}
                      onChange={(event) => patchOffer({ place: event.target.value })}
                    />
                    <Input
                      aria-label={`Спецификация группы, строка ${index + 1}`}
                      disabled={groupAnswerLocked}
                      placeholder="Состав / квалификация"
                      value={offer.specification}
                      onChange={(event) => patchOffer({ specification: event.target.value })}
                    />
                    <div className="flex gap-1">
                      <Input
                        aria-label={`Комментарий группы, строка ${index + 1}`}
                        disabled={groupAnswerLocked}
                        placeholder="Комментарий"
                        value={offer.comment}
                        onChange={(event) => patchOffer({ comment: event.target.value })}
                      />
                      {offer.demandRowId === null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Удалить свою группу, строка ${index + 1}`}
                          disabled={groupAnswerLocked}
                          onClick={() =>
                            setGroupOffers((current) =>
                              current.filter((_row, rowIndex) => rowIndex !== index)
                            )
                          }
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </RequestSection>

      <RequestSection
        key={`split-${allocationId}`}
        name="split"
        title="Распределение по управлениям"
        summary={`Разложено ${splitTotal} из ${ownFigure}${locked ? " · раскладка закреплена" : splitDirty ? " · есть несохранённые изменения" : ""}`}
        initiallyOpen={next.section === "split"}
      >
      <section aria-labelledby="split-heading" className="min-w-0 space-y-3 border-t p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="split-heading" className="font-semibold">
              Распределение по управлениям
            </h3>
            <p className="text-muted-foreground text-sm">
              {collectionClosed
                ? "Изменения на этом этапе недоступны."
                : locked
                ? allocation.notifiedAt !== null
                  ? "Управления уже запрошены — цифры правятся до запроса"
                  : "После передачи списка Штабу раскладка по управлениям закреплена"
                : allocation.allocating === null || allocation.allocating === undefined
                  ? "Разложите запрос по управлениям и отправьте им — начальники получат уведомление"
                  : `Разложите «Выделяем: ${allocation.allocating}» по управлениям и отправьте им`}
            </p>
            <p className={`mt-1 text-sm font-medium tabular-nums ${splitTotal > ownFigure ? "text-destructive-ink" : ""}`}>
              Разложено {splitTotal} из {ownFigure}{splitTotal > ownFigure ? ` · перебор ${splitTotal - ownFigure}` : ""}
            </p>
          </div>
          {/* 🔴 КНОПКА, КОТОРОЙ НЕ БЫЛО (Plane №389, `[СБС-22]`). До правки
              оповестить свои управления мог только штаб — из панели
              мероприятия, куда у ответственного за департамент нет доступа
              (`event.view` не выдаётся этой роли намеренно). Ручка на
              сервере оповещение по СВОЕМУ департаменту всегда разрешала —
              кнопки не было НА ЭТОМ экране.
              Условие НЕ читает `allocation.directorates`: `notify_directorates`
              сама заводит строки управлений из дерева оргструктуры при первом
              вызове (см. `useDepartmentDirectorates` выше) — требовать
              непустой список означало бы просить департамент раскладывать
              несуществующие строки, чтобы получить кнопку их создать. */}
          {directorateRows.length > 0 && !locked && (
            <Button
              type="button"
              variant={hasAnswer ? "default" : "outline"}
              size="sm"
              disabled={notify.isPending || split.isPending}
              onClick={() => setNotifyOpen(true)}
            >
              {notify.isPending ? "Отправляю…" : "Отправить в управления"}
            </Button>
          )}
        </div>
        {notify.isError && (
          <p role="alert" className="text-destructive-ink text-sm">
            {notify.error?.message ?? "Управления не оповещены"}
          </p>
        )}

        {directorateRows.length === 0 ? (
          orgLoading ? (
            <div className="bg-muted h-5 w-full max-w-64 animate-pulse rounded" aria-label="Управления департамента загружаются" />
          ) : orgFailed ? (
            <p role="alert" className="text-destructive-ink text-sm">
              Справочник подразделений не ответил — список управлений департамента неизвестен.
              {orgError?.message ? ` ${orgError.message}` : ""}{" "}
              <Button type="button" variant="link" size="sm" className="h-auto p-0 align-baseline" onClick={() => void refetchOrg()}>
                Повторить
              </Button>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              У департамента «{allocation.departmentName}» нет действующих управлений — раскладывать некуда.
            </p>
          )
        ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Колонки `[СБС-22]`: «Управление | В строю |
                    Запрошено | Выделено | Статус». «В
                    строю» считает СЕРВЕР на деловую дату ОМ
                    (`inServiceByDirectorate`, Plane №944) тем же правилом,
                    что и разрез сбора на экране: без статуса или со статусом
                    колонки «В строю» расхода, кроме участия в ОМ. */}
                <TableHead>Управление</TableHead>
                <TableHead className="text-right">В строю</TableHead>
                <TableHead className="w-32">Запрошено</TableHead>
                <TableHead>Спецгруппы</TableHead>
                <TableHead>Выделено</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {directorateRows.map((row: ForceAllocationDirectorate) => (
                <TableRow key={row.divisionId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums" data-slot="directorate-in-service">
                    {detail.inServiceByDirectorate?.[row.divisionId] ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {orgIds.has(row.divisionId) ? (
                      <>
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
                      </>
                    ) : (
                      // Управление выбыло из оргструктуры: квота остаётся
                      // видимой как факт, но править её нечем — сервер такую
                      // строку не примет и отобьёт вместе с ней всю раскладку
                      // (Plane №530).
                      <span className="text-muted-foreground tabular-nums text-sm">
                        {row.need ?? 0} · не в оргструктуре
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-64">
                    {(allocation.groupDemands ?? []).length === 0 ? (
                      <span className="text-muted-foreground text-sm">—</span>
                    ) : (
                      <div className="space-y-1">
                        {(allocation.groupDemands ?? []).map((demand) => {
                          const checked = (groupDraft[row.divisionId] ?? []).includes(demand.id);
                          const assignedElsewhere = Object.entries(groupDraft).some(
                            ([divisionId, ids]) => divisionId !== row.divisionId && ids.includes(demand.id)
                          );
                          return (
                            <label key={demand.id} className="flex items-start gap-2 text-xs">
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4"
                                disabled={locked || assignedElsewhere || !orgIds.has(row.divisionId)}
                                checked={checked}
                                onChange={(event) =>
                                  setGroupDraft((current) => ({
                                    ...current,
                                    [row.divisionId]: event.target.checked
                                      ? [...(current[row.divisionId] ?? []), demand.id]
                                      : (current[row.divisionId] ?? []).filter((id) => id !== demand.id),
                                  }))
                                }
                              />
                              <span>{demand.specification || demand.kindCode} · {demand.place}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.assigned ?? 0} из {row.need ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.notifiedAt === null
                      ? "Не запрошено"
                      : (row.assigned ?? 0) >= (row.need ?? 0) && (row.need ?? 0) > 0
                        ? "Выделено"
                        : // 🔴 МОМЕНТ, А НЕ ДАТА (Plane №560). `notifiedAt` —
                          // метка времени сервера в UTC, и `formatIsoDate`
                          // режет из неё префикс «ГГГГ-ММ-ДД» РЕГУЛЯРКОЙ,
                          // минуя часовой пояс намеренно (так и надо для
                          // `businessDate` выше — там даты без времени).
                          // Департамент, разославший запрос в 03:00 по
                          // местному (+05), хранится как «…T22:00:00+00:00»
                          // ПРЕДЫДУЩЕГО дня, и колонка печатала «Запрошено
                          // <вчера>». Соседний экран того же поля
                          // (`ForcesSplitPanel.tsx`) уже читает его
                          // `formatIsoDateTime`.
                          `Запрошено ${formatIsoDateTime(row.notifiedAt)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}

        {/* Кнопка живёт при наличии ПРАВИМЫХ строк, а не любых (Plane №530):
            у заявки, где все управления выбыли из оргструктуры, сохранять
            нечего — запрос ушёл бы пустым и ничего не менял. */}
        {!locked && editableRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void save().catch(() => { /* Ошибка отображается ниже через split.isError. */ })} disabled={split.isPending} aria-busy={split.isPending}>
              {split.isPending ? "Сохраняем…" : "Сохранить раскладку"}
            </Button>
            {/* Итог НАБРАННОГО, а не сохранённого: он про черновик, о котором
                сервер ещё не знает. Перебор называется до нажатия — сервер
                отобьёт его и сам, но узнать об этом заранее дешевле. */}
            <p
              className={`text-sm ${draftTotal > splitCap ? "text-destructive-ink" : "text-muted-foreground"}`}
            >
              Набрано {draftTotal} из {splitCap}
              {draftTotal > splitCap ? ` · перебор ${draftTotal - splitCap}` : ""}
            </p>
          </div>
        )}

        {split.isError && (
          <p role="alert" className="text-destructive-ink text-sm">
            {split.error?.message ?? "Раскладка не сохранилась"}
          </p>
        )}
        {split.isSuccess && !splitDirty && !locked && (
          <p role="status" className="text-muted-foreground text-sm">
            Раскладка сохранена. Отправьте её в управления, чтобы начать сбор людей.
          </p>
        )}
      </section>
      </RequestSection>

      <RequestSection
        key={`members-${allocationId}`}
        name="members"
        title="Выделенные сотрудники"
        summary={assigned === 0 ? "Список пока пуст" : `${assigned} сотрудников в списке`}
        initiallyOpen={next.section === "members"}
      >
      <section aria-labelledby="members-heading" className="min-w-0 space-y-3 border-t p-4 sm:p-5">
        <div>
          <h3 id="members-heading" className="font-semibold">
            Выделенные сотрудники
          </h3>
          <p className="text-muted-foreground text-sm">
            Состав поступает от начальников управлений. Физический наряд сначала идёт в общий резерв,
            Штаб распределяет его по ОМ и объектам. Специальные группы выделяются на конкретное мероприятие.
          </p>
          <p className="mt-1 text-sm font-medium tabular-nums">Собрано {assigned} из {ownFigure}</p>
        </div>

        {/* `[СБС-23]`: ГРУППЫ ПО УПРАВЛЕНИЯМ с чипами «N из M» (Plane №944).
            Человек числится в отделе; к управлению его относит сервер по
            поддереву (`memberDirectorateById`) — тем же правилом, что и
            «выделено N из M» в таблице выше. Чип в одну строку: число — не
            текст, переноситься ему нечего. */}
        {allocation.members.length === 0 ? (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            Список пока пуст. {collectionClosed
              ? "Выделенные сотрудники в этой заявке не сохранены."
              : allocation.notifiedAt !== null || allocation.status === "NOTIFIED" || allocation.status === "RETURNED"
                ? "Начальники управлений ещё не выделили сотрудников. Они появятся здесь автоматически."
                : "Сотрудники появятся после выделения управлением. Запрос управлений доступен в разделе распределения."}
          </p>
        ) : (
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
              {memberGroups.map((group) => (
                <Fragment key={`group-${group.divisionId ?? "none"}`}>
                  <TableRow data-slot="member-group">
                    <TableCell
                      colSpan={3}
                      className="text-muted-foreground bg-muted/30 text-xs font-semibold uppercase tracking-wide"
                    >
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {group.name}
                        <Badge
                          variant={group.need > 0 && group.members.length >= group.need ? "secondary" : "outline"}
                          className="whitespace-nowrap normal-case tabular-nums"
                          data-slot="member-group-chip"
                        >
                          {group.members.length} из {group.need}
                        </Badge>
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.members.map((member) => (
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
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </section>
      </RequestSection>

      <RequestSection
        key={`send-${allocationId}`}
        name="send"
        title="Передача списка Штабу"
        summary={allocation.status === "ACCEPTED" ? "Принято Штабом" : allocation.status === "SUBMITTED" ? "Ожидаем решения Штаба" : collectionClosed ? "Отправка на этом этапе недоступна" : canSubmit && assigned > 0 ? "Список можно отправить после проверки" : "Список ещё не готов к отправке"}
        initiallyOpen={next.section === "send"}
      >
        <section aria-labelledby="send-heading" className="space-y-3 border-t p-4 sm:p-5">
          <h3 id="send-heading" className="font-semibold">Передача списка Штабу</h3>
          <p className="text-sm text-muted-foreground">{sent ? allocation.status === "ACCEPTED" ? "Список принят Штабом" : "Список у Штаба" : collectionClosed ? "Отправка списка на этом этапе недоступна" : allocation.status === "DECLINED" ? declinedWithGroups ? "Передача списка при сохранённом отказе по физическому наряду недоступна. Специальные группы сохранены и доступны в ответе и составе." : "Сохранён отказ департамента. Если решение изменилось, сначала исправьте ответ." : allocation.notifiedAt === null && allocation.status !== "RETURNED" && allocation.status !== "NOTIFIED" ? "Сначала отправьте квоты в управления" : `В списке ${assigned} из ${ownFigure} — перед отправкой проверьте состав`}</p>
        {/* 🔴 КНОПКА, КОТОРОЙ НЕ БЫЛО (Plane №389, `[СБС-23]`): «Отправить
            список в штаб» жила только на панели мероприятия у ШТАБА
            (`ForcesSplitPanel`), куда у ответственного за департамент нет
            доступа. Ручка `.../submit/` разрешала действие СВОЕМУ
            департаменту всегда — экрана не было. */}
        {canSubmit && (
          <div className="flex flex-wrap items-center gap-3">
            {assigned > 0 && (
            <Button
              type="button"
              disabled={submit.isPending || assigned === 0}
              onClick={() => setSubmitOpen(true)}
            >
              Отправить список в штаб
            </Button>
            )}
            {assigned === 0 ? (
              <p className="text-muted-foreground text-sm">Сначала дождитесь хотя бы одного сотрудника от управлений. Пустой список отправить нельзя.</p>
            ) : assigned < ownFigure && (
              <p className="text-muted-foreground text-sm">
                Собрано {assigned} из {ownFigure} — список можно отправить и
                так, штаб решит, довыделять или принять как есть.
              </p>
            )}
          </div>
        )}
        {/* 🔴 ОТЗЫВ БЕЗ ПАНЕЛИ ШТАБА (Plane №532). Диалог отправки обещает
            «отозвать список», а единственная кнопка отзыва жила в
            `ForcesSplitPanel` за правом `event.view`, которого этой роли не
            дают: обещание было невыполнимым ровно для того, кто его читал.
            Ручка отзыва гейтится тем же `forces.allocate` со скопом своего
            департамента, что и отправка. Подтверждения нет намеренно —
            действие обратное (список отправляется заново той же кнопкой) и
            повторяет поведение штабной панели. */}
        {allocation.status === "SUBMITTED" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Отправлено — ждём решения штаба.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate({})}
            >
              {withdraw.isPending ? "Отзываю…" : "Отозвать список"}
            </Button>
          </div>
        )}
        {withdraw.isError && (
          <p role="alert" className="text-destructive-ink text-sm">
            {withdraw.error?.message ?? "Список не отозван"}
          </p>
        )}
        </section>
      </RequestSection>

      <RequestSection key={`totals-${allocationId}`} name="totals" title="Итоги запроса" summary={`Запрошено ${quota} · выделяем ${allocation.allocating ?? "—"} · собрано ${assigned}`}>
        <div className="grid grid-cols-2 gap-3 border-t p-4 sm:p-5 xl:grid-cols-4" aria-label="Итоги запроса">
          <StatCard label="Запрошено Штабом" value={quota} caption="Физический наряд" />
          <StatCard label="Выделяем" value={allocation.allocating ?? "—"} tone="info" caption={hasAnswer ? "Сохранённый ответ департамента" : "Ответ ещё не сохранён"} />
          <StatCard label="Собрано" value={assigned} tone="success" caption="Сотрудники в списке" />
          <StatCard label="Недобор к обещанию" value={hasAnswer ? Math.max(0, ownFigure - assigned) : "—"}
            tone={hasAnswer && assigned < ownFigure ? "danger" : "neutral"}
            caption={!hasAnswer ? "Ответ количеством не сохранён" : assigned > ownFigure ? `Сверх обещания: ${assigned - ownFigure}` : "От собственного ответа департамента"} />
        </div>
      </RequestSection>

      {/* ПОДТВЕРЖДЕНИЕ ЗАПРОСА УПРАВЛЕНИЙ (Plane №532). Кнопка слала мутацию
          сразу: один случайный щелчок запирал раскладку насовсем — сервер
          после `NOTIFIED` отвечает на правку квот `DIRECTORATE_QUOTAS_LOCKED`,
          а отзыв списка возвращает заявку в `NOTIFIED`, не в `DRAFT`. Диалог
          называет обе цены действия: необратимость и судьбу несохранённого
          черновика. */}
      <Dialog open={notifyOpen && !collectionClosed} onOpenChange={setNotifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить заявку в управления?</DialogTitle>
            {/* 🔴 ПРЕДУПРЕЖДЕНИЕ ЖИВЁТ В ОПИСАНИИ ДИАЛОГА, а не только в
                жёлтом блоке ниже (ревью №808). Живой регион (`role="status"`)
                объявляет ИЗМЕНЕНИЯ после того, как он смонтирован, а Radix
                монтирует содержимое диалога целиком и сразу с текстом — такой
                вставки читалки обычно не читают. Зато с описанием диалог
                связан сам (`aria-describedby`), и при открытии незрячий
                услышит его. Жёлтый блок ниже — та же фраза для глаз. */}
            <DialogDescription>
              Начальники управлений получат уведомление и начнут выделять
              людей. После этого раскладку по управлениям не поправить —
              ни правкой, ни отзывом списка.
              {nothingWillBeSent
                ? " По управлениям пока ничего не разложено, поэтому отправка недоступна. Сначала укажите людей или специальные группы и сохраните раскладку."
                : ""}
              {someWillBeSilent
                ? ` Внимание: ${silentRows.length} из ${directorateRows.length} управлений стоят без цифры — им уведомление не уйдёт, и дописать их после отправки будет нельзя.`
                : ""}
              {splitDirty
                ? " Кнопка ниже сначала сохранит набранную раскладку, затем отправит её в управления. При ошибке сохранения отправка не начнётся."
                : ""}
            </DialogDescription>
          </DialogHeader>
          {/* Числа рядом с решением, а не в голове у человека: сравнивать
              «сколько разложено» с «сколько выделяем» после закрытия диалога
              будет уже поздно. Показывается НАБРАННОЕ, когда оно расходится с
              сохранённым, — отправлять будем именно его. */}
          <p className="text-muted-foreground text-sm">
            Разложено {effectiveTotal} из {splitCap}
            {effectiveTotal < splitCap
              ? ` · не разложено ${splitCap - effectiveTotal}`
              : ""}
          </p>
          {/* Пустая рассылка отклоняется и сервером (Plane №887), поэтому
              диалог заранее объясняет следующий шаг и не предлагает
              необратимое действие, которое ничего не отправит. */}
          {nothingWillBeSent && (
            <p
              data-slot="notify-nothing-to-send"
              aria-hidden="true"
              className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              По управлениям не разложено ни одного человека:{" "}
              <strong>отправка пока недоступна</strong>.
              {splitCap > 0
                ? " Сначала разложите людей или специальные группы по управлениям и сохраните раскладку."
                : " Раскладывать нечего: в ответе департамента стоит «Выделяем: 0» — сперва поправьте ответ, если людей всё же выделяете."}
            </p>
          )}
          {/* Частичная раскладка — та же цена, но тише: управления без цифры
              писем не получат, и дописать их после отправки нельзя. */}
          {someWillBeSilent && (
            <p
              data-slot="notify-partial"
              aria-hidden="true"
              className="text-foreground text-sm"
            >
              {silentRows.length} из {directorateRows.length} управлений стоят
              без цифры — уведомление им не уйдёт, и дописать их после отправки
              будет нельзя: {silentRows.map((row) => row.name).join(", ")}.
            </p>
          )}
          {(split.isError || notify.isError) && (
            <p role="alert" className="text-destructive-ink text-sm">
              {split.error?.message ??
                notify.error?.message ??
                "Управления не оповещены"}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifyOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={collectionClosed || nothingWillBeSent || notify.isPending || split.isPending}
              onClick={() => {
                if (collectionClosed) return;
                // Сохранение и оповещение — ДВА запроса, и второй идёт
                // только после успеха первого: иначе несохранённая
                // раскладка запиралась бы вместе с сохранённой.
                void (async () => {
                  if (splitDirty) {
                    try {
                      await save();
                    } catch {
                      return;
                    }
                  }
                  notify.mutate({}, { onSuccess: () => setNotifyOpen(false) });
                })();
              }}
            >
              {notify.isPending || split.isPending
                ? "Отправляю…"
                : nothingWillBeSent
                  ? "Сначала разложите запрос"
                : splitDirty
                  ? "Сохранить и отправить"
                  : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={submitOpen && !collectionClosed} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отправить список в штаб?</DialogTitle>
            <DialogDescription>
              {/* Подтверждение спецификации `[СБС-13]`: «при недоборе —
                  подтверждение с комментарием». Комментария к отправке у
                  этого шага нет — штаб видит недобор числом на своей
                  карточке (Ш-5 плана №74) и решает там; здесь только
                  предупреждение, чтобы отправка «не глядя» не выглядела как
                  сбой.
                  🔴 НОЛЬ — ОТДЕЛЬНЫЙ СЛУЧАЙ, а не «недобор в 100 %»: сервер
                  отвечает `ALLOCATION_EMPTY` и отправку отклоняет вовсе
                  («Никто не выделен — отправлять нечего»), пока недобор
                  1..N-1 отправить можно — решает штаб. Формулировка не
                  обещает то, чего действие не сделает. */}
              {/* `[СБС-23]`: подтверждение — ПРОТИВ СВОЕЙ ЦИФРЫ «Выделяем»
                  («Отправить 2 из 3?»), а не против запроса штаба: сколько
                  департамент обещал, столько и должен сдать (Plane №944).
                  Пока ответа нет — запрос штаба. */}
              {assigned === 0
                ? "Никто ещё не выделен. Дождитесь хотя бы одного сотрудника от управлений: пустой список отправить нельзя."
                : assigned < ownFigure
                  ? `Отправить ${assigned} из ${ownFigure}? Обещано «Выделяем: ${ownFigure}», собрано меньше на ${ownFigure - assigned}.`
                  : `Выделено ${assigned} из ${ownFigure} — список полный, отправить штабу?`}
              {" "}Раскладку по управлениям после отправки не поправить:
              отзыв возвращает список в работу, но квоты управлений остаются
              прежними.
            </DialogDescription>
          </DialogHeader>
          {submit.isError && (
            <p role="alert" className="text-destructive-ink text-sm">
              {submit.error?.message ?? "Список не отправлен"}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={collectionClosed || submit.isPending || assigned === 0}
              onClick={() => {
                if (collectionClosed || submit.isPending || assigned === 0) return;
                submit.mutate(
                  {},
                  { onSuccess: () => setSubmitOpen(false) }
                );
              }}
            >
              {submit.isPending ? "Отправляю…" : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
