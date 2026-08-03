"use client";

// Карточка ОМ: шапка + степпер стадий + активный этап. Компонент этапа
// получает key по updatedAt — успешная операция пересоздаёт его от свежего
// серверного состояния (локальные черновики не переживают переходы).
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { EventStepper } from "@/widgets/security-event-stepper";
import {
  AcknowledgementStage,
  ApprovalStage,
  BulletinStage,
  ClosedView,
  ConductStage,
  DemandStage,
  ForcesStage,
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
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const query = useSecurityEvent(id);

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
        <p className="text-sm text-destructive">
          Мероприятие не найдено или недоступно.
        </p>
        <Link
          href="/security-ops/events"
          className="mt-2 inline-block text-sm font-semibold text-primary"
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
        href="/security-ops/events"
        className="mb-3 inline-block text-xs font-semibold text-primary"
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

      <ActiveStage key={`${event.stage}-${event.updatedAt}`} event={event} />
    </DashboardLayout>
  );
}

function ActiveStage({ event }: { event: SecurityEvent }) {
  switch (event.stage) {
    case "BULLETIN":
      return <BulletinStage event={event} />;
    case "RECON":
      return <ReconStage event={event} />;
    case "DEMAND":
      return <DemandStage event={event} />;
    case "FORCES":
      return <ForcesStage event={event} />;
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
