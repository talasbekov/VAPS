"use client";

// Карточка ОМ: шапка + степпер стадий + активный этап. Компонент этапа
// получает key по updatedAt — успешная операция пересоздаёт его от свежего
// серверного состояния (локальные черновики не переживают переходы).
import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { EventStepper } from "@/widgets/security-event-stepper";
import {
  AcknowledgementStage,
  ApprovalStage,
  BulletinStage,
  ClosedView,
  ConductStage,
  PlacementStage,
  ReconStage,
} from "@/features/security-event-stages";
import {
  NO_OBJECT_TEXT,
  NO_PUBLISHED_VERSION_TEXT,
  StageBadge,
} from "@/entities/security-event";
import type { SecurityEvent, SecurityEventStage } from "@/entities/security-event";
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
  const id = params?.id ?? "";
  const query = useSecurityEvent(id);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

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
              ЛЮБОМ этапе, а не только внутри блока «Сведения об ОМ»
              бюллетеня. Сводка ГВО адресуется id самого мероприятия — своей
              записи у неё нет (см. entities/gvo-summary), поэтому ссылка
              жива всегда. Объект — только если он у ОМ есть: ссылка на
              null не бывает. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
            {event.objectId !== null ? (
              <Link
                href={`/security-ops/objects/${event.objectId}`}
                className="font-semibold text-primary-ink"
              >
                Объект: {event.objectName} →
              </Link>
            ) : (
              <span className="text-muted-foreground">
                Объект: {event.objectName}
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
          <div className="mt-3">
            <EventStepper stage={event.stage} />
          </div>
        </CardContent>
      </Card>

      <StageHeading stage={event.stage} />

      {/* Ключ — ЭТАП, а не версия данных: смена этапа это новая форма, а
          обновление карточки (своя же мутация в соседней панели, инвалидация,
          чужая правка) не должно пересобирать форму и терять набранное. */}
      <ActiveStage key={event.stage} event={event} />
    </DashboardLayout>
  );
}

/**
 * Заголовок этапа из прототипа: «Этап N из 6», название и одна строка о том,
 * что на этапе делают.
 *
 * До этого карточка ОМ не называла этап вовсе — человек видел форму и должен
 * был опознать её по содержимому. Номер берётся от ШАГА, а не от стадии: три
 * стадии модели («Потребность», «Запрос сил», «Расстановка») это один шаг
 * прототипа, и нумеровать их подряд значило бы обещать девять шагов там, где
 * степпер показывает шесть.
 */
const STAGE_HEADING: Record<
  SecurityEventStage,
  { step: number; title: string; description: string }
> = {
  BULLETIN: {
    step: 1,
    title: "Информационный бюллетень",
    description:
      "Краткое описание, первичные задачи и сроки подготовки документов",
  },
  RECON: {
    step: 2,
    title: "Рекогносцировка объекта",
    description: "Зоны и посты, необходимые направления, предварительные риски",
  },
  DEMAND: {
    step: 3,
    title: "Расстановка сил",
    description: "Потребность направлений, запрос сил и назначение на посты",
  },
  FORCES: {
    step: 3,
    title: "Расстановка сил",
    description: "Потребность направлений, запрос сил и назначение на посты",
  },
  PLACEMENT: {
    step: 3,
    title: "Расстановка сил",
    description: "Потребность направлений, запрос сил и назначение на посты",
  },
  APPROVAL: {
    step: 4,
    title: "Согласование расстановки",
    description:
      "Проверка конфликтов версии и подпись ЭЦП перед началом мероприятия",
  },
  ACKNOWLEDGEMENT: {
    step: 5,
    title: "Ознакомление с назначением",
    description:
      "Подтверждение прочтения назначения каждым сотрудником перед заступлением",
  },
  CONDUCT: {
    step: 6,
    title: "Проведение мероприятия",
    description: "Журнал событий смены и подготовка итогов направлений",
  },
  CLOSED: {
    step: 6,
    title: "Закрытие и итоги ОМ",
    description: "Итоги направлений, фактические часы, отклонения и полный архив",
  },
};

function StageHeading({ stage }: { stage: SecurityEventStage }) {
  const heading = STAGE_HEADING[stage];
  return (
    <div className="mb-3" data-slot="stage-heading">
      <p className="text-primary-ink text-[10.5px] font-bold uppercase tracking-[.12em]">
        Этап {heading.step} из 6
      </p>
      <h2 className="mt-1 text-xl font-bold tracking-tight">{heading.title}</h2>
      <p className="text-muted-foreground mt-0.5 text-[12.5px]">
        {heading.description}
      </p>
    </div>
  );
}

function ActiveStage({ event }: { event: SecurityEvent }) {
  switch (event.stage) {
    case "BULLETIN":
      return <BulletinStage event={event} />;
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
