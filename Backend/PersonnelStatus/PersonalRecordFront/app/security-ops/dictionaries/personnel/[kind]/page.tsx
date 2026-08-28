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
 */
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateStaffDictionaryRow,
  useDeleteStaffDictionaryRow,
  useStaffDictionary,
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

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("");
  const [editing, setEditing] = useState<number | null>(null);

  const canManage = hasPermission("dictionary.manage");
  const failure = create.error ?? update.error ?? remove.error;

  if (!permissionsLoading && !hasPermission("dictionary.view")) {
    return <OpsAccessDenied what="справочников" />;
  }

  if (meta === null) {
    return (
      <DashboardLayout>
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
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Система · Справочники"
          title={meta.label}
          description={meta.description}
        />
        <Link href="/security-ops/dictionaries" className="text-sm text-primary-ink">
          ← Все справочники
        </Link>

        {query.isLoading && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка…
            </CardContent>
          </Card>
        )}

        {query.data !== undefined && (
          <div className="flex flex-col gap-3">
            {query.data.length === 0 && (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Значений нет.
                </CardContent>
              </Card>
            )}
            {query.data.map((row) => (
              <RowCard
                key={row.id}
                row={row}
                canManage={canManage}
                isEditing={editing === row.id}
                isSaving={update.isPending}
                onEdit={() => setEditing(row.id)}
                onCancel={() => setEditing(null)}
                onSave={async (values) => {
                  await update.mutateAsync({ ...values, id: row.id });
                  setEditing(null);
                }}
                onDelete={() => remove.mutate({ id: row.id })}
              />
            ))}
          </div>
        )}

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
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="new-name">Название</Label>
                  <Input
                    id="new-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-code">Код</Label>
                  <Input
                    id="new-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-level">Уровень</Label>
                  <Input
                    id="new-level"
                    inputMode="numeric"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Чем меньше число, тем выше должность или звание.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={create.isPending}
                  onClick={async () => {
                    await create.mutateAsync({
                      name,
                      code,
                      level: Number(level) || 0,
                    });
                    setName("");
                    setCode("");
                    setLevel("");
                  }}
                >
                  {create.isPending ? "Добавление…" : "Добавить"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
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
  onDelete,
}: {
  row: StaffDictionaryRow;
  canManage: boolean;
  isEditing: boolean;
  isSaving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (values: { name: string; code: string; level: number }) => Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(row.name);
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
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`level-${row.id}`}>Уровень</Label>
              <Input
                id={`level-${row.id}`}
                inputMode="numeric"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              />
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
                  code: row.code,
                  level: Number(level) || row.level,
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
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
        <span className="font-semibold">{row.name}</span>
        <span className="text-xs text-muted-foreground">
          уровень {row.level}
        </span>
        {canManage && (
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              Редактировать
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDelete}>
              Удалить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
