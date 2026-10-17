"use client";

/**
 * Кадровый справочник: должности или звания (Plane №274, Ш-1).
 *
 * Заказчик просил, чтобы в модуле «Справочники» были ВСЕ реально используемые
 * справочники «с возможностью Добавлять, удалять, редактировать». Должности и
 * звания жили только в чтении — ручки были закрыты подписью «Только GET для
 * API». Запись открыта под тем же правом, что и у справочников ОМ, —
 * решение заказчика 28.08.2026.
 *
 * Экран ОДИН на оба справочника: поля у них одинаковы (название, код,
 * уровень), и две копии разошлись бы на первой же правке.
 *
 * Жизненный цикл (UC-REF-001): исправление чинит написание, замена заводит
 * преемника и закрывает прежнюю строку датой, удаление — развилка исхода
 * (без связей безвозвратно, со связями деактивация). Исход называется
 * В ОКНЕ подтверждения до нажатия.
 */
import { DictionaryReviewTable, DictionarySimilarityDialog } from "@/components/dictionary-review";
import type { StaffDictionaryWrite } from "@/entities/staff-dictionary";
import { OpsApiError } from "@/lib/ops-errors";
import { LoadFailure } from "@/components/load-failure";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DictionariesWorkspace } from "@/features/dictionaries-workspace/ui/DictionariesWorkspace";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
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
  useCreateStaffDictionaryRow,
  useDeleteStaffDictionaryRow,
  useSetStaffDictionaryRowActive,
  useStaffDictionary,
  useSupersedeStaffDictionaryRow,
  useUpdateStaffDictionaryRow,
} from "@/hooks/use-staff-dictionaries";
import {
  staffDictionaryOf,
  type StaffDictionaryRow,
} from "@/entities/staff-dictionary";

export default function StaffDictionaryPage() {
  const params = useParams<{ kind: string }>();
  const kind = params?.kind ?? "";
  const meta = staffDictionaryOf(kind);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const query = useStaffDictionary(kind);
  const create = useCreateStaffDictionaryRow(kind);
  const update = useUpdateStaffDictionaryRow(kind);
  const remove = useDeleteStaffDictionaryRow(kind);
  const setActive = useSetStaffDictionaryRowActive(kind);
  const supersede = useSupersedeStaffDictionaryRow(kind);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingCreate, setPendingCreate] = useState<StaffDictionaryWrite | null>(null);
  const [name, setName] = useState("");
  const [nameKk, setNameKk] = useState("");
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  // Удаление и замена спрашивают подтверждение: исход у них разный (удалить
  // безвозвратно либо деактивировать), и кнопка без окна врала бы о нём.
  const [removing, setRemoving] = useState<StaffDictionaryRow | null>(null);
  const [replacing, setReplacing] = useState<StaffDictionaryRow | null>(null);

  // Значения — отдельное право (UC-REF-001): `dictionary.manage` кнопок не даёт.
  const canManage = hasPermission("dictionary_value.manage");
  // Отказы удаления и замены живут В СВОИХ окнах — здесь только те, которым
  // окна нет.
  const failure = create.error ?? update.error ?? setActive.error;
  const createErrors = fieldErrors(create.error);

  function clearCreation() { setName(""); setNameKk(""); setCode(""); setLevel(""); setPendingCreate(null); }
  async function submitCreation(body: StaffDictionaryWrite) {
    setPendingCreate(body);
    try { const row = await create.mutateAsync(body); clearCreation(); setSelectedId(row.id); }
    catch { /* Keep entered values on any rejected request. */ }
  }

  if (!permissionsLoading && !hasPermission("dictionary.view")) {
    return <OpsAccessDenied what="справочников" />;
  }

  if (meta === null) {
    return (
      <DictionariesWorkspace>
        <div className="space-y-4">
          <PageHeader eyebrow="Система" title="Справочник не найден" />
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Такого кадрового справочника нет.{" "}
              <Link href="/security-ops/dictionaries" className="text-primary-ink">
                Вернуться к списку
              </Link>
            </CardContent>
          </Card>
        </div>
      </DictionariesWorkspace>
    );
  }

  return (
    <DictionariesWorkspace>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Система · Справочники"
          title={meta.label}
          description={meta.description}
        />
        <Link href="/security-ops/dictionaries" className="text-sm text-primary-ink">
          ← Все справочники
        </Link>

        {query.data && <DictionaryReviewTable rows={query.data.map((row) => ({ id: row.id, code: row.code, name: row.name, nameKk: row.name_kk, active: row.is_active, count: row.usage.totalCount, inactiveSince: row.inactive_since, lastChange: row.lastChange, successor: row.superseded_by }))} onSelect={(id) => setSelectedId(Number(id))} />}
        <DictionarySimilarityDialog error={create.error} pending={create.isPending} onCancel={() => create.reset()} onConfirm={() => { if (pendingCreate) void submitCreation({ ...pendingCreate, confirmSimilar: true }); }} onUse={(id) => { create.reset(); clearCreation(); setSelectedId(Number(id)); }} />
        {query.isLoading && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка…
            </CardContent>
          </Card>
        )}

        {query.isError && <LoadFailure what="справочник" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
        {query.data !== undefined && (
          <div className="flex flex-col gap-3">
            {query.data.length === 0 && (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Значений нет.
                </CardContent>
              </Card>
            )}
            {query.data.filter((row) => row.id === selectedId).map((row) => (
              <RowCard
                key={row.id}
                row={row}
                canManage={canManage}
                isEditing={editing === row.id}
                isSaving={update.isPending}
                errors={fieldErrors(update.error)}
                onEdit={() => { update.reset(); setEditing(row.id); }}
                onCancel={() => setEditing(null)}
                onSave={async (values) => {
                  try {
                    await update.mutateAsync({ ...values, id: row.id });
                    setEditing(null);
                  } catch { /* Errors remain beside the fields. */ }
                }}
                onToggleActive={(is_active) =>
                  setActive.mutate({ id: row.id, is_active })
                }
                onRemoveRequest={() => {
                  // Отказ прошлой попытки чужой строке не принадлежит.
                  remove.reset();
                  setRemoving(row);
                }}
                onReplaceRequest={() => {
                  supersede.reset();
                  setReplacing(row);
                }}
              />
            ))}
          </div>
        )}

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
                  ? `«${removing.name}»: связей нет, значение будет удалено безвозвратно; след останется только в журнале действий.`
                  : removing !== null
                    ? `«${removing.name}» используется (${removing.usage.totalCount}): ${removing.usage.references
                        .map((ref) => `${ref.sourceLabel} — ${ref.samples.join(", ")}`)
                        .join("; ")}. Удалить нельзя: значение будет деактивировано с сегодняшней датой и останется в старых данных.`
                    : ""}
              </DialogDescription>
            </DialogHeader>
            {remove.error != null && (
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
                disabled={remove.isPending || removing === null}
                onClick={() => {
                  if (removing === null) return;
                  // Окно закрывает ОТВЕТ сервера, а не нажатие: отказ должен
                  // остаться виден на месте.
                  remove.mutate(
                    { id: removing.id },
                    { onSuccess: () => setRemoving(null) }
                  );
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

        <ReplaceRowDialog
          row={replacing}
          isPending={supersede.isPending}
          failure={supersede.error}
          onCancel={() => setReplacing(null)}
          onSubmit={(values) => {
            if (replacing === null) return;
            supersede.mutate(
              { id: replacing.id, ...values },
              { onSuccess: () => setReplacing(null) }
            );
          }}
        />

        {/* Отказ сервера показывается ЦЕЛИКОМ: он объясняет, почему нельзя
            («Должность используется в штатном расписании (12)»), и своё
            «не получилось» на его месте было бы шагом назад. */}
        {failure != null && (
          <p className="text-sm text-destructive-ink" role="alert">
            {failure.message}
          </p>
        )}

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>Добавить значение</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="new-name">Название</Label>
                  <Input
                    id="new-name"
                    aria-invalid={Boolean(createErrors.name)}
                    aria-describedby={createErrors.name ? "new-name-error" : undefined}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {createErrors.name && <p id="new-name-error" role="alert" className="text-sm text-destructive-ink">{createErrors.name}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-name-kk">Название (kk)</Label>
                  <Input
                    id="new-name-kk"
                    maxLength={255}
                    value={nameKk}
                    onChange={(e) => setNameKk(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-code">Код</Label>
                  <Input
                    id="new-code"
                    aria-invalid={Boolean(createErrors.code)}
                    aria-describedby={createErrors.code ? "new-code-error" : undefined}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  {createErrors.code && <p id="new-code-error" role="alert" className="text-sm text-destructive-ink">{createErrors.code}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-level">Уровень</Label>
                  <Input
                    id="new-level"
                    aria-invalid={Boolean(createErrors.level)}
                    aria-describedby={createErrors.level ? "new-level-error" : undefined}
                    inputMode="numeric"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  />
                  {createErrors.level && <p id="new-level-error" role="alert" className="text-sm text-destructive-ink">{createErrors.level}</p>}
                  <p className="text-xs text-muted-foreground">
                    Чем меньше число, тем выше должность или звание.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={create.isPending}
                  onClick={() => void submitCreation({ name, name_kk: nameKk, code, level: level.trim() === "" ? 0 : Number(level) })}
                >
                  {create.isPending ? "Добавление…" : "Добавить"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DictionariesWorkspace>
  );
}

function RowCard({
  row,
  canManage,
  isEditing,
  isSaving,
  onEdit,
  onCancel,
  onSave,
  onToggleActive,
  onRemoveRequest,
  onReplaceRequest,
  errors,
}: {
  row: StaffDictionaryRow;
  errors: Record<string, string>;
  canManage: boolean;
  isEditing: boolean;
  isSaving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (values: { name: string; name_kk: string; code: string; level: number }) => Promise<void>;
  onToggleActive: (isActive: boolean) => void;
  onRemoveRequest: () => void;
  onReplaceRequest: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [nameKk, setNameKk] = useState(row.name_kk ?? "");
  const [level, setLevel] = useState(String(row.level));

  if (isEditing) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Код не правится — на него ссылается контракт бэка
                (`position_code`, `rank_code`), и смена оборвала бы ссылки. */}
            <span className="font-mono text-xs text-muted-foreground">
              {row.code}
            </span>
            <span className="text-xs text-muted-foreground">
              код не меняется — по нему ссылается штатка
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`name-${row.id}`}>Название</Label>
              <Input
                id={`name-${row.id}`}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? `name-${row.id}-error` : undefined}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && <p id={`name-${row.id}-error`} role="alert" className="text-sm text-destructive-ink">{errors.name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`name-kk-${row.id}`}>Название (kk)</Label>
              <Input
                id={`name-kk-${row.id}`}
                maxLength={255}
                value={nameKk}
                onChange={(e) => setNameKk(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`level-${row.id}`}>Уровень</Label>
              <Input
                id={`level-${row.id}`}
                aria-invalid={Boolean(errors.level)}
                aria-describedby={errors.level ? `level-${row.id}-error` : undefined}
                inputMode="numeric"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              />
              {errors.level && <p id={`level-${row.id}-error`} role="alert" className="text-sm text-destructive-ink">{errors.level}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={() => {
                setName(row.name);
                setNameKk(row.name_kk ?? "");
                setLevel(String(row.level));
                onCancel();
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
                  name,
                  name_kk: nameKk,
                  code: row.code,
                  level: level.trim() === "" ? 0 : Number(level),
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

  const isActive = row.is_active !== false;
  return (
    <Card className={isActive ? "" : "opacity-70"}>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
        <span className="font-semibold">{row.name}</span>
        {(row.name_kk ?? "") !== "" && (
          <span className="text-sm text-muted-foreground">{row.name_kk}</span>
        )}
        <span className="text-xs text-muted-foreground">
          уровень {row.level}
        </span>
        <Badge
          className={
            isActive
              ? "bg-green-100 text-green-800 hover:bg-green-100"
              : "bg-muted text-muted-foreground hover:bg-muted"
          }
        >
          {isActive
            ? "Активна"
            : row.inactive_since
              ? `Неактивна с ${new Date(row.inactive_since).toLocaleDateString("ru-RU")}`
              : "Неактивна"}
        </Badge>
        {/* Ответ несёт только НОМЕР преемника — показываем его как #id, а не
            выдумываем код, которого в ответе нет. */}
        {row.superseded_by != null && (
          <Badge variant="outline">заменена на #{row.superseded_by}</Badge>
        )}
        {row.supersedes != null && (
          <Badge variant="outline">заменяет #{row.supersedes}</Badge>
        )}
        {canManage && (
          <div className="ml-auto flex gap-2">
            {/* У строки с преемником возвращать и заменять нечего: её место
                занято, и обе кнопки вели бы к отказу сервера. */}
            {row.superseded_by == null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onToggleActive(!isActive)}
              >
                {isActive ? "Деактивировать" : "Активировать"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={!isActive} onClick={onEdit}>
              Корректировать
            </Button>
            {row.superseded_by == null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isActive}
                onClick={onReplaceRequest}
              >
                Заменить
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onRemoveRequest}>
              Удалить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Замена строки преемником (UC-REF-001). Отдельная форма, а не правка:
 * правка чинит написание той же должности или звания, замена заводит ДРУГУЮ —
 * с новым кодом, а прежняя закрывается для выбора и остаётся в штатке.
 */
function ReplaceRowDialog({
  row,
  isPending,
  failure,
  onCancel,
  onSubmit,
}: {
  row: StaffDictionaryRow | null;
  isPending: boolean;
  failure: Error | null;
  onCancel: () => void;
  onSubmit: (values: {
    name: string;
    name_kk: string;
    code: string;
    level: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [nameKk, setNameKk] = useState("");
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("");
  useEffect(() => {
    setName(row?.name ?? "");
    setNameKk(row?.name_kk ?? "");
    // Код пуст намеренно: он у преемника СВОЙ, и подставленный старый ушёл бы
    // на сервер как занятый.
    setCode("");
    setLevel(row === null ? "" : String(row.level));
  }, [row]);
  const errors = fieldErrors(failure);
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Заменить {row?.code}</DialogTitle>
          <DialogDescription>
            Значение меняется по сути: заводится новая запись с новым кодом, прежняя закрывается
            для выбора с сегодняшней датой и остаётся в старых данных.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="replace-row-name">Название *</Label>
            <Input
              id="replace-row-name"
              aria-invalid={Boolean(errors.name)}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && (
              <p role="alert" className="text-sm text-destructive-ink">{errors.name}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-row-name-kk">Название (kk)</Label>
            <Input
              id="replace-row-name-kk"
              maxLength={255}
              value={nameKk}
              onChange={(e) => setNameKk(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-row-code">Код *</Label>
            <Input
              id="replace-row-code"
              aria-invalid={Boolean(errors.code)}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {errors.code && (
              <p role="alert" className="text-sm text-destructive-ink">{errors.code}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="replace-row-level">Уровень *</Label>
            <Input
              id="replace-row-level"
              aria-invalid={Boolean(errors.level)}
              inputMode="numeric"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
            {errors.level && (
              <p role="alert" className="text-sm text-destructive-ink">{errors.level}</p>
            )}
          </div>
        </div>
        {failure != null && (
          <p className="text-sm text-destructive-ink" role="alert">
            {failure.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            disabled={isPending}
            onClick={() =>
              onSubmit({
                name,
                name_kk: nameKk,
                code,
                level: level.trim() === "" ? 0 : Number(level),
              })
            }
          >
            {isPending ? "Замена…" : "Заменить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof OpsApiError)) return {};
  return Object.fromEntries(Object.entries(error.details).map(([key, value]) =>
    [key, Array.isArray(value) ? value.join(" ") : String(value)]));
}
