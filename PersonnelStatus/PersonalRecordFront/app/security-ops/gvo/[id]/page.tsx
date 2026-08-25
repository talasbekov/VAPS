"use client";

// Экран сводных данных ГВО по одному ОМ. С «Реестр ОМ-35.4» вся разметка
// сводки живёт в `widgets/gvo-summary` — этот экран остался ОБОЛОЧКОЙ: гейт
// права, загрузка мероприятия, ссылки назад. Ту же панель рисует карточка ОМ
// («Информация по ГВО»), и копия разметки разошлась бы с оригиналом на первой
// же правке.
//
// Сам модуль «Реестр ГВО» заказчик снимает — это шаг «ОМ-35.8»; до него экран
// остаётся живым, потому что на него ведут пункт меню, реестр и пробы.
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityEvent } from "@/hooks/use-security-events";
import { GvoSummaryPanel } from "@/widgets/gvo-summary";

export default function GvoSummaryPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const canView = hasPermission("event.view");
  const eventQuery = useSecurityEvent(canView ? id : "");

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="сводных данных ГВО" />;
  }

  const backLink = (
    <Link
      href="/security-ops/gvo"
      className="text-[12px] font-semibold text-primary-ink"
    >
      ← Назад к реестру ГВО
    </Link>
  );

  if (eventQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-3">
          {backLink}
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка сводных данных…
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const event = eventQuery.data;
  if (eventQuery.isError || event === undefined) {
    return (
      <DashboardLayout>
        <div className="space-y-3">
          {backLink}
          <Card>
            <CardContent className="p-9 text-center text-sm text-destructive-ink">
              Мероприятие не найдено — сводных данных по нему нет.
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {backLink}
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          {/* Обратный переход к своей карточке ОМ (Task 9): сводка не имеет
              собственной записи — id сводки это id мероприятия (Task 8), и
              ссылка назад ведёт на ТОТ ЖЕ id, с которого сводка открыта.
              Код ОМ в текст ссылки не выносим: он и так дублируется бейджем
              в шапке — второй раз тем же текстом «ловит» substring-пробы
              других экранов (e2e/events-registry.spec.ts) в неоднозначность. */}
          <Link
            href={`/security-ops/events/${event.id}`}
            className="text-[12px] font-semibold text-primary-ink"
          >
            К мероприятию →
          </Link>
        </div>

        <GvoSummaryPanel event={event} variant="page" />
      </div>
    </DashboardLayout>
  );
}
