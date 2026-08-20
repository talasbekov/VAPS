"use client";

// Опубликованная версия паспорта — read-only просмотр по собственному deep
// link. Экран НЕ редактирует: ни мутирующего хука, ни полей ввода. Открытие
// старой версии не переключает на действующую редакцию: страница показывает
// СНИМОК и явно говорит, что это не черновик.
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityObject } from "@/hooks/use-security-objects";

const VERSION_NOT_FOUND_TEXT =
  "Версия паспорта не найдена — возможно, ссылка ведёт на другой объект.";

const READ_ONLY_HINT =
  "Опубликованная версия неизменяема: это снимок паспорта на момент публикации, а не действующая редакция.";

export default function PassportVersionPage() {
  const params = useParams<{ id: string; versionId: string }>();
  const id = params?.id ?? "";
  const versionId = params?.versionId ?? "";
  const query = useSecurityObject(id);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Deep link на версию паспорта минует реестр объектов с его гвардом.
  if (!permissionsLoading && !hasPermission("object.view")) {
    return <OpsAccessDenied what="версии паспорта объекта" />;
  }

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка версии паспорта…</p>
      </DashboardLayout>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-destructive-ink">Объект не найден или недоступен.</p>
        <Link
          href="/security-ops/objects"
          className="mt-2 inline-block text-sm font-semibold text-primary-ink"
        >
          ← Назад к реестру
        </Link>
      </DashboardLayout>
    );
  }

  const object = query.data;
  const version = object.passportVersions.find((v) => v.id === versionId);

  return (
    <DashboardLayout>
      <Link
        href={`/security-ops/objects/${object.id}`}
        className="mb-3 inline-block text-xs font-semibold text-primary-ink"
      >
        ← Назад к паспорту объекта
      </Link>

      {version === undefined ? (
        <Card>
          <CardContent className="p-9 text-center">
            <p className="text-sm text-destructive-ink">{VERSION_NOT_FOUND_TEXT}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            className="mb-4"
            eyebrow="Паспорт объекта"
            title={`${object.name} · версия ${version.versionNumber}`}
            description={`Действует с ${version.effectiveFrom} · опубликовано ${version.publishedAt} · ${version.publishedBy}`}
            actions={
              <span className="inline-flex rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold text-muted-foreground">
                read-only
              </span>
            }
          />

          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {READ_ONLY_HINT}
          </p>

          {version.note !== "" && (
            <Card className="mb-4">
              <CardContent className="p-4">
                <h2 className="mb-1 text-sm font-semibold">
                  Примечание к публикации
                </h2>
                <p className="text-sm text-muted-foreground">{version.note}</p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-4">
            {version.sectors.map((sector) => (
              <Card key={sector.id}>
                <CardContent className="p-4">
                  <h2 className="mb-2 text-sm font-semibold">{sector.name}</h2>
                  {sector.posts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Постов в секторе нет.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {sector.posts.map((post) => (
                        <li key={post.id} className="rounded-md border p-2.5 text-xs">
                          <span className="font-semibold">{post.name}</span>{" "}
                          <span className="text-muted-foreground">
                            {post.task}
                            {post.requirements !== ""
                              ? ` · ${post.requirements}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
