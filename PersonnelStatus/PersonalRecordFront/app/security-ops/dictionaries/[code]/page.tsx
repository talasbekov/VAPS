"use client";

// Карточка справочника: записи со связями (посчитаны сервером поимённо),
// создание, деактивация/активация, удаление. Удаление значения со связями —
// 409 с понятной зависимостью; у неотслеживаемых справочников — 422 с
// причиной (только деактивация).
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateDictionaryEntry,
  useDeleteDictionaryEntry,
  useDictionaryEntries,
  useSetDictionaryEntryActive,
} from "@/hooks/use-dictionaries";
import type { DictionaryEntryView } from "@/entities/dictionary";

export default function DictionaryDetailPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";
  const query = useDictionaryEntries(code);

  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const create = useCreateDictionaryEntry(code, {
    onFormError: (details) => setFieldErrors(details),
  });
  const setActive = useSetDictionaryEntryActive();
  const remove = useDeleteDictionaryEntry();

  const mutationError = create.error ?? setActive.error ?? remove.error;
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Тот же код, что у списка справочников: карточка достижима по прямой
  // ссылке в обход списка, и без гварда она открывалась любому.
  if (!permissionsLoading && !hasPermission("dictionary.view")) {
    return <OpsAccessDenied what="справочника" />;
  }

  return (
    <DashboardLayout>
      <Link
        href="/security-ops/dictionaries"
        className="mb-3 inline-block text-xs font-semibold text-primary-ink"
      >
        ← Назад к справочникам
      </Link>

      <div className="mb-4">
        <PageHeader
          eyebrow="Администрирование"
          title={code}
          description="Значения и их связи; удаление возможно только при доказанном отсутствии связей."
        />
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка записей…</p>
      )}
      {query.isError && (
        <p className="text-sm text-destructive-ink">
          Справочник не найден или недоступен.
        </p>
      )}

      {query.data !== undefined && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {query.data.results.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                onToggle={(isActive) =>
                  setActive.mutate({ entryId: entry.id, isActive })
                }
                onDelete={() => remove.mutate({ entryId: entry.id })}
              />
            ))}
          </div>

          {mutationError !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              {mutationError.message}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Добавить значение</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="entry-code">Код *</Label>
                <Input
                  id="entry-code"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="entry-label">Название *</Label>
                <Input
                  id="entry-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              {code === "POST_REQUIREMENTS" && (
                <div className="space-y-1">
                  <Label htmlFor="entry-group">Группа (код)</Label>
                  <Input
                    id="entry-group"
                    placeholder="ACCESS"
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                  />
                </div>
              )}
              <Button
                type="button"
                disabled={create.isPending}
                onClick={() => {
                  setFieldErrors(null);
                  create.mutate({
                    code: newCode,
                    label: newLabel,
                    description: "",
                    groupCode: newGroup === "" ? null : newGroup,
                  });
                  setNewCode("");
                  setNewLabel("");
                  setNewGroup("");
                }}
              >
                {create.isPending ? "Добавление…" : "Добавить"}
              </Button>
              {fieldErrors !== null && Object.keys(fieldErrors).length > 0 && (
                <ul
                  className="w-full list-disc pl-5 text-xs text-destructive-ink"
                  role="alert"
                >
                  {Object.entries(fieldErrors).map(([field, value]) => (
                    <li key={field}>
                      {field}:{" "}
                      {Array.isArray(value) ? String(value[0]) : String(value)}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}

function EntryCard({
  entry,
  onToggle,
  onDelete,
}: {
  entry: DictionaryEntryView;
  onToggle: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Card className={entry.isActive ? "" : "opacity-70"}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {entry.code}
          </span>
          <span className="font-semibold">{entry.label}</span>
          {entry.groupCode !== null && (
            <Badge variant="outline">группа: {entry.groupCode}</Badge>
          )}
          <Badge
            className={
              entry.isActive
                ? "bg-green-100 text-green-800 hover:bg-green-100"
                : "bg-muted text-muted-foreground hover:bg-muted"
            }
          >
            {entry.isActive ? "Активна" : "Неактивна"}
          </Badge>
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onToggle(!entry.isActive)}
            >
              {entry.isActive ? "Деактивировать" : "Активировать"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDelete}>
              Удалить
            </Button>
          </div>
        </div>
        <UsageLine entry={entry} />
      </CardContent>
    </Card>
  );
}

function UsageLine({ entry }: { entry: DictionaryEntryView }) {
  const { usage } = entry;
  if (usage.status === "TRACKED") {
    if (usage.totalCount === 0) {
      return (
        <p className="mt-1 text-xs text-muted-foreground">
          Связей нет — значение можно удалить.
        </p>
      );
    }
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Используется ({usage.totalCount}):{" "}
        {usage.references
          .map((ref) => `${ref.sourceLabel} — ${ref.samples.join(", ")}`)
          .join("; ")}
      </p>
    );
  }
  // NOT_TRACKED / UNKNOWN: причина вместо числа — ноль был бы утверждением
  // «удалять безопасно»
  return (
    <p className="mt-1 text-xs text-amber-700">{usage.reason}</p>
  );
}
