"use client";

// Маршрут согласования расстановки — в «Администрировании» (`[СОГ-05]`,
// Plane №429). Последовательный список подписантов: роль (должность),
// подразделение, учётка. Объект посещения получает КОПИЮ маршрута при выходе
// на «Согласование»; правка здесь идущие согласования не трогает.
//
// Редактор — строки в порядке подписи; порядок и есть смысл, поэтому
// сохраняется список целиком (PUT), а не строка за строкой.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApprovalRoute, useReplaceApprovalRoute } from "@/hooks/use-ops-settings";
import type { ApprovalRouteStepInput } from "@/entities/policy-setting";

const EMPTY: ApprovalRouteStepInput = { roleLabel: "", unit: "", username: "", fullName: "" };

export function ApprovalRouteCard({ canManage }: { canManage: boolean }) {
  const query = useApprovalRoute();
  const [rows, setRows] = useState<ApprovalRouteStepInput[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const replace = useReplaceApprovalRoute({
    onFormError: (details) => {
      const steps = (details as { steps?: string[] }).steps;
      setError(steps?.[0] ?? "Проверьте заполнение маршрута.");
    },
    onSaved: () => {
      setDirty(false);
      setSaved(true);
    },
  });

  useEffect(() => {
    if (query.data !== undefined && !dirty) {
      setRows(
        query.data.results.map((step) => ({
          roleLabel: step.roleLabel,
          unit: step.unit,
          username: step.username,
          fullName: step.fullName,
        }))
      );
    }
  }, [query.data, dirty]);

  const canEdit = canManage && query.data !== undefined && !query.isError
    && !query.isFetching && !replace.isPending;
  const saveError = error ?? (replace.error
    ? "Не удалось сохранить маршрут. Изменения остаются в форме. Повторите попытку."
    : null);

  const update = (index: number, patch: Partial<ApprovalRouteStepInput>) => {
    if (!canEdit) return;
    setDirty(true);
    setSaved(false);
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const move = (index: number, delta: number) => {
    if (!canEdit) return;
    setDirty(true);
    setSaved(false);
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <Card data-slot="approval-route-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Маршрут согласования расстановки
          <span className="text-xs font-normal text-muted-foreground">
            последовательно; объект получает копию при выходе на «Согласование»
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending && <p className="text-sm text-muted-foreground">Загрузка маршрута…</p>}
        {query.isError && (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <p className="text-sm text-red-700">Маршрут сейчас недоступен. Повторите загрузку.</p>
            <Button type="button" size="sm" variant="outline"
              disabled={query.isFetching} onClick={() => void query.refetch()}>
              {query.isFetching ? "Загружаем…" : "Повторить загрузку"}
            </Button>
          </div>
        )}
        {query.data !== undefined && !query.isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground" data-slot="approval-route-none">
            Подписантов нет — отправить расстановку на согласование будет некому.
          </p>
        )}
        {rows.length > 0 && (
          <ol className="flex flex-col gap-2" aria-label="Шаги маршрута согласования">
            {rows.map((row, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                <span className="w-5 pb-2 text-sm font-semibold tabular-nums">{index + 1}.</span>
                <label className="flex-1 text-[11px] font-bold uppercase text-muted-foreground">
                  Роль (должность) *
                  <Input
                    className="mt-0.5 h-8 text-xs"
                    aria-label={`Роль подписанта ${index + 1}`}
                    value={row.roleLabel}
                    disabled={!canEdit}
                    onChange={(e) => update(index, { roleLabel: e.target.value })}
                  />
                </label>
                <label className="w-44 text-[11px] font-bold uppercase text-muted-foreground">
                  Подразделение
                  <Input
                    className="mt-0.5 h-8 text-xs"
                    aria-label={`Подразделение подписанта ${index + 1}`}
                    value={row.unit}
                    disabled={!canEdit}
                    onChange={(e) => update(index, { unit: e.target.value })}
                  />
                </label>
                <label className="w-40 text-[11px] font-bold uppercase text-muted-foreground">
                  Учётка
                  <Input
                    className="mt-0.5 h-8 text-xs"
                    aria-label={`Учётка подписанта ${index + 1}`}
                    placeholder="без привязки"
                    value={row.username}
                    disabled={!canEdit}
                    onChange={(e) => update(index, { username: e.target.value })}
                  />
                </label>
                {row.fullName !== "" && (
                  <span className="pb-2 text-xs text-muted-foreground">{row.fullName}</span>
                )}
                {canManage && (
                  <span className="flex gap-1 pb-1">
                    <button
                      type="button"
                      className="rounded px-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                      aria-label={`Выше: шаг ${index + 1}`}
                      disabled={!canEdit || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="rounded px-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                      aria-label={`Ниже: шаг ${index + 1}`}
                      disabled={!canEdit || index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      className="rounded px-1 text-muted-foreground hover:bg-muted"
                      aria-label={`Снять шаг ${index + 1}`}
                      disabled={!canEdit}
                      onClick={() => {
                        if (!canEdit) return;
                        setDirty(true);
                        setSaved(false);
                        setRows((prev) => prev.filter((_, i) => i !== index));
                      }}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canEdit}
              onClick={() => {
                if (!canEdit) return;
                setDirty(true);
                setSaved(false);
                setRows((prev) => [...prev, { ...EMPTY }]);
              }}
            >
              + Добавить подписанта
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || !canEdit}
              aria-busy={replace.isPending}
              onClick={() => {
                if (!canEdit || !dirty) return;
                setSaved(false);
                setError(null);
                replace.mutate({ steps: rows });
              }}
            >
              {replace.isPending ? "Сохраняем…" : "Сохранить маршрут"}
            </Button>
            {saved && (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                Маршрут сохранён.
              </span>
            )}
            {saveError !== null && (
              <span className="text-xs text-red-700" role="alert">
                {saveError}
              </span>
            )}
          </div>
        )}
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Правит маршрут администратор (право «Управление настройками»).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
