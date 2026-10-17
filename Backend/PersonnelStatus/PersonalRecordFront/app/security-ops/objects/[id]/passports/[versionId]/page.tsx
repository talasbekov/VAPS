"use client";

// Опубликованная версия паспорта — read-only просмотр по собственному deep
// link. Экран НЕ редактирует: ни мутирующего хука, ни полей ввода. Открытие
// старой версии не переключает на действующую редакцию: страница показывает
// СНИМОК и явно говорит, что это не черновик.
import Link from "next/link";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityObject } from "@/hooks/use-security-objects";
import { PassportVersionSnapshot } from "@/features/object-passport";
import { formatIsoDateTime, formatIsoDate } from "@/shared/lib/date";

const VERSION_NOT_FOUND_TEXT =
  "Версия паспорта не найдена — возможно, ссылка ведёт на другой объект.";

export default function PassportVersionPage() {
  return <Suspense fallback={<div className="min-h-screen bg-background" />}><PassportVersionScreen /></Suspense>;
}

function PassportVersionScreen() {
  const params = useParams<{ id: string; versionId: string }>();
  const id = params?.id ?? "";
  const versionId = params?.versionId ?? "";
  const access = useOpsPermissions();
  const canView = !access.isLoading && access.permissions !== undefined && access.hasPermission("object.view");
  const query = useSecurityObject(id, { enabled: canView });
  const searchParams = useSearchParams();
  const back = searchParams.get("back") ?? "";
  const historyParams = new URLSearchParams({ tab: "history" });
  if (back !== "") historyParams.set("back", back);
  const backLink = <Link href={`/security-ops/objects/${encodeURIComponent(id)}?${historyParams.toString()}`}
    className="mb-3 inline-block text-xs font-semibold text-primary-ink">← Назад к истории паспорта</Link>;
  const accessReadFailed = query.readAccessBlocked;
  const mismatched = query.data !== undefined && query.data.id !== id;

  // Deep link на версию паспорта минует реестр объектов с его гвардом.
  if (access.isLoading) {
    return <DashboardLayout><p className="text-sm text-muted-foreground">Проверка доступа к версии паспорта…</p></DashboardLayout>;
  }
  if (!canView) {
    return <OpsAccessDenied what="версии паспорта объекта" />;
  }

  if (query.isLoading) {
    return (
      <DashboardLayout>
        {backLink}
        <p className="text-sm text-muted-foreground">Загрузка версии паспорта…</p>
      </DashboardLayout>
    );
  }
  if (query.data === undefined || accessReadFailed || mismatched) {
    return (
      <DashboardLayout>
        {backLink}
        <LoadFailure what="опубликованную версию паспорта"
          description={accessReadFailed ? "Объект не найден или недоступен для просмотра." : mismatched ? "Ответ не соответствует выбранному объекту. Повторите загрузку." : undefined}
          onRetry={() => { void query.refetch(); }} isRetrying={query.isFetching} />
      </DashboardLayout>
    );
  }

  const object = query.data;
  const version = object.passportVersions.find((v) => v.id === versionId);

  return (
    <DashboardLayout>
      {backLink}
      {query.isError && <LoadFailure what="опубликованную версию паспорта"
        description={version === undefined ? "В последних загруженных данных этой версии нет. Повторите загрузку для проверки." : "Показан последний загруженный снимок. Повторите загрузку для проверки доступа и актуальности."}
        onRetry={() => { void query.refetch(); }} isRetrying={query.isFetching} />}

      {version === undefined ? (!query.isError && (
        <Card>
          <CardContent className="p-9 text-center">
            <p className="text-sm text-destructive-ink">{VERSION_NOT_FOUND_TEXT}</p>
          </CardContent>
        </Card>
      )) : (
        <>
          <PageHeader
            className="mb-4"
            eyebrow="Паспорт объекта"
            title={`${object.name} · версия ${version.versionNumber}`}
            description={`Действует с ${formatIsoDate(version.effectiveFrom)} · опубликовано ${formatIsoDateTime(version.publishedAt)} · ${version.publishedBy}`}
            actions={
              <span className="inline-flex rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold text-muted-foreground">
                Только просмотр
              </span>
            }
          />

          <PassportVersionSnapshot version={version} />
        </>
      )}
    </DashboardLayout>
  );
}
