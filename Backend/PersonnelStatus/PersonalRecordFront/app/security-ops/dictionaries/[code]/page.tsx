"use client";

// Карточка справочника: записи со связями (посчитаны сервером поимённо),
// создание, деактивация/активация, удаление. Удаление значения со связями —
// 409 с понятной зависимостью; у неотслеживаемых справочников — 422 с
// причиной (только деактивация).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  useUpdateDictionaryEntry,
} from "@/hooks/use-dictionaries";
import type { DictionaryEntryView } from "@/entities/dictionary";
import { apiClient, type CoreDivision } from "@/lib/api";

function divisionPath(rows: CoreDivision[], id: number): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const names: string[] = [];
  const visited = new Set<number>();
  let current = byId.get(id);
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    names.push(current.name);
    current = current.parent === null ? undefined : byId.get(current.parent);
  }
  return names.reverse().join(" / ");
}

export default function DictionaryDetailPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code ?? "";
  const query = useDictionaryEntries(code);

  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [newOwnerDivisionId, setNewOwnerDivisionId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const create = useCreateDictionaryEntry(code, {
    onFormError: (details) => setFieldErrors(details),
  });
  const setActive = useSetDictionaryEntryActive();
  const remove = useDeleteDictionaryEntry();
  // Правка значения (Plane №274): заказчик просил у модуля все три действия,
  // а была только пара «завести — удалить».
  const update = useUpdateDictionaryEntry({
    onFormError: (details) => setFieldErrors(details),
  });
  const [editing, setEditing] = useState<string | null>(null);

  const mutationError =
    create.error ?? setActive.error ?? remove.error ?? update.error;
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const divisionsQuery = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
    enabled: code === "EVENT_PARTICIPATION_KINDS",
  });
  const divisions = useMemo(
    () =>
      (divisionsQuery.data ?? [])
        .filter((row) => row.is_active)
        .map((row) => ({ ...row, path: divisionPath(divisionsQuery.data ?? [], row.id) }))
        .sort((a, b) => a.path.localeCompare(b.path, "ru")),
    [divisionsQuery.data]
  );

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
          eyebrow="Система"
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
                isEditing={editing === entry.id}
                isSaving={update.isPending}
                onEdit={() => {
                  setFieldErrors(null);
                  setEditing(entry.id);
                }}
                onCancelEdit={() => setEditing(null)}
                onSave={async (values) => {
                  await update.mutateAsync({ entryId: entry.id, ...values });
                  setEditing(null);
                }}
                onToggle={(isActive) =>
                  setActive.mutate({ entryId: entry.id, isActive })
                }
                onDelete={() => remove.mutate({ entryId: entry.id })}
                divisions={divisions}
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
              {code === "EVENT_PARTICIPATION_KINDS" &&
                newCode.trim().toUpperCase() !== "PHYSICAL_SQUAD" && (
                  <div className="min-w-72 flex-1 space-y-1">
                    <Label htmlFor="entry-owner">Подразделение-владелец *</Label>
                    <select
                      id="entry-owner"
                      className="bg-background h-11 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={newOwnerDivisionId}
                      onChange={(event) => setNewOwnerDivisionId(event.target.value)}
                    >
                      <option value="">Выберите подразделение</option>
                      {divisions.map((division) => (
                        <option key={division.id} value={division.id}>{division.path}</option>
                      ))}
                    </select>
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
                    ownerDivisionId:
                      newCode.trim().toUpperCase() === "PHYSICAL_SQUAD"
                        ? null
                        : newOwnerDivisionId || null,
                  });
                  setNewCode("");
                  setNewLabel("");
                  setNewGroup("");
                  setNewOwnerDivisionId("");
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
  isEditing,
  isSaving,
  onEdit,
  onCancelEdit,
  onSave,
  onToggle,
  onDelete,
  divisions,
}: {
  entry: DictionaryEntryView;
  isEditing: boolean;
  isSaving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (values: {
    label: string;
    description: string;
    groupCode?: string | null;
    ownerDivisionId?: string | null;
  }) => Promise<void>;
  onToggle: (isActive: boolean) => void;
  onDelete: () => void;
  divisions: Array<CoreDivision & { path: string }>;
}) {
  // Черновик правки живёт В КАРТОЧКЕ: он касается одной строки, и хранить его
  // страницей значило бы чистить его на каждом переключении.
  const [label, setLabel] = useState(entry.label);
  const [description, setDescription] = useState(entry.description);
  const [groupCode, setGroupCode] = useState(entry.groupCode ?? "");
  const [ownerDivisionId, setOwnerDivisionId] = useState(entry.ownerDivisionId ?? "");

  if (isEditing) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Код показан, но НЕ правится: на него ссылаются по коду, и
                смена оборвала бы ссылки молча. Прятать его тоже нельзя —
                человек должен видеть, что именно правит. */}
            <span className="font-mono text-xs text-muted-foreground">
              {entry.code}
            </span>
            <span className="text-xs text-muted-foreground">
              код не меняется — на него ссылаются записи
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`label-${entry.id}`}>Название</Label>
              <Input
                id={`label-${entry.id}`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`descr-${entry.id}`}>Описание</Label>
              <Input
                id={`descr-${entry.id}`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {entry.groupCode !== null && (
              <div className="space-y-1">
                <Label htmlFor={`group-${entry.id}`}>Группа</Label>
                <Input
                  id={`group-${entry.id}`}
                  value={groupCode}
                  onChange={(e) => setGroupCode(e.target.value)}
                />
              </div>
            )}
            {entry.dictionaryCode === "EVENT_PARTICIPATION_KINDS" &&
              entry.code !== "PHYSICAL_SQUAD" && (
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor={`owner-${entry.id}`}>Подразделение-владелец</Label>
                  <select
                    id={`owner-${entry.id}`}
                    className="bg-background h-11 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={ownerDivisionId}
                    onChange={(event) => setOwnerDivisionId(event.target.value)}
                  >
                    <option value="">Выберите подразделение</option>
                    {divisions.map((division) => (
                      <option key={division.id} value={division.id}>{division.path}</option>
                    ))}
                  </select>
                </div>
              )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={() => {
                setLabel(entry.label);
                setDescription(entry.description);
                setGroupCode(entry.groupCode ?? "");
                setOwnerDivisionId(entry.ownerDivisionId ?? "");
                onCancelEdit();
              }}
            >
              Отмена
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSaving}
              onClick={() =>
                void onSave({
                  label,
                  description,
                  groupCode: entry.groupCode !== null ? groupCode : undefined,
                  ownerDivisionId:
                    entry.dictionaryCode === "EVENT_PARTICIPATION_KINDS" &&
                    entry.code !== "PHYSICAL_SQUAD"
                      ? ownerDivisionId || null
                      : undefined,
                })
              }
            >
              {isSaving ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

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
          {entry.ownerDivisionPath && (
            <Badge variant="outline">владелец: {entry.ownerDivisionPath}</Badge>
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
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              Редактировать
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
