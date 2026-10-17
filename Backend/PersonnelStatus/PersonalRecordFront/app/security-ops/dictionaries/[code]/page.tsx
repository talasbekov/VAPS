"use client";

// Карточка справочника: записи со связями (посчитаны сервером поимённо),
// создание, деактивация/активация, исправление, замена преемником и удаление.
// Удаление (UC-REF-001) — не отказ, а развилка исхода: без связей значение
// уходит безвозвратно, со связями деактивируется сегодняшней датой и остаётся
// в старых данных. Исход называется В ОКНЕ подтверждения до нажатия.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DictionariesWorkspace } from "@/features/dictionaries-workspace/ui/DictionariesWorkspace";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateDictionaryEntry,
  useDeleteDictionaryEntry,
  useDictionaryEntries,
  useDictionaries,
  useSetDictionaryEntryActive,
  useSupersedeDictionaryEntry,
  useUpdateDictionaryEntry,
} from "@/hooks/use-dictionaries";
import { DictionaryReviewTable, DictionarySimilarityDialog } from "@/components/dictionary-review";
import type { DictionaryEntryView, CreateDictionaryEntryRequest } from "@/entities/dictionary";
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
  const dutyKinds = code === "SERVICE_DUTY_KINDS";
  const { hasPermission, isLoading: permissionsLoading, error: permissionsError } = useOpsPermissions();
  const canRead = !permissionsLoading && !permissionsError && hasPermission("dictionary.view");
  const query = useDictionaryEntries(code, { enabled: canRead });
  const values = query.visibleData;
  const definitions = useDictionaries({ enabled: canRead });
  const title = canRead ? definitions.data?.results.find((row) => row.code === code)?.label ?? code : "Справочник";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<CreateDictionaryEntryRequest | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newLabelKk, setNewLabelKk] = useState("");
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
  // Удаление и замена спрашивают подтверждение: исход у них разный (удалить
  // безвозвратно либо деактивировать), и кнопка без окна врала бы о нём.
  const [removing, setRemoving] = useState<DictionaryEntryView | null>(null);
  const [replacing, setReplacing] = useState<DictionaryEntryView | null>(null);
  const [replaceErrors, setReplaceErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const supersede = useSupersedeDictionaryEntry({
    onFormError: (details) => setReplaceErrors(details),
  });

  const mutationError =
    create.error ?? setActive.error ?? remove.error ?? update.error ?? supersede.error;
  // Значения — отдельное право (UC-REF-001): `dictionary.manage` кнопок не даёт.
  const canManage = canRead && !query.isError && hasPermission("dictionary_value.manage");
  const divisionsQuery = useQuery<CoreDivision[]>({
    queryKey: ["core-divisions"],
    queryFn: () => apiClient.getCoreDivisions(),
    staleTime: 10 * 60_000,
    enabled: canRead && code === "EVENT_PARTICIPATION_KINDS",
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
  function clearCreation() {
    setNewCode(""); setNewLabel(""); setNewLabelKk(""); setNewGroup(""); setNewOwnerDivisionId("");
    setPendingCreate(null); setFieldErrors(null);
  }
  async function submitCreation(body: CreateDictionaryEntryRequest) {
    if (!canManage || create.isPending) return;
    setPendingCreate(body); setFieldErrors(null);
    try { const row = await create.mutateAsync(body); clearCreation(); setSelectedId(row.id); }
    catch { /* The form and similarity dialog keep the rejected input. */ }
  }
  function createFromForm() {
    if (!canManage || create.isPending || (dutyKinds && !newLabel.trim())) return;
    void submitCreation({
      code: dutyKinds ? "" : newCode, label: newLabel, labelKk: newLabelKk, description: "",
      groupCode: newGroup === "" ? null : newGroup,
      ownerDivisionId: newCode.trim().toUpperCase() === "PHYSICAL_SQUAD" ? null : newOwnerDivisionId || null,
    });
  }

  if (!permissionsLoading && !hasPermission("dictionary.view")) {
    return <OpsAccessDenied what="справочника" />;
  }

  return (
    <DictionariesWorkspace>
      <Link
        href="/security-ops/dictionaries"
        className="mb-3 inline-block text-xs font-semibold text-primary-ink"
      >
        ← Назад к справочникам
      </Link>

      <div className="mb-4">
        <PageHeader
          eyebrow="Система"
          title={title}
          description="Значения и их связи: без связей значение удаляется, со связями — деактивируется с датой; замена заводит запись-преемника."
        />
      </div>

      {permissionsLoading && <p role="status" className="text-sm text-muted-foreground">Проверяем доступ к справочнику…</p>}
      {canRead && query.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка записей…</p>
      )}
      {canRead && query.isError && (
        <LoadFailure what="значения справочника" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
      )}
      {canRead && query.isError && values && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">Показаны ранее загруженные значения. Изменения доступны после успешного обновления.</p>}

      {canRead && values !== undefined && (
        <div className="flex flex-col gap-4">
          <DictionaryReviewTable nameFirst={dutyKinds} rows={values.results.map((entry) => ({ id: entry.id, code: entry.code, name: entry.label, nameKk: entry.labelKk, active: entry.isActive, count: entry.usage.totalCount, tracked: entry.usage.status === "TRACKED", inactiveSince: entry.inactiveSince, lastChange: entry.lastChange, successor: entry.supersededBy?.code, familyCount: entry.replacementFamily?.totalCount }))} onSelect={(id) => setSelectedId(String(id))} />
          <DictionarySimilarityDialog canConfirm={canManage} error={create.error} pending={create.isPending} onCancel={() => create.reset()} onConfirm={() => { if (pendingCreate) void submitCreation({ ...pendingCreate, confirmSimilar: true }); }} onUse={(id) => { create.reset(); clearCreation(); setSelectedId(String(id)); }} />
          <div className="flex flex-col gap-3">
            {values.results.filter((entry) => entry.id === selectedId).map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                canManage={canManage}
                isEditing={editing === entry.id}
                isSaving={update.isPending}
                onEdit={() => {
                  setFieldErrors(null);
                  setEditing(entry.id);
                }}
                onCancelEdit={() => setEditing(null)}
                onSave={async (values) => {
                  if (!canManage) return;
                  await update.mutateAsync({ entryId: entry.id, ...values });
                  setEditing(null);
                }}
                onToggle={(isActive) =>
                  setActive.mutate({ entryId: entry.id, isActive })
                }
                onRemoveRequest={() => {
                  // Отказ прошлой попытки чужой строке не принадлежит.
                  remove.reset();
                  setRemoving(entry);
                }}
                onReplaceRequest={() => {
                  setReplaceErrors(null);
                  setReplacing(entry);
                }}
                divisions={divisions}
              />
            ))}
          </div>

          <Dialog
            open={removing !== null}
            onOpenChange={(open) => {
              if (!open) setRemoving(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Удалить {removing?.code}?</DialogTitle>
                <DialogDescription>
                  {removing !== null && removing.usage.totalCount === 0
                    ? `«${removing.label}»: связей нет, значение будет удалено безвозвратно; след останется только в журнале действий.`
                    : removing !== null
                      ? `«${removing.label}» используется (${removing.usage.totalCount}): ${removing.usage.references
                          .map((ref) => `${ref.sourceLabel} — ${ref.samples.join(", ")}`)
                          .join("; ")}. Удалить нельзя: значение будет деактивировано с сегодняшней датой и останется в старых данных.`
                      : ""}
                </DialogDescription>
              </DialogHeader>
              {remove.error !== null && (
                <p className="text-sm text-destructive-ink" role="alert">
                  {remove.error.message}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoving(null)}>
                  Отмена
                </Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending || removing === null || !canManage}
                  onClick={() => {
                    if (removing === null || !canManage) return;
                    // Окно закрывает ОТВЕТ сервера, а не нажатие: отказ
                    // («нельзя удалить») должен остаться виден на месте.
                    // `mutate` у useOpsMutation опций не принимает — ожидание
                    // выражается mutateAsync.
                    void remove
                      .mutateAsync({ entryId: removing.id })
                      .then(() => setRemoving(null))
                      .catch(() => {
                        /* Отказ остаётся в окне (remove.error). */
                      });
                  }}
                >
                  {remove.isPending
                    ? "Выполняется…"
                    : removing !== null && removing.usage.totalCount > 0
                      ? "Деактивировать"
                      : "Удалить"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <ReplaceDialog
            entry={replacing}
            allowed={canManage}
            isPending={supersede.isPending}
            errors={replaceErrors}
            onCancel={() => setReplacing(null)}
            onSubmit={(values) => {
              if (replacing === null || !canManage) return;
              setReplaceErrors(null);
              // Преемник наследует группу и владельца предшественника: сервер
              // их не домысливает, а форма замены о них не спрашивает.
              void supersede
                .mutateAsync({
                  entryId: replacing.id,
                  ...values,
                  groupCode: replacing.groupCode,
                  ownerDivisionId: replacing.ownerDivisionId ?? null,
                })
                .then(() => setReplacing(null))
                .catch(() => {
                  /* Ошибки полей уже в replaceErrors, прочее — в mutationError. */
                });
            }}
          />

          {mutationError !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              {mutationError.message}
            </p>
          )}

          {canManage && <Card>
            <CardHeader>
              <CardTitle>Добавить значение</CardTitle>
            </CardHeader>
            <CardContent><form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); createFromForm(); }}>
              {!dutyKinds && <div className="space-y-1">
                <Label htmlFor="entry-code">Код *</Label>
                <Input
                  id="entry-code"
                  value={newCode}
                  maxLength={100}
                  disabled={create.isPending}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>}
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="entry-label">Название *</Label>
                <Input
                  id="entry-label"
                  value={newLabel}
                  maxLength={255}
                  required={dutyKinds}
                  disabled={create.isPending}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="entry-label-kk">Название (kk)</Label>
                <Input
                  id="entry-label-kk"
                  maxLength={255}
                  value={newLabelKk}
                  disabled={create.isPending}
                  onChange={(e) => setNewLabelKk(e.target.value)}
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
                type="submit"
                disabled={create.isPending || (dutyKinds && !newLabel.trim())}
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
            </form></CardContent>
          </Card>}
        </div>
      )}
    </DictionariesWorkspace>
  );
}

function EntryCard({
  entry,
  canManage,
  isEditing,
  isSaving,
  onEdit,
  onCancelEdit,
  onSave,
  onToggle,
  onRemoveRequest,
  onReplaceRequest,
  divisions,
}: {
  entry: DictionaryEntryView;
  canManage: boolean;
  isEditing: boolean;
  isSaving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (values: {
    label: string;
    labelKk?: string;
    description: string;
    groupCode?: string | null;
    ownerDivisionId?: string | null;
  }) => Promise<void>;
  onToggle: (isActive: boolean) => void;
  onRemoveRequest: () => void;
  onReplaceRequest: () => void;
  divisions: Array<CoreDivision & { path: string }>;
}) {
  // Черновик правки живёт В КАРТОЧКЕ: он касается одной строки, и хранить его
  // страницей значило бы чистить его на каждом переключении.
  const [label, setLabel] = useState(entry.label);
  const [labelKk, setLabelKk] = useState(entry.labelKk ?? "");
  const [description, setDescription] = useState(entry.description);
  const [groupCode, setGroupCode] = useState(entry.groupCode ?? "");
  const [ownerDivisionId, setOwnerDivisionId] = useState(entry.ownerDivisionId ?? "");

  if (isEditing && canManage) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Код показан, но НЕ правится: на него ссылаются по коду, и
                смена оборвала бы ссылки молча. Прятать его тоже нельзя —
                человек должен видеть, что именно правит. */}
            <span className="max-w-full break-all font-mono text-xs text-muted-foreground">
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
              <Label htmlFor={`label-kk-${entry.id}`}>Название (kk)</Label>
              <Input
                id={`label-kk-${entry.id}`}
                maxLength={255}
                value={labelKk}
                onChange={(e) => setLabelKk(e.target.value)}
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
                setLabelKk(entry.labelKk ?? "");
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
              disabled={isSaving || !canManage}
              onClick={() =>
                void onSave({
                  label,
                  labelKk,
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
          <span className="max-w-full break-all font-mono text-xs text-muted-foreground">
            {entry.code}
          </span>
          <span className="font-semibold">{entry.label}</span>
          {entry.labelKk !== "" && (
            <span className="text-sm text-muted-foreground">{entry.labelKk}</span>
          )}
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
            {entry.isActive
              ? "Активна"
              : entry.inactiveSince
                ? `Неактивна с ${new Date(entry.inactiveSince).toLocaleDateString("ru-RU")}`
                : "Неактивна"}
          </Badge>
          {entry.supersededBy !== null && (
            <Badge variant="outline">заменена на {entry.supersededBy.code}</Badge>
          )}
          {entry.supersedes !== null && (
            <Badge variant="outline">заменяет {entry.supersedes.code}</Badge>
          )}
          {canManage && <div className="ml-auto flex max-w-full flex-wrap gap-2">
            {/* У записи с преемником возвращать и заменять нечего: её место
                занято, и обе кнопки вели бы к отказу сервера. */}
            {entry.supersededBy === null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onToggle(!entry.isActive)}
              >
                {entry.isActive ? "Деактивировать" : "Активировать"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={!entry.isActive} onClick={onEdit}>
              Корректировать
            </Button>
            {entry.supersededBy === null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!entry.isActive}
                onClick={onReplaceRequest}
              >
                Заменить
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onRemoveRequest}>
              Удалить
            </Button>
          </div>}
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

/**
 * Замена значения преемником (UC-REF-001). Отдельная форма, а не правка:
 * правка чинит написание того же значения, замена заводит ДРУГОЕ — с новым
 * кодом, а прежнее закрывается для выбора и остаётся в старых данных.
 */
function ReplaceDialog({
  entry,
  allowed,
  isPending,
  errors,
  onCancel,
  onSubmit,
}: {
  entry: DictionaryEntryView | null;
  allowed: boolean;
  isPending: boolean;
  errors: Record<string, unknown> | null;
  onCancel: () => void;
  onSubmit: (values: {
    code: string;
    label: string;
    labelKk: string;
    description: string;
  }) => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [labelKk, setLabelKk] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    // Код пуст намеренно: он у преемника СВОЙ, и подставленный старый ушёл бы
    // на сервер как занятый.
    setCode("");
    setLabel(entry?.label ?? "");
    setLabelKk(entry?.labelKk ?? "");
    setDescription(entry?.description ?? "");
  }, [entry]);
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Заменить {entry?.code}</DialogTitle>
          <DialogDescription>
            Значение меняется по сути: заводится новая запись с новым кодом, прежняя закрывается
            для выбора с сегодняшней датой и остаётся в старых данных.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="replace-code">Новый код *</Label>
            <Input id="replace-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-label">Название *</Label>
            <Input id="replace-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-label-kk">Название (kk)</Label>
            <Input
              id="replace-label-kk"
              maxLength={255}
              value={labelKk}
              onChange={(e) => setLabelKk(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-description">Описание</Label>
            <Input
              id="replace-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {errors !== null && Object.keys(errors).length > 0 && (
          <ul className="list-disc pl-5 text-xs text-destructive-ink" role="alert">
            {Object.entries(errors).map(([field, value]) => (
              <li key={field}>
                {field}: {Array.isArray(value) ? String(value[0]) : String(value)}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button disabled={isPending || !allowed} onClick={() => onSubmit({ code, label, labelKk, description })}>
            {isPending ? "Замена…" : "Заменить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
