"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ServiceEmployee, ServiceEmployeeOptions } from "@/entities/service-employee";
import { useAccessAccounts } from "@/hooks/use-access-permissions";
import { useServiceEmployeeAuthority } from "../use-service-employee-authority";
import { usePositions } from "@/hooks/use-positions";
import { useRanks } from "@/hooks/use-ranks";
import { opsApiClient } from "@/lib/ops-api";
import { useToast } from "@/shared/hooks/use-toast";

const STAFFING_PATH = "/api/staff_unit/staff-units/directorate/";
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface ManagementData {
  staff_unit_id: number;
  middle_name: string;
  callsign: string;
  rank_id: number | null;
  user: { id: number; username: string } | null;
  is_active: boolean;
}

interface StaffingResponse {
  staff_units: Array<{
    id: number;
    division: { id: number; name: string } | null;
    position: { id: number; name: string } | null;
    employee: { id: number; first_name: string; last_name: string } | null;
    management?: ManagementData;
  }>;
  errors?: Array<Record<string, string>> | null;
}

interface Props {
  employee: ServiceEmployee | null;
  options: ServiceEmployeeOptions;
  onClose: () => void;
  loadFailure?: ReactNode;
}

function responseError(payload: StaffingResponse): string | null {
  if (!payload.errors?.length) return null;
  return payload.errors.flatMap((item) => Object.values(item)).join("; ");
}

export function EmployeeAdminDialog({ employee, options, onClose, loadFailure }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mutationPending = useRef(false);
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const deactivationButton = useRef<HTMLButtonElement>(null);
  const confirmationBackButton = useRef<HTMLButtonElement>(null);
  const [selectedAccount, setSelectedAccount] = useState<{ id: number; username: string } | null | undefined>(undefined);
  const [accountSearch, setAccountSearch] = useState("");
  const { key: authority, ready: authorityReady, hasGlobalPermission, hasPermission } = useServiceEmployeeAuthority();
  const canManageEmployees = authorityReady && hasPermission("orgstructure.manage") && hasPermission("admin.roles");
  const canManageAccounts = hasGlobalPermission("admin.roles");
  const positions = usePositions();
  const ranks = useRanks();
  const accounts = useAccessAccounts(accountSearch, { enabled: canManageAccounts });
  const staffing = useQuery({
    queryKey: ["staffing-employee", authority, employee?.id],
    queryFn: () => opsApiClient.get<StaffingResponse>(`${STAFFING_PATH}?employee_ids=${employee!.id}`),
    enabled: authorityReady && employee !== null,
    retry: false,
  });
  const row = staffing.data?.staff_units[0];
  const management = row?.management;
  const loading = positions.isLoading || ranks.isLoading || (employee !== null && staffing.isLoading);
  const dataReady = Boolean(positions.data && ranks.data && (employee === null || management));
  const criticalError = positions.isError || ranks.isError || (employee !== null && (staffing.isError || (!staffing.isPending && !management)));
  const accountsError = canManageAccounts && accounts.isError;
  const retrying = positions.isFetching || ranks.isFetching || (employee !== null && staffing.isFetching) || (canManageAccounts && accounts.isFetching);
  const account = selectedAccount === undefined ? management?.user : selectedAccount;
  const retry = () => {
    if (positions.isError) void positions.refetch();
    if (ranks.isError) void ranks.refetch();
    if (employee !== null && (staffing.isError || !management)) void staffing.refetch();
    if (accountsError) void accounts.refetch();
  };

  const save = async (form: HTMLFormElement) => {
    if (mutationPending.current || !canManageEmployees || !dataReady || criticalError || loading) return;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    // Without global account authority the selector is absent. Omit the field
    // rather than turning an existing employee's account binding into null.
    const accountBinding = canManageAccounts
      ? { user: value("user") ? Number(value("user")) : null }
      : {};
    mutationPending.current = true;
    setSaving(true);
    setError(null);
    try {
      let result: StaffingResponse;
      if (employee === null) {
        result = await opsApiClient.post<StaffingResponse>(STAFFING_PATH, {
          employee_admin: true,
          atomic: true,
          employees: [{
            last_name: value("last_name"), first_name: value("first_name"),
            middle_name: value("middle_name"), iin: value("iin"),
            callsign: value("callsign"), rank: value("rank") ? Number(value("rank")) : null,
            ...accountBinding,
          }],
          staff_units: [{ division: Number(value("division")), position: Number(value("position")) }],
        });
      } else if (row && management) {
        result = await opsApiClient.patch<StaffingResponse>(STAFFING_PATH, {
          employee_admin: true,
          atomic: true,
          employees: [{
            id: employee.id, last_name: value("last_name"), first_name: value("first_name"),
            middle_name: value("middle_name"), callsign: value("callsign"),
            rank: value("rank") ? Number(value("rank")) : null,
            ...accountBinding,
          }],
          staff_units: [{ id: management.staff_unit_id, division: Number(value("division")), position: Number(value("position")) }],
        });
      } else {
        throw new Error("Кадровые данные сотрудника не загрузились.");
      }
      const apiError = responseError(result);
      if (apiError) throw new Error(apiError);
      await queryClient.invalidateQueries({ queryKey: ["service-employees"] });
      await queryClient.invalidateQueries({ queryKey: ["staffing-employee"] });
      toast({ title: employee ? "Карточка обновлена" : "Сотрудник создан" });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить сотрудника.");
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  };

  const cancelDeactivation = () => {
    if (mutationPending.current) return;
    setConfirmingDeactivation(false);
    requestAnimationFrame(() => deactivationButton.current?.focus());
  };
  const deactivate = async () => {
    if (mutationPending.current || !confirmingDeactivation || !canManageEmployees || !employee || !management?.is_active || criticalError) return;
    mutationPending.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await opsApiClient.patch<StaffingResponse>(STAFFING_PATH, {
        employee_admin: true,
        atomic: true,
        employees: [{ id: employee.id, is_active: false }],
      });
      const apiError = responseError(result);
      if (apiError) throw new Error(apiError);
      await queryClient.invalidateQueries({ queryKey: ["service-employees"] });
      await queryClient.invalidateQueries({ queryKey: ["staffing-employee"] });
      toast({ title: "Сотрудник деактивирован" });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось деактивировать сотрудника.");
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !mutationPending.current) onClose(); }}>
    <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={(event) => { if (mutationPending.current) event.preventDefault(); }} onInteractOutside={(event) => { if (mutationPending.current) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{employee ? "Изменить сотрудника" : "Добавить сотрудника"}</DialogTitle>
        <DialogDescription>Кадровая карточка, штатная позиция и привязка к учётной записи.</DialogDescription>
      </DialogHeader>
      {loadFailure}
      {!canManageEmployees && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>Нет подтверждённых прав для изменения сотрудников.</AlertDescription></Alert>}
      {(criticalError || accountsError) && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>Не удалось загрузить данные формы.<Button type="button" variant="outline" disabled={retrying || saving} onClick={retry}>Повторить загрузку</Button></AlertDescription></Alert>}
      {!dataReady ? <><p role="status" className="py-6 text-sm text-muted-foreground">{loading ? "Загрузка кадровых данных…" : "Для редактирования необходимо загрузить кадровые данные."}</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Отмена</Button><Button disabled>Сохранить</Button></div></> : <form key={management?.staff_unit_id ?? "new"} className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
        <fieldset disabled={loading || saving || confirmingDeactivation || criticalError || !canManageEmployees} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="staff-last-name">Фамилия</Label><Input id="staff-last-name" name="last_name" required defaultValue={row?.employee?.last_name ?? employee?.full_name.split(" ")[0] ?? ""} /></div>
          <div className="space-y-1"><Label htmlFor="staff-first-name">Имя</Label><Input id="staff-first-name" name="first_name" required defaultValue={row?.employee?.first_name ?? employee?.full_name.split(" ")[1] ?? ""} /></div>
          <div className="space-y-1"><Label htmlFor="staff-middle-name">Отчество</Label><Input id="staff-middle-name" name="middle_name" defaultValue={management?.middle_name ?? ""} /></div>
          <div className="space-y-1"><Label htmlFor="staff-callsign">Позывной</Label><Input id="staff-callsign" name="callsign" maxLength={64} defaultValue={management?.callsign ?? employee?.callsign ?? ""} /></div>
          {employee === null && <div className="space-y-1 sm:col-span-2"><Label htmlFor="staff-iin">ИИН</Label><Input id="staff-iin" name="iin" required inputMode="numeric" pattern="[0-9]{12}" maxLength={12} /></div>}
          <div className="space-y-1"><Label htmlFor="staff-division">Подразделение</Label><select id="staff-division" name="division" required className={selectClass} defaultValue={row?.division?.id ?? employee?.division?.id ?? ""}><option value="">Выберите подразделение</option>{options.divisions.map((item) => <option key={item.id} value={item.id}>{"— ".repeat(item.level)}{item.name}</option>)}</select></div>
          {/* Неактивная должность/звание закрыты для НОВОГО выбора (UC-REF-001);
              уже назначенное остаётся в списке — иначе сохранение карточки
              молча переставило бы человека на другую должность. */}
          <div className="space-y-1"><Label htmlFor="staff-position">Должность</Label><select id="staff-position" name="position" required className={selectClass} defaultValue={row?.position?.id ?? ""}><option value="">Выберите должность</option>{positions.data?.filter((item) => item.is_active !== false || item.id === row?.position?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="staff-rank">Звание</Label><select id="staff-rank" name="rank" className={selectClass} defaultValue={management?.rank_id ?? ""}><option value="">Без звания</option>{ranks.data?.filter((item) => item.is_active !== false || item.id === management?.rank_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {canManageAccounts && <>
            <div className="space-y-1"><Label htmlFor="staff-account-search">Поиск учётной записи</Label><Input id="staff-account-search" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Логин или имя" /></div>
            <div className="space-y-1"><Label htmlFor="staff-user">Учётная запись</Label><select id="staff-user" name="user" className={selectClass} value={account?.id ?? ""} onChange={(event) => { const id = Number(event.target.value); setSelectedAccount(event.target.value ? accounts.data?.results.find((item) => item.id === id) ?? (account?.id === id ? account : undefined) : null); }}><option value="">Не привязывать</option>{account && !accounts.data?.results.some((item) => item.id === account.id) && <option value={account.id}>{account.username}</option>}{accounts.data?.results.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.username} · {item.username}</option>)}</select></div>
          </>}
        </fieldset>
        {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
        {confirmingDeactivation && employee ? <section role="region" aria-label="Подтверждение деактивации" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium">Деактивировать сотрудника «{employee.full_name}»?</p>
          <p className="text-sm text-muted-foreground">Сотрудник больше не будет отображаться в списке действующего состава. Кадровая карточка сохранится.</p>
          <p className="text-sm text-muted-foreground">Несохранённые изменения полей этим действием не сохраняются.</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={confirmationBackButton} type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={saving} onClick={cancelDeactivation}>Вернуться к форме</Button>
            <Button type="button" variant="destructive" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={saving || criticalError || !canManageEmployees || !management?.is_active} onClick={() => void deactivate()}>{saving ? "Деактивируем…" : "Подтвердить деактивацию"}</Button>
          </div>
        </section> : <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <div>{employee && management?.is_active && <Button ref={deactivationButton} type="button" variant="destructive" disabled={saving || criticalError || !canManageEmployees} onClick={() => {
            if (mutationPending.current) return;
            setError(null); setConfirmingDeactivation(true);
            requestAnimationFrame(() => confirmationBackButton.current?.focus());
          }}>Деактивировать</Button>}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Отмена</Button><Button type="submit" disabled={loading || saving || criticalError || !canManageEmployees}>{saving ? "Сохранение…" : "Сохранить"}</Button></div>
        </div>}
      </form>}
    </DialogContent>
  </Dialog>;
}
