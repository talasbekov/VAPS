"use client";

// Настройки политик: разделы с версиями, записи с серверным решением о
// правке (запертое правило несёт причину), диалог правки с обязательной
// причиной, журнал изменений. Правка здесь меняет исход операций на других
// экранах: режим отдыха читает планирование дежурств, интервалы свежести —
// реестр объектов.
import { useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useOpsSettings,
  useSettingChangeLog,
  useUpdateSetting,
} from "@/hooks/use-ops-settings";
import { formatSettingValue, SECTION_LABEL } from "@/entities/policy-setting";
import type {
  PolicySetting,
  SettingSectionCode,
} from "@/entities/policy-setting";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { ApprovalRouteCard } from "@/features/approval-route/ui/ApprovalRouteCard";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { formatIsoDateTime } from "@/shared/lib/date";

export default function OpsSettingsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useOpsSettings();
  const changeLog = useSettingChangeLog();
  const [editing, setEditing] = useState<PolicySetting | null>(null);

  // «Политика согласования» (Plane №431): порог автосрочности возврата —
  // число, поэтому живёт обычной настройкой рядом с правилами.
  const sections: SettingSectionCode[] = ["CONFLICT_RULES", "PASSPORT_FRESHNESS", "APPROVAL_POLICY"];

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/security-ops/settings"])) {
    return <OpsAccessDenied what="настроек политик" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Система"
          title="Администрирование"
          description="Политики, которые читают другие разделы — правка меняет исход операций, а не окраску экрана"
        />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка настроек…</p>
        )}
        {query.isError && (
          <LoadFailure
            what="настройки"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
          />
        )}

        {query.data !== undefined &&
          sections.map((sectionCode) => (
            <Card key={sectionCode}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {SECTION_LABEL[sectionCode]}
                  <Badge variant="outline">
                    версия: {query.data!.sectionVersions[sectionCode]}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {query.data!.results
                  .filter((setting) => setting.sectionCode === sectionCode)
                  .map((setting) => (
                    <div
                      key={setting.settingCode}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{setting.safeLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {setting.description}
                        </p>
                        {setting.updatedAt !== null && (
                          <p className="text-[11px] text-muted-foreground">
                            Изменено: {formatIsoDateTime(setting.updatedAt)} ({setting.updatedBy})
                          </p>
                        )}
                      </div>
                      <Badge className="bg-primary/10 text-primary-ink hover:bg-primary/10">
                        {formatSettingValue(setting, setting.value)}
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!setting.action.canEdit}
                        title={setting.action.disabledReason ?? undefined}
                        onClick={() => setEditing(setting)}
                      >
                        Изменить
                      </Button>
                      {!setting.action.canEdit &&
                        setting.action.disabledReason !== null && (
                          <p className="w-full text-[11px] text-muted-foreground">
                            {setting.action.disabledReason}
                          </p>
                        )}
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}

        {/* Маршрут согласования расстановки (`[СОГ-05]`, Plane №429) — своя
            карточка, а не политика-число: список подписантов. */}
        <ApprovalRouteCard canManage={hasPermission("settings.manage")} />

        <Card>
          <CardHeader>
            <CardTitle>Журнал изменений</CardTitle>
          </CardHeader>
          <CardContent>
            {changeLog.data !== undefined && changeLog.data.results.length === 0 && (
              <p className="text-xs text-muted-foreground">Изменений ещё не было.</p>
            )}
            <ul className="flex flex-col gap-1.5">
              {(changeLog.data?.results ?? []).map((event) => (
                <li key={event.id} className="rounded-md border p-2.5 text-xs">
                  <span className="font-semibold">{event.safeLabel}</span>:{" "}
                  {event.oldValue} → {event.newValue} ·{" "}
                  <span className="text-muted-foreground">
                    {event.changedAt} · {event.actorUserId} · причина:{" "}
                    {event.reason} · версия после: {event.policyVersionAfter}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {editing !== null && (
          <EditSettingDialog setting={editing} onClose={() => setEditing(null)} />
        )}
      </div>
    </DashboardLayout>
  );
}

function EditSettingDialog({
  setting,
  onClose,
}: {
  setting: PolicySetting;
  onClose: () => void;
}) {
  const [value, setValue] = useState<string>(String(setting.value));
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const update = useUpdateSetting(setting.settingCode, {
    onFormError: (details) => setFieldErrors(details),
  });

  function submit(): void {
    setFieldErrors(null);
    update.mutate(
      {
        value: setting.kind === "NUMBER" ? Number(value) : value,
        reason,
      }
    );
  }

  // успех закрывает диалог
  if (update.data !== undefined) {
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{setting.safeLabel}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{setting.description}</p>
          {setting.kind === "NUMBER" ? (
            <div className="space-y-1">
              <Label htmlFor="setting-value">
                Значение ({setting.minValue}–{setting.maxValue})
              </Label>
              <Input
                id="setting-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="setting-mode">Режим</Label>
              <select
                id="setting-mode"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                {setting.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.safeLabel}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {setting.options.find((o) => o.value === value)?.description}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="setting-reason">Причина изменения *</Label>
            <Textarea
              id="setting-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {fieldErrors !== null && Object.keys(fieldErrors).length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive-ink" role="alert">
              {Object.entries(fieldErrors).map(([field, v]) => (
                <li key={field}>
                  {field}: {Array.isArray(v) ? String(v[0]) : String(v)}
                </li>
              ))}
            </ul>
          )}
          {update.error !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              {update.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="button" disabled={update.isPending} onClick={submit}>
            {update.isPending ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
