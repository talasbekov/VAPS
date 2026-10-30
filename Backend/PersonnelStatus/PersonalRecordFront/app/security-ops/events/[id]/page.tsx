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
import { InDevelopmentBadge } from "@/components/in-development-badge";
import { inDevelopmentOfStage } from "@/shared/config/in-development";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { useOverrideStage } from "@/hooks/use-security-event-stages";
import { AddVisitObjectsDialog } from "@/features/event-visit-objects";
import { mayManageVisitObjects } from "@/entities/security-event/model/capabilities";
import { EventStepper } from "@/widgets/security-event-stepper";
import {
  EVENT_STEPS,
  STEP_ENTRY_STAGE,
  STAGE_LABEL,
  placementEditable,
  stepIndexOfStage,
} from "@/entities/security-event";
import {
  AcknowledgementStage,
  ApprovalStage,
  AwaitingReconStage,
  BulletinPanel,
  ClosedView,
  ConductStage,
  PlacementStage,
  ReconStage,
  UNASSIGNED_VISIT,
  unassignedIsMeaningful,
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
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Объекты посещения и выбранный из них считаются ДО ранних веток: ниже
  // стоят гварды прав и ошибки, а хуки не могут жить за ними.
  const visits = query.data?.visitObjects ?? [];
  // «Строки без объекта» — ТАКОЕ ЖЕ значение адреса, как объект (Plane №388):
  // этап расчёта умеет показывать неразмеченные посты, и раз показанное живёт
  // в `?visit=`, шапка обязана понимать это значение, а не чинить его молча в
  // первый объект — иначе шапка и дерево постов снова разошлись бы.
  // 🔴 «СТРОКИ БЕЗ ОБЪЕКТА» ПОКАЗЫВАЮТСЯ, ТОЛЬКО ЕСЛИ ОНИ ЕСТЬ (Plane №488).
  // Значение `__unassigned__` законно и приходит ссылкой, но законно ровно
  // тогда, когда неразмеченные строки есть и объектов больше одного. Правило
  // одно на страницу и хук — второй ответ на тот же вопрос разошёлся бы с
  // первым, чем этот дефект и был.
  const unassignedShown =
    visitParam === UNASSIGNED_VISIT &&
    unassignedIsMeaningful(visits, query.data?.reconSectorPosts ?? []);
  // Неизвестный `visit` в адресе (объект сняли с мероприятия по чужой ссылке)
  // не должен выглядеть как выбранный: берём первый, а не подставляем пустоту.
  const selectedVisit = unassignedShown
    ? null
    : (visits.find((visit) => visit.id === visitParam) ?? visits[0] ?? null);
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
    if (unassignedShown) return;
    if (selectedVisit === null) return;
    if (visitParam === selectedVisit.id) return;
    if (visitParam === null) return;
    // Сюда теперь попадает и «Не отнесены», когда показывать под ним нечего:
    // адрес чинится на первый объект, а не остаётся указывать в пустоту
    // (Plane №488). Без этого шапка продолжала бы утверждать «показаны строки,
    // не отнесённые ни к одному объекту», а ссылку пересылали бы дальше.
    replaceVisit(selectedVisit.id);
  }, [replaceVisit, selectedVisit, unassignedShown, visitParam]);


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
  // 🔴 ЦЕПОЧКА ЭТАПОВ ПОКАЗЫВАЕТ ЭТАП ПОКАЗАННОГО ОБЪЕКТА (Plane №412, Ш-6
  // плана №385). Требование `[МД-04]`: «у объекта свои этапы 1–5». Стадия
  // мероприятия — НАИМЕНЬШАЯ среди объектов, и рисовать ею цепочку значило бы
  // говорить «Расстановка» человеку, стоящему на согласованном объекте:
  // согласование первого объекта он уже закончил, а карточка звала бы его
  // расставлять людей заново.
  //
  // «Строки без объекта» (`?visit=__unassigned__`) своей стадии не имеют — их
  // не существует как сущности, и там отвечает мероприятие.
  const objectStage = selectedVisit?.stage ?? event.stage;
  const currentIndex = stepIndexOfStage(objectStage);
  // Номер шага из адреса чинится, а не доверяется: чужая ссылка с `step=99`
  // не должна открывать пустоту, а без права обхода параметр не действует
  // вовсе — иначе он был бы дырой в обход гварда.
  const parsedStep = Number.parseInt(stepParam ?? "", 10);
  // 🔴 ШАГ «РАССТАНОВКА» ОТКРЫТ НАЗАД, ПОКА СЕРВЕР ПРИНИМАЕТ ПРАВКУ (Plane
  // №861). После `placement/complete/` объект уходит на «Согласование», а
  // документ при этом ЧЕРНОВИК — и по `[СОГ-04]` (№533, №536) такая
  // расстановка правится свободно. Экранного пути к ней не было НИ У КОГО:
  // без права обхода этапов параметр `?step=` не действовал вовсе, а с правом
  // панель показывалась `inert`, то есть смотреть можно, трогать нельзя.
  // Половина «стало» двух закрытых карточек была проверяема только по API.
  //
  // Открывается РОВНО ОДИН шаг и ровно по тому признаку, по которому решает
  // сервер (`placementEditable` — зеркало `placement_frozen`): это не
  // послабление гварда обхода этапов, а приведение экрана к правилу, которое
  // сервер уже исполняет.
  const placementStepIndex = EVENT_STEPS.findIndex((step) => step.key === "PLACEMENT");
  const placementReopenable =
    currentIndex > placementStepIndex && placementEditable(event, selectedVisit);
  const stepInRange =
    Number.isInteger(parsedStep) && parsedStep >= 1 && parsedStep <= EVENT_STEPS.length;
  const requestedIndex = stepInRange ? parsedStep - 1 : currentIndex;
  // Архивные ссылки открывают уже доступные сведения event.view на чтение.
  // Это не перевод стадии: живые этапы и полномочие обхода остаются прежними.
  const documentParam = searchParams.get("document");
  const archiveDocument = objectStage === "CLOSED" && requestedIndex === 0 &&
    (documentParam === "recon" || documentParam === "bulletin") ? documentParam : null;
  const stepAllowed =
    canOverrideStage ||
    archiveDocument !== null ||
    (currentIndex > placementStepIndex && requestedIndex === placementStepIndex);
  const viewedIndex = stepInRange && stepAllowed ? requestedIndex : currentIndex;
  const archiveBulletin = archiveDocument === "bulletin" && viewedIndex === 0;
  const viewingOtherStep = viewedIndex !== currentIndex;
  // Открытая назад расстановка — НЕ «просмотр чужого шага»: форма живая, и
  // гасить её `inert` значило бы показать человеку то, что он не может
  // тронуть, ровно там, где сервер правку ждёт.
  const editingReopenedPlacement =
    viewingOtherStep && viewedIndex === placementStepIndex && placementReopenable;
  // Внутри своего шага показываем РЕАЛЬНУЮ стадию мероприятия (иначе на шаге
  // «Расстановка» карточка открывала бы «Потребность», когда ОМ уже на
  // расстановке), а в чужом — входную стадию шага.
  const viewedStage = viewingOtherStep
    ? STEP_ENTRY_STAGE[EVENT_STEPS[viewedIndex].key]
    : objectStage;

  return (
    <DashboardLayout>
      {/* Хлебные крошки (`[РЕК-01]`, Plane №442): «Реестр ОМ / ОМ-код
          «Название» / Объект: … (паспорт вер. X)» вместо «← Назад к реестру». */}
      <nav aria-label="Хлебные крошки" className="mb-3 text-xs" data-slot="breadcrumbs">
        <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
          <li>
            <Link href={backTo} className="font-semibold text-primary-ink">
              Реестр ОМ
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">
            {event.code}<span className="sr-only"> «{event.title}»</span>
          </li>
          {selectedVisit !== null && (
            <>
              <li aria-hidden="true" className="sr-only">/</li>
              <li className="sr-only">
                Объект: {selectedVisit.objectName}
                {selectedVisit.passportBinding !== null &&
                  ` (паспорт вер. ${selectedVisit.passportBinding.versionNumber})`}
              </li>
            </>
          )}
        </ol>
      </nav>

      <Card className="mb-4 sj-event-summary" data-slot="event-workspace-header">
        <CardContent className="sj-event-summary-content">
          <div className="sj-event-meta">
            <span className="sj-event-code">
              {event.code}
            </span>
            {/* Бейдж и готовность — у МЕРОПРИЯТИЯ: это его строка в реестре,
                и она обязана читаться одинаково в обоих местах. Этап объекта
                показывает цепочка ниже — там, где человек и работает. */}
            <StageBadge stage={event.stage} />
            <div className="sj-event-readiness">
              <span className="text-xs text-muted-foreground">Готовность ОМ</span>
              <strong className="text-xs font-semibold tabular-nums">{event.readinessPercent}%</strong>
              <Progress className="sj-event-readiness-meter" value={event.readinessPercent} aria-label="Готовность мероприятия" aria-valuenow={event.readinessPercent} />
            </div>
          </div>
          {/* Надзаголовок не передаём: над H1 уже стоит ряд бейджей (код ОМ,
              этап, готовность) — он и есть контекст записи. Второй капсовый
              лейбл сверху дублировал бы его. */}
          <div className="sj-event-heading-row">
          <PageHeader
            className="sj-event-title"
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
          {!permissionsLoading && (hasPermission('resource_calculation.view') || hasPermission('resource_calculation.manage')) && (
            <Link href={`/security-ops/events/${encodeURIComponent(event.id)}/force-calculation`}
              className="sj-event-calculation-link">
              Расчёт сил и средств →
            </Link>
          )}
          </div>
          {/* Карточка ОМ — хаб: объект кликабелен отсюда на любом этапе.
              Ссылки «Сводка ГВО →» здесь БОЛЬШЕ НЕТ (Plane «Реестр ОМ-35.8»):
              в сводку ведёт ссылка «Карточка визита →» в шапке бюллетеня
              (`[ГВО-03]`, Plane №441) — вторая ссылка на то же место рядом
              только сбивала бы. */}
          {visits.length === 0 && <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
            {event.objectId !== null && hasPermission("object.view") ? (
              <Link
                href={`/security-ops/objects/${event.objectId}`}
                className="font-semibold text-primary-ink"
              >
                Паспорт основного объекта: {objectLabel(event)} →
              </Link>
            ) : (
              <span className="text-muted-foreground">
                Объект: {objectLabel(event)}
              </span>
            )}
            {/* 🔴 «Карточка визита →» СНОВА ЖИВЁТ ТОЛЬКО В ПАНЕЛИ БЮЛЛЕТЕНЯ
                (Plane №748/№763). Сюда её вернул №468 с прямым доводом: «с
                №468 панель на этапах не рисуется — и вместе с ней пропал
                ЕДИНСТВЕННЫЙ вход в визит из карточки ОМ». Довод перестал
                действовать вместе со своей причиной: панель вернулась на все
                незакрытые стадии, и ссылка снова доступна оттуда.

                Оставить обе было нельзя не «для чистоты»: две ссылки на одно
                место рядом снимались намеренно ещё в «Реестр ОМ-35.8», и
                проба мёртвых ссылок ГВО ловит их строгим режимом — она и
                покраснела на задвоении. */}
          </p>}
          {/* Строка «Паспорт: версия …» снята (`[РЕК-09]`, Plane №443): объект
              и версия паспорта уже названы полосой объекта посещения ниже. */}
            {/* Кнопка «Информация по ГВО» ОТСЮДА УБРАНА (Plane №193):
                заказчик просил её на бюллетене, а не на первом этапе. Стоя в
                шапке — над степпером — она читалась как принадлежащая
                текущему этапу, каким бы он ни был. Теперь она в заголовке
                панели бюллетеня, а состояние осталось здесь: панель ГВО
                рисуется ниже отдельным блоком, и второй хозяин у одного
                «открыто/закрыто» означал бы рассинхрон. */}
          {/* 🔴 ОБЪЯСНЕНИЕ ПРО ПАСПОРТ — ТАМ, ГДЕ ПОЛОСЫ ОБЪЕКТА НЕТ (Plane
              №711). Строку «Паспорт: версия …» сняли (№443) с доводом «объект
              и версия уже названы полосой объекта посещения ниже» — верным
              ровно до тех пор, пока полоса рисуется. У ОМ без объектов
              посещения `VisitObjectContext` возвращает null, и вместе с ним
              исчезли ОБА объяснения, почему импорт постов недоступен: человек
              видел выключенную кнопку без причины. Прямая улика — импорты
              NO_OBJECT_TEXT/NO_PUBLISHED_VERSION_TEXT стали мёртвыми.

              Ветвление то же, что было снято, и показывается только здесь:
              там, где полоса есть, она по-прежнему говорит за себя. */}
          {(event.visitObjects ?? []).length === 0 && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-slot="passport-context"
            >
              {event.passportBinding !== null
                ? `Паспорт: версия ${event.passportBinding.versionNumber} (действует с ${formatIsoDate(event.passportBinding.effectiveFrom)})`
                : event.objectId !== null
                  ? NO_PUBLISHED_VERSION_TEXT
                  : NO_OBJECT_TEXT}
            </p>
          )}

        </CardContent>
      </Card>

          <div className="mb-6" data-slot="event-step-navigation">
            <p className="sj-event-step-context" data-slot="event-step-object-context">
              {unassignedShown ? "Показаны посты, не отнесённые к объекту" : selectedVisit !== null
                ? <>Этапы объекта: <strong>{visitObjectLabel(visits, selectedVisit)}</strong></>
                : "Этапы мероприятия"}
            </p>
            <EventStepper
              stage={objectStage}
              viewedIndex={viewedIndex}
              onSelect={canOverrideStage ? selectStep : undefined}
            />
            {currentIndex > placementStepIndex && viewedIndex !== placementStepIndex && (
              <Button className="mt-2" size="sm" variant="outline" onClick={() => selectStep(placementStepIndex)}>Расстановка и карта</Button>
            )}
          </div>

          <VisitObjectContext
            key={event.id}
            event={event}
            selected={selectedVisit}
            unassignedShown={unassignedShown}
            onSelect={replaceVisit}
          />

      {/* Бюллетень — ТОЛЬКО на стадии «Бюллетень» (Plane №468, решение
          заказчика 04.09.2026). Прежде панель стояла над этапами и была видна
          на всех пяти: на «Расстановке» она к тому же САМА раскрывалась (пока
          бюллетень заполнен не полностью) и отжимала работу вниз — с этого и
          началась карточка.

          Отменяет часть решения от 24.08.2026 («Реестр ОМ-4»), по которому
          панель и переехала наверх. Сведения, ради которых её туда поднимали,
          на этапах остаются в шапке выше: код, стадия, готовность, название,
          даты, ответственный, объект, объект посещения со старшим и лицом,
          цепочка шагов.

          Что с экранов этапов УХОДИТ вместе с панелью и куда делось: тип
          мероприятия, локация/адрес, факты ГВО, краткое описание и первичные
          задачи — их читает только сам бюллетень; ссылка «Карточка визита →»
          восстановлена в шапке ниже (иначе входа в визит из карточки не
          осталось бы вовсе — см. `Реестр ОМ-35.8`). */}
      {/* Панель стоит на всех незакрытых стадиях (Plane №748) и не
          раскрывается сама вне «Бюллетеня» (Plane №468) — свёрнутая строка
          заголовка работу вниз не отжимает. С 07.09.2026 (Plane №943) панель
          — только справка «Сведения об ОМ»: текста бюллетеня в проекте нет.
          В закрытом деле панель открывается только по ссылке на бюллетень. */}
      {(event.stage !== "CLOSED" || archiveBulletin) && (
        <BulletinPanel key={`bulletin-${objectStage}-${archiveBulletin ? "document" : "stage"}`} event={event} initiallyOpen={archiveBulletin} />
      )}
      {/* Панели «Информация по ГВО» в карточке БОЛЬШЕ НЕТ (`[ГВО-03]`, Plane
          №441): сводка визита живёт своей страницей, на этапах — только
          ссылка «Карточка визита →» в шапке бюллетеня. */}

      {!archiveBulletin && <StageHeading stage={viewedStage} />}

      {viewingOtherStep && (
        <StageViewNotice
          eventId={event.id}
          currentStage={objectStage}
          objectScope={selectedVisit !== null}
          viewedStage={viewedStage}
          viewedStepIndex={viewedIndex}
          editing={editingReopenedPlacement}
          canOverrideStage={canOverrideStage && archiveDocument === null}
          onLeaveView={() => selectStep(currentIndex)}
        />
      )}

      {/* Расстановка и рекогносцировка сами отключают запись,
          сохраняя просмотр и скачивание разрешённых материалов. Остальные
          формы чужого этапа остаются inert. */}
      {!archiveBulletin && <div
        inert={(viewingOtherStep && !editingReopenedPlacement && viewedIndex !== placementStepIndex && archiveDocument !== "recon" && viewedStage !== "RECON") || undefined}
      >
        <ActiveStage key={viewedStage} event={event} stage={viewedStage} readOnly={viewingOtherStep && !editingReopenedPlacement} />
      </div>}
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
      "Выбор объекта и начало рекогносцировки; зоны и посты уточняет старший наряда",
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
    // Про ЭЦП здесь стояло по эталону — но подписи домен не хранит вовсе, и
    // обещать её в подзаголовке значило бы называть несуществующее действие
    // (в самом эталоне, к слову, кнопки подписи тоже нет ни одной).
    description:
      "Маршрут согласующих, их решения и замечания перед началом мероприятия",
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
    // `[ЗАК-13]` (Plane №448): без «Архив» текстом — замка и статуса достаточно.
    title: "Архив ОМ",
    description: "Итог, оценки, инциденты, документы и история — одной страницей",
  },
};

function StageHeading({ stage }: { stage: SecurityEventStage }) {
  const heading = STAGE_HEADING[stage];
  const stageNote = inDevelopmentOfStage(stage);
  return (
    <div className="mb-3" data-slot="stage-heading">
      <p className="text-primary-ink text-[10.5px] font-bold uppercase tracking-[.12em]">
        Этап {heading.step} из {EVENT_STEPS.length}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold tracking-tight">{heading.title}</h2>
        {/* Метка этапа (Plane №450): у карточки ОМ шапка экрана помечает
            реестр целиком, а что не доделано на ЭТОМ этапе — говорит его
            шапка, иначе метка сверху обещала бы недоделки везде разом. */}
        {stageNote !== null && <InDevelopmentBadge note={stageNote} />}
      </div>
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
  objectScope,
  viewedStage,
  viewedStepIndex,
  editing,
  canOverrideStage,
  onLeaveView,
}: {
  eventId: string;
  currentStage: SecurityEventStage;
  objectScope: boolean;
  viewedStage: SecurityEventStage;
  viewedStepIndex: number;
  /** Шаг открыт НАЗАД для правки (Plane №861): форма живая, и говорить про
   *  «только для чтения» здесь было бы прямой неправдой. */
  editing: boolean;
  /** Обход этапов — админ-полномочие. До №861 баннер показывался ТОЛЬКО
   *  обладателю права, и кнопка перевода рисовалась безусловно; теперь на
   *  баннер попадает и оператор без него. */
  canOverrideStage: boolean;
  onLeaveView: () => void;
}) {
  const override = useOverrideStage(eventId, { onEvent: () => setConfirmOpen(false) });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const currentStepIndex = stepIndexOfStage(currentStage);
  const scopeLabel = objectScope ? "объект" : "мероприятие";
  const currentState = STAGE_LABEL[currentStage] !== EVENT_STEPS[currentStepIndex].label
    ? `, состояние «${STAGE_LABEL[currentStage]}»`
    : "";
  const passed = viewedStepIndex < currentStepIndex;
  return (
    <div
      className={
        editing
          ? "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 mb-3 rounded-md border px-3 py-2"
          : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 mb-3 rounded-md border px-3 py-2"
      }
      data-slot="stage-view-notice"
      data-editing={editing ? "true" : "false"}
      role="status"
    >
      {/* Баннер ОДНОЙ строкой (`[РЕК-03]`, Plane №442): что за шаг показан и
          что форма только для чтения; «Перевести ОМ сюда» — с подтверждением,
          штабу и админу (право `event.stage_override`).

          🔴 ДВА СОСТОЯНИЯ, А НЕ ОДНО (Plane №861). Открытая назад расстановка
          — живая форма, и жёлтая рамка со словами «только для чтения» над ней
          была бы той самой путаницей «выключенное выглядит как обычное»,
          только наоборот: человек не стал бы даже пробовать. Цвет здесь
          вторичен, решает ТЕКСТ — он прямо говорит, что правка идёт и почему
          она разрешена. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={
            editing
              ? "text-[12.5px] text-blue-900 dark:text-blue-100"
              : "text-[12.5px] text-amber-900 dark:text-amber-100"
          }
        >
          {editing ? (
            <>
              <span className="font-semibold">
                Правка расстановки открыта · {scopeLabel} на шаге{" "}
                {currentStepIndex + 1} «{EVENT_STEPS[currentStepIndex].label}»{currentState}.
              </span>{" "}
              Документ ещё не ушёл согласующим, поэтому состав правится. После
              отправки на согласование правка закроется.
            </>
          ) : (
            <>
              <span className="font-semibold">
                {passed ? "Этап пройден" : "Этап ещё не открыт"} · {scopeLabel} на шаге{" "}
                {currentStepIndex + 1} «{EVENT_STEPS[currentStepIndex].label}»{currentState}.
              </span>{" "}
              {viewedStage === "PLACEMENT" ? "Расстановка только для просмотра: можно выбрать пост и воспользоваться поиском." : "Форма только для чтения."}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onLeaveView}>
            {editing ? "Вернуться к согласованию" : "К текущему шагу"}
          </Button>
          {canOverrideStage && (
          <Button
            size="sm"
            disabled={override.isPending}
            onClick={() => {
              // Прежний отказ снимается при НОВОМ открытии окна (Plane №709):
              // иначе оно открывалось бы с чужой красной строкой от прошлой
              // попытки, ещё до нажатия.
              override.reset();
              setConfirmOpen(true);
            }}
          >
            Перевести ОМ сюда
          </Button>
          )}
        </div>
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-slot="stage-override-confirm">
          <DialogHeader>
            <DialogTitle>
              Перевести мероприятие на шаг {viewedStepIndex + 1} «{EVENT_STEPS[viewedStepIndex].label}»?
            </DialogTitle>
            <DialogDescription>
              Стадия сменится на сервере, форма шага откроется для правки, переход попадёт в
              журнал переходов и в аудит. Обычный путь — довести этап до конца, а не переводить.
            </DialogDescription>
          </DialogHeader>
          {/* 🔴 ОТКАЗ ПОКАЗЫВАЕТСЯ ВНУТРИ ОКНА (Plane №709). Он рисовался под
              оверлеем, то есть был не виден вовсе: диалог не закрывался,
              обратной связи не появлялось никакой, и кнопка жалась повторно —
              каждый раз с тем же отказом. Место сообщения — там, где стоит
              кнопка, его вызвавшая. */}
          {override.error !== null && (
            <p
              role="alert"
              className="text-destructive-ink text-xs"
              data-slot="stage-override-error"
            >
              {override.error.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={override.isPending}
              aria-busy={override.isPending}
              onClick={() => override.mutate({ stage: viewedStage })}
            >
              {override.isPending ? "Перевод…" : "Перевести"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActiveStage({
  event,
  stage,
  readOnly = false,
}: {
  event: SecurityEvent;
  /** Показываемая стадия: своя у мероприятия либо выбранная админом к просмотру. */
  stage: SecurityEventStage;
  readOnly?: boolean;
}) {
  switch (stage) {
    case "BULLETIN":
      return <AwaitingReconStage event={event} />;
    case "RECON":
      return <ReconStage event={event} readOnly={readOnly} />;
    // Сбор группы и выделение сил живут ВНУТРИ шага «Расстановка» — своих
    // экранов у них больше нет, как и в прототипе.
    case "DEMAND":
    case "FORCES":
    case "PLACEMENT":
      return <PlacementStage event={event} readOnly={readOnly} />;
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
 * Выбор ЗДЕСЬ и выбор НА ЭТАПЕ — одно и то же (Plane №388): оба пишут `?visit=`
 * и оба его читают. До этого шага переключатель шапки менял только справку, а
 * дерево постов жило своим состоянием и всегда начиналось с первого объекта.
 */
function visitObjectLabel(visits: VisitObject[], visit: VisitObject): string {
  const repeated = visits.filter(item => item.objectName === visit.objectName).length > 1;
  return repeated ? `Объект ${visits.findIndex(item => item.id === visit.id) + 1}: ${visit.objectName}` : visit.objectName;
}

function VisitObjectContext({
  event,
  selected,
  unassignedShown,
  onSelect,
}: {
  event: SecurityEvent;
  selected: VisitObject | null;
  unassignedShown: boolean;
  onSelect: (visitId: string) => void;
}) {
  const visits = event.visitObjects ?? [];
  const { hasPermission } = useOpsPermissions();
  const canManage = mayManageVisitObjects(event, hasPermission("event.manage"));
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => { if (!canManage) setAddOpen(false); }, [canManage]);

  return (
    <>
      <Card className="sj-event-objects" data-slot="visit-context" role="region" aria-label="Объекты ОМ">
        <CardContent className="sj-event-objects-content">
        <div className="sj-event-objects-heading">
          <h2>Объекты мероприятия <span className="sj-event-object-count">{visits.length}</span></h2>
          {canManage && <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setAddOpen(true)}>Добавить объекты</Button>}
        </div>
        {visits.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Объекты ещё не добавлены. Площадки одного мероприятия ведутся в общей карточке.</p>
        ) : (
          <>
            <div role="group" aria-label="Объект посещения мероприятия" className="sj-event-object-tabs">
              {visits.map((visit) => {
                const active = visit.id === selected?.id;
                const label = visitObjectLabel(visits, visit);
                return (
                  <button key={visit.id} type="button" aria-label={label} aria-pressed={active} onClick={() => onSelect(visit.id)}
                    className={active
                      ? "flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left text-sm font-semibold text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      : "flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}>
                    <span className="min-w-0 break-words">{label}</span>
                    <StageBadge stage={visit.stage} />
                  </button>
                );
              })}
            </div>
            {selected !== null && (
              <div className="sj-event-object-details" data-slot="visit-selected-details">
                <div className="sj-event-object-detail-title">
                  <span className="font-semibold text-foreground"><span className="sr-only">Выбран объект: </span>{selected.objectName}</span>
                  {selected.objectId !== null && hasPermission("object.view") && (
                    <Link href={"/security-ops/objects/" + selected.objectId} aria-label={"Паспорт объекта " + selected.objectName}
                      className="inline-flex min-h-11 items-center font-semibold text-primary-ink hover:underline">
                      Паспорт объекта →
                    </Link>
                  )}
                </div>
                <dl className="sj-event-object-facts">
                  <div data-slot="visit-chief-line"><dt>Старший объекта</dt><dd>{selected.chiefName || "не назначен"}</dd></div>
                  <div><dt>Замещающие</dt><dd>{selected.deputies.length === 0 ? "нет" : selected.deputies.map(item => item.employeeName).join(", ")}</dd></div>
                  <div><dt>Охраняемое лицо</dt><dd>{selected.protectedPersonName || "не назначено"}</dd></div>
                  <div><dt>Версия паспорта</dt><dd>{selected.passportBinding === null ? "паспорт не привязан" : "паспорт вер. " + selected.passportBinding.versionNumber}</dd></div>
                </dl>
              </div>
            )}
            {unassignedShown && <p className="mt-2 text-xs font-medium">Не отнесены к объекту: показаны неразмеченные строки расчёта. Выберите площадку выше, чтобы вернуться к её этапам.</p>}
            <p className="mt-4 text-xs text-muted-foreground">Рекогносцировка, расстановка и согласование относятся к выбранному объекту.</p>
          </>
        )}
        </CardContent>
      </Card>
      {canManage && <AddVisitObjectsDialog event={event} open={addOpen} onClose={() => setAddOpen(false)} />}
    </>
  );
}
