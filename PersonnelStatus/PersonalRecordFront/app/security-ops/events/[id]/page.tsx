"use client";

// Карточка ОМ: шапка + степпер стадий + активный этап. Компонент этапа
// получает key по updatedAt — успешная операция пересоздаёт его от свежего
// серверного состояния (локальные черновики не переживают переходы).
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { useOverrideStage } from "@/hooks/use-security-event-stages";
import { EventStepper } from "@/widgets/security-event-stepper";
import { EVENT_STEPS, STEP_ENTRY_STAGE, stepIndexOfStage } from "@/entities/security-event";
import {
  AcknowledgementStage,
  ApprovalStage,
  AwaitingReconStage,
  BulletinPanel,
  ClosedView,
  ConductStage,
  PlacementStage,
  ReconStage,
} from "@/features/security-event-stages";
import {
  NO_OBJECT_TEXT,
  NO_PUBLISHED_VERSION_TEXT,
  StageBadge,
  objectLabel,
} from "@/entities/security-event";
import type {
  SecurityEvent,
  SecurityEventStage,
  VisitObject,
} from "@/entities/security-event";
import { formatIsoDate } from "@/shared/lib/date";

export default function SecurityEventPage() {
  // useSearchParams требует границы Suspense при пререндере.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SecurityEventScreen />
    </Suspense>
  );
}

function SecurityEventScreen() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  // Возврат — на тот отбор реестра, с которым человек сюда пришёл.
  const back = searchParams.get("back") ?? "";
  const backTo =
    back === "" ? "/security-ops/events" : `/security-ops/events?${back}`;
  const router = useRouter();
  const id = params?.id ?? "";
  // Объект посещения, с которого пришли из реестра. В URL, а не в состоянии:
  // «этапы вот этого объекта» — адрес, который пересылают, а не настроение
  // текущей вкладки.
  const visitParam = searchParams.get("visit");
  const query = useSecurityEvent(id);
  // Несохранённый бюллетень: панель стоит НАД этапами, а кнопка «Открыть
  // рекогносцировку» — в области этапа, и без этого сигнала переход стирал бы
  // набранный текст (после смены стадии сервер правку бюллетеня не примет).
  const [bulletinDirty, setBulletinDirty] = useState(false);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Объекты посещения и выбранный из них считаются ДО ранних веток: ниже
  // стоят гварды прав и ошибки, а хуки не могут жить за ними.
  const visits = query.data?.visitObjects ?? [];
  // Неизвестный `visit` в адресе (объект сняли с мероприятия по чужой ссылке)
  // не должен выглядеть как выбранный: берём первый, а не подставляем пустоту.
  const selectedVisit =
    visits.find((visit) => visit.id === visitParam) ?? visits[0] ?? null;
  const replaceVisit = useCallback(
    (visitId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("visit", visitId);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );
  // Адрес с чужим/снятым объектом ЧИНИТСЯ, а не игнорируется: иначе подсвечен
  // один объект, а в ссылке стоит другой, и пересланный адрес разносит ошибку
  // дальше.
  useEffect(() => {
    if (selectedVisit === null) return;
    if (visitParam === selectedVisit.id) return;
    if (visitParam === null) return;
    replaceVisit(selectedVisit.id);
  }, [replaceVisit, selectedVisit, visitParam]);


  // Просматриваемый шаг цепочки живёт в АДРЕСЕ (`?step=` — номер шага, как его
  // видит человек, с единицы), а не в состоянии вкладки: «покажи мне этап N
  // вот этого ОМ» — ссылка, которую пересылают на разборе.
  const stepParam = searchParams.get("step");
  const selectStep = useCallback(
    (index: number) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("step", String(index + 1));
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Гвард прав ВЫШЕ ветки ошибки запроса: без него deep link в обход реестра
  // отдавал 403 в query, и отказ по правам печатался как «Мероприятие не
  // найдено или недоступно» — то есть как отсутствие объекта.
  if (!permissionsLoading && !hasPermission("event.view")) {
    return <OpsAccessDenied what="карточки мероприятия" />;
  }

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка мероприятия…</p>
      </DashboardLayout>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-destructive-ink">
          Мероприятие не найдено или недоступно.
        </p>
        <Link
          href={backTo}
          className="mt-2 inline-block text-sm font-semibold text-primary-ink"
        >
          ← Назад к реестру
        </Link>
      </DashboardLayout>
    );
  }

  const event = query.data;
  // Обход этапов — админ-полномочие; у всех остальных цепочка остаётся такой,
  // какой была: показывает, где мероприятие, и никуда не ведёт.
  const canOverrideStage = hasPermission("event.stage_override");
  const currentIndex = stepIndexOfStage(event.stage);
  // Номер шага из адреса чинится, а не доверяется: чужая ссылка с `step=99`
  // не должна открывать пустоту, а без права обхода параметр не действует
  // вовсе — иначе он был бы дырой в обход гварда.
  const parsedStep = Number.parseInt(stepParam ?? "", 10);
  const viewedIndex =
    canOverrideStage &&
    Number.isInteger(parsedStep) &&
    parsedStep >= 1 &&
    parsedStep <= EVENT_STEPS.length
      ? parsedStep - 1
      : currentIndex;
  const viewingOtherStep = viewedIndex !== currentIndex;
  // Внутри своего шага показываем РЕАЛЬНУЮ стадию мероприятия (иначе на шаге
  // «Расстановка» карточка открывала бы «Потребность», когда ОМ уже на
  // расстановке), а в чужом — входную стадию шага.
  const viewedStage = viewingOtherStep
    ? STEP_ENTRY_STAGE[EVENT_STEPS[viewedIndex].key]
    : event.stage;

  return (
    <DashboardLayout>
      <Link
        href={backTo}
        className="mb-3 inline-block text-xs font-semibold text-primary-ink"
      >
        ← Назад к реестру
      </Link>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-200">
              {event.code}
            </span>
            <StageBadge stage={event.stage} />
            <span className="text-xs text-muted-foreground tabular-nums">
              готовность {event.readinessPercent}%
            </span>
          </div>
          {/* Надзаголовок не передаём: над H1 уже стоит ряд бейджей (код ОМ,
              этап, готовность) — он и есть контекст записи. Второй капсовый
              лейбл сверху дублировал бы его. */}
          <PageHeader
            title={event.title}
            // Период, а не одна дата: ОМ бывает многодневным (бэк принимает
            // `businessDateEnd`, реестр считает по нему продолжительность), и
            // карточка, показывая только начало, теряла половину факта —
            // человек читал трёхдневное мероприятие как однодневное.
            description={`${formatIsoDate(event.businessDate)}${
              event.businessDateEnd !== null &&
              event.businessDateEnd !== event.businessDate
                ? ` — ${formatIsoDate(event.businessDateEnd)}`
                : ""
            } · ответственный: ${event.ownerName}`}
          />
          {/* Карточка ОМ — хаб: объект и сводка ГВО кликабельны отсюда на
              ЛЮБОМ этапе. Сводка ГВО адресуется id самого мероприятия — своей
              записи у неё нет (см. entities/gvo-summary), поэтому ссылка
              жива всегда. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
            {event.objectId !== null ? (
              <Link
                href={`/security-ops/objects/${event.objectId}`}
                className="font-semibold text-primary-ink"
              >
                Объект: {objectLabel(event)} →
              </Link>
            ) : (
              <span className="text-muted-foreground">
                Объект: {objectLabel(event)}
              </span>
            )}
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link
              href={`/security-ops/gvo/${event.id}`}
              className="font-semibold text-primary-ink"
            >
              Сводка ГВО →
            </Link>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {event.passportBinding !== null
              ? `Паспорт: версия ${event.passportBinding.versionNumber} (действует с ${formatIsoDate(event.passportBinding.effectiveFrom)})`
              : event.objectId !== null
                ? NO_PUBLISHED_VERSION_TEXT
                : NO_OBJECT_TEXT}
          </p>
          <VisitObjectContext
            event={event}
            selected={selectedVisit}
            onSelect={replaceVisit}
          />
          <div className="mt-3">
            <EventStepper
              stage={event.stage}
              viewedIndex={viewedIndex}
              onSelect={canOverrideStage ? selectStep : undefined}
            />
          </div>
        </CardContent>
      </Card>

      {/* Бюллетень — НАД этапами: он больше не шаг цепочки, а сведения о
          мероприятии, нужные на каждом этапе. */}
      <BulletinPanel
        key={`bulletin-${event.stage}`}
        event={event}
        onDirtyChange={setBulletinDirty}
      />

      <StageHeading stage={viewedStage} />

      {viewingOtherStep && (
        <StageViewNotice
          eventId={event.id}
          currentStage={event.stage}
          viewedStage={viewedStage}
          viewedStepIndex={viewedIndex}
          onLeaveView={() => selectStep(currentIndex)}
        />
      )}

      {/* Ключ — ЭТАП, а не версия данных: смена этапа это новая форма, а
          обновление карточки (своя же мутация в соседней панели, инвалидация,
          чужая правка) не должно пересобирать форму и терять набранное.
          В режиме просмотра чужого шага панель ЦЕЛИКОМ выключена `inert`:
          поля и значения видны (прятать их значило бы скрыть предмет
          просмотра), но ни клик, ни Tab внутрь не проходят — иначе форма
          принимала бы ввод, который сервер на этой стадии отвергнет. */}
      <div
        inert={viewingOtherStep || undefined}
        className={viewingOtherStep ? "opacity-60" : undefined}
      >
        <ActiveStage
          key={viewedStage}
          event={event}
          stage={viewedStage}
          bulletinDirty={bulletinDirty}
        />
      </div>
    </DashboardLayout>
  );
}

/**
 * Заголовок этапа: «Этап N из 5», название и одна строка о том, что на этапе
 * делают.
 *
 * До этого карточка ОМ не называла этап вовсе — человек видел форму и должен
 * был опознать её по содержимому. Номер берётся от ШАГА, а не от стадии: три
 * стадии модели («Потребность», «Запрос сил», «Расстановка») это один шаг
 * цепочки, и нумеровать их подряд значило бы обещать девять шагов там, где
 * степпер показывает пять.
 *
 * Шагов пять, а не шесть: «Бюллетень» снят из цепочки 24.08.2026, и стадия
 * `BULLETIN` теперь занимает первый шаг вместе с рекогносцировкой — карточка
 * на ней показывает вход в рекогносцировку, а сам бюллетень заполняется в
 * панели над этапами.
 */
const STAGE_HEADING: Record<
  SecurityEventStage,
  { step: number; title: string; description: string }
> = {
  BULLETIN: {
    step: 1,
    title: "Рекогносцировка объекта",
    description:
      "Открывается после бюллетеня: осмотр объекта и расчёт постов старшим наряда",
  },
  RECON: {
    step: 1,
    title: "Рекогносцировка объекта",
    description: "Зоны и посты, необходимые направления, предварительные риски",
  },
  DEMAND: {
    step: 2,
    title: "Расстановка сил",
    description: "Потребность направлений, запрос сил и назначение на посты",
  },
  FORCES: {
    step: 2,
    title: "Расстановка сил",
    description: "Потребность направлений, запрос сил и назначение на посты",
  },
  PLACEMENT: {
    step: 2,
    title: "Расстановка сил",
    description: "Потребность направлений, запрос сил и назначение на посты",
  },
  APPROVAL: {
    step: 3,
    title: "Согласование расстановки",
    description:
      "Проверка конфликтов версии и подпись ЭЦП перед началом мероприятия",
  },
  ACKNOWLEDGEMENT: {
    step: 4,
    title: "Ознакомление с назначением",
    description:
      "Подтверждение прочтения назначения каждым сотрудником перед заступлением",
  },
  CONDUCT: {
    step: 5,
    title: "Проведение мероприятия",
    description: "Журнал событий смены и подготовка итогов направлений",
  },
  CLOSED: {
    step: 5,
    title: "Закрытие и итоги ОМ",
    description: "Итоги направлений, фактические часы, отклонения и полный архив",
  },
};

function StageHeading({ stage }: { stage: SecurityEventStage }) {
  const heading = STAGE_HEADING[stage];
  return (
    <div className="mb-3" data-slot="stage-heading">
      <p className="text-primary-ink text-[10.5px] font-bold uppercase tracking-[.12em]">
        Этап {heading.step} из {EVENT_STEPS.length}
      </p>
      <h2 className="mt-1 text-xl font-bold tracking-tight">{heading.title}</h2>
      <p className="text-muted-foreground mt-0.5 text-[12.5px]">
        {heading.description}
      </p>
    </div>
  );
}

/**
 * Полоса режима просмотра: админ смотрит НЕ тот шаг, на котором стоит ОМ.
 *
 * Она обязана говорить три вещи и говорить их словами, а не оттенком: что
 * показан чужой шаг, где мероприятие на самом деле, и что правки здесь сервер
 * не примет. Последнее — не пугалка: гварды стадий живы, и форма под полосой
 * выключена именно потому, что отправка вернула бы 422.
 *
 * Кнопка «Перевести ОМ сюда» — тот самый обход под правом
 * `event.stage_override`: она не «разблокирует форму на клиенте», а меняет
 * стадию на сервере, после чего панель оживает сама, потому что шаг стал
 * текущим. Переход попадает и в журнал переходов, и в журнал мутаций.
 */
function StageViewNotice({
  eventId,
  currentStage,
  viewedStage,
  viewedStepIndex,
  onLeaveView,
}: {
  eventId: string;
  currentStage: SecurityEventStage;
  viewedStage: SecurityEventStage;
  viewedStepIndex: number;
  onLeaveView: () => void;
}) {
  const override = useOverrideStage(eventId);
  const currentStepIndex = stepIndexOfStage(currentStage);
  return (
    <div
      className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 mb-3 rounded-md border px-3 py-2"
      data-slot="stage-view-notice"
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px]">
          <p className="font-semibold text-amber-900 dark:text-amber-100">
            Просмотр шага {viewedStepIndex + 1} из {EVENT_STEPS.length} —
            мероприятие стоит на шаге {currentStepIndex + 1}
            {" «"}
            {EVENT_STEPS[currentStepIndex].label}
            {"»"}
          </p>
          <p className="text-amber-800 dark:text-amber-200/90">
            Форма ниже показана целиком, но выключена: на этой стадии сервер
            правки не примет.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onLeaveView}>
            К текущему шагу
          </Button>
          <Button
            size="sm"
            disabled={override.isPending}
            onClick={() => override.mutate({ stage: viewedStage })}
          >
            {override.isPending ? "Перевод…" : "Перевести ОМ сюда"}
          </Button>
        </div>
      </div>
      {override.error !== null && (
        <p className="text-destructive-ink mt-1.5 text-xs">
          {override.error.message}
        </p>
      )}
    </div>
  );
}

function ActiveStage({
  event,
  stage,
  bulletinDirty,
}: {
  event: SecurityEvent;
  /** Показываемая стадия: своя у мероприятия либо выбранная админом к просмотру. */
  stage: SecurityEventStage;
  bulletinDirty: boolean;
}) {
  switch (stage) {
    case "BULLETIN":
      return <AwaitingReconStage event={event} bulletinDirty={bulletinDirty} />;
    case "RECON":
      return <ReconStage event={event} />;
    // Сбор группы и выделение сил живут ВНУТРИ шага «Расстановка» — своих
    // экранов у них больше нет, как и в прототипе.
    case "DEMAND":
    case "FORCES":
    case "PLACEMENT":
      return <PlacementStage event={event} />;
    case "APPROVAL":
      return <ApprovalStage event={event} />;
    case "ACKNOWLEDGEMENT":
      return <AcknowledgementStage event={event} />;
    case "CONDUCT":
      return <ConductStage event={event} />;
    case "CLOSED":
      return <ClosedView event={event} />;
  }
}

/**
 * Контекст объекта посещения в шапке карточки: из реестра сюда приходят
 * кликом по КОНКРЕТНОМУ объекту, и карточка обязана показать, по какому
 * объекту её открыли, а не молча показать мероприятие целиком.
 *
 * Переключатель появляется, когда объектов больше одного; выбор пишется в
 * адрес (`?visit=`), чтобы ссылку можно было переслать.
 *
 * Расчёт постов по объектам НЕ разнесён (`recon_sector_posts` не размечены
 * `visitObjectId`), и строка об этом стоит рядом с выбором: иначе смена
 * объекта выглядела бы фильтром этапов, который на деле ничего не меняет.
 */
function VisitObjectContext({
  event,
  selected,
  onSelect,
}: {
  event: SecurityEvent;
  selected: VisitObject | null;
  onSelect: (visitId: string) => void;
}) {
  const visits = event.visitObjects ?? [];
  if (visits.length === 0 || selected === null) return null;

  return (
    <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2" data-slot="visit-context">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          Объект посещения
        </span>
        {visits.length === 1 ? (
          <span className="text-xs font-semibold">{selected.objectName}</span>
        ) : (
          <span
            role="group"
            aria-label="Объект посещения мероприятия"
            className="flex flex-wrap gap-1"
          >
            {visits.map((visit) => {
              const active = visit.id === selected.id;
              return (
                <button
                  key={visit.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(visit.id)}
                  className={
                    active
                      ? "rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : "rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                >
                  {visit.objectName}
                </button>
              );
            })}
          </span>
        )}
        {selected.objectId !== null && (
          <Link
            href={`/security-ops/objects/${selected.objectId}`}
            className="text-xs font-semibold text-primary-ink"
          >
            карточка объекта →
          </Link>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {selected.protectedPersonName === ""
          ? "охраняемое лицо не назначено"
          : `Охраняемое лицо: ${selected.protectedPersonName}`}
        {" · "}
        {selected.passportBinding === null
          ? "паспорт не привязан"
          : `паспорт вер. ${selected.passportBinding.versionNumber}`}
      </p>
      {visits.length > 1 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Этапы ниже ведутся по мероприятию целиком: расчёт постов пока не
          разнесён по объектам, и переключение объекта меняет только эту
          справку.
        </p>
      )}
    </div>
  );
}
