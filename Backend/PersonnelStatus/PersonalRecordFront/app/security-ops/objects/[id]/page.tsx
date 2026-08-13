"use client";

// Паспорт объекта: карточка, редактируемые секторы/посты и история версий.
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { useSecurityObject } from "@/hooks/use-security-objects";
import { PassportForm, PassportVersionsPanel } from "@/features/object-passport";
import { DutyForcesSection } from "@/features/object-duty-forces";

export default function SecurityObjectPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const query = useSecurityObject(id);

  if (query.isLoading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка объекта…</p>
      </DashboardLayout>
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-destructive">Объект не найден или недоступен.</p>
        <Link
          href="/security-ops/objects"
          className="mt-2 inline-block text-sm font-semibold text-primary"
        >
          ← Назад к реестру
        </Link>
      </DashboardLayout>
    );
  }

  const object = query.data;

  return (
    <DashboardLayout>
      <Link
        href="/security-ops/objects"
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к реестру
      </Link>

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-1 flex gap-1.5">
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold">
              {object.code}
            </span>
          </div>
          <h1 className="text-xl font-bold">{object.name}</h1>
          <p className="text-sm text-muted-foreground">
            {object.type} · {object.region} · {object.address}
          </p>
        </CardContent>
      </Card>

      <DutyForcesSection objectId={object.id} />

      {/* key по updatedAt: успешное сохранение/публикация пересоздаёт форму
          от свежего серверного состояния */}
      <PassportForm
        key={object.updatedAt}
        objectId={object.id}
        sectors={object.sectors}
      />

      <PassportVersionsPanel
        key={`versions-${object.updatedAt}`}
        objectId={object.id}
        versions={object.passportVersions}
        hasPosts={object.sectors.some((sector) => sector.posts.length > 0)}
      />
    </DashboardLayout>
  );
}
