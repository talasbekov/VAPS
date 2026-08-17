"use client";

// Карточка ОМ: шапка + степпер стадий + активный этап. Компонент этапа
// получает key по updatedAt — успешная операция пересоздаёт его от свежего
// серверного состояния (локальные черновики не переживают переходы).
import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
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
import type { SecurityEvent } from "@/entities/security-event";

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
            <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800">
              {event.code}
            </span>
            <StageBadge stage={event.stage} />
            <span className="text-xs text-muted-foreground tabular-nums">
              готовность {event.readinessPercent}%
            </span>
          </div>
          <h1 className="text-xl font-bold">{event.title}</h1>
          <p className="text-sm text-muted-foreground">
            {event.businessDate} · {event.objectName} · ответственный:{" "}
            {event.ownerName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {event.passportBinding !== null
              ? `Паспорт: версия ${event.passportBinding.versionNumber} (действует с ${event.passportBinding.effectiveFrom})`
              : event.objectId !== null
                ? NO_PUBLISHED_VERSION_TEXT
                : NO_OBJECT_TEXT}
          </p>
          <div className="mt-3">
            <EventStepper stage={event.stage} />
          </div>
        </CardContent>
      </Card>

      {/* Ключ — ЭТАП, а не версия данных: смена этапа это новая форма, а
          обновление карточки (своя же мутация в соседней панели, инвалидация,
          чужая правка) не должно пересобирать форму и терять набранное. */}
      <ActiveStage key={event.stage} event={event} />
    </DashboardLayout>
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
