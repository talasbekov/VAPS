"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
}

function responseError(payload: StaffingResponse): string | null {
  if (!payload.errors?.length) return null;
  return payload.errors.flatMap((item) => Object.values(item)).join("; ");
}

export function EmployeeAdminDialog({ employee, options, onClose }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const positions = usePositions();
  const ranks = useRanks();
  const accounts = useAccessAccounts(accountSearch);
  const staffing = useQuery({
    queryKey: ["staffing-employee", employee?.id],
    queryFn: () => opsApiClient.get<StaffingResponse>(`${STAFFING_PATH}?employee_ids=${employee!.id}`),
    enabled: employee !== null,
    retry: false,
  });
  const row = staffing.data?.staff_units[0];
  const management = row?.management;
  const loading = positions.isLoading || ranks.isLoading || accounts.isLoading || (employee !== null && staffing.isLoading);

  const save = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    setSaving(true);
    setError(null);
    try {
      let result: StaffingResponse;
      if (employee === null) {
        result = await opsApiClient.post<StaffingResponse>(STAFFING_PATH, {
          employees: [{
            last_name: value("last_name"), first_name: value("first_name"),
            middle_name: value("middle_name"), iin: value("iin"),
            callsign: value("callsign"), rank: value("rank") ? Number(value("rank")) : null,
            user: value("user") ? Number(value("user")) : null,
          }],
          staff_units: [{ division: Number(value("division")), position: Number(value("position")) }],
        });
      } else if (row && management) {
        result = await opsApiClient.patch<StaffingResponse>(STAFFING_PATH, {
          employees: [{
            id: employee.id, last_name: value("last_name"), first_name: value("first_name"),
            middle_name: value("middle_name"), callsign: value("callsign"),
            rank: value("rank") ? Number(value("rank")) : null,
            user: value("user") ? Number(value("user")) : null,
          }],
          staff_units: [{ id: management.staff_unit_id, division: Number(value("division")), position: Number(value("position")) }],
        });
      } else {
        throw new Error("Кадровые данные сотрудника не загрузились.");
      }
      const apiError = responseError(result);
      if (apiError) throw new Error(apiError);
      await queryClient.invalidateQueries({ queryKey: ["service-employees"] });
      toast({ title: employee ? "Карточка обновлена" : "Сотрудник создан" });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить сотрудника.");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!employee || !management) return;
    setSaving(true);
    setError(null);
    try {
      const result = await opsApiClient.patch<StaffingResponse>(STAFFING_PATH, {
        employees: [{ id: employee.id, is_active: false }],
      });
      const apiError = responseError(result);
      if (apiError) throw new Error(apiError);
      await queryClient.invalidateQueries({ queryKey: ["service-employees"] });
      toast({ title: "Сотрудник деактивирован" });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось деактивировать сотрудника.");
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{employee ? "Изменить сотрудника" : "Добавить сотрудника"}</DialogTitle>
        <DialogDescription>Кадровая карточка, штатная позиция и привязка к учётной записи.</DialogDescription>
      </DialogHeader>
      <form key={`${management?.staff_unit_id ?? (employee ? "loading" : "new")}:${positions.isSuccess}:${ranks.isSuccess}:${accounts.isSuccess}`} className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
        <fieldset disabled={loading || saving} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="staff-last-name">Фамилия</Label><Input id="staff-last-name" name="last_name" required defaultValue={row?.employee?.last_name ?? employee?.full_name.split(" ")[0] ?? ""} /></div>
          <div className="space-y-1"><Label htmlFor="staff-first-name">Имя</Label><Input id="staff-first-name" name="first_name" required defaultValue={row?.employee?.first_name ?? employee?.full_name.split(" ")[1] ?? ""} /></div>
          <div className="space-y-1"><Label htmlFor="staff-middle-name">Отчество</Label><Input id="staff-middle-name" name="middle_name" defaultValue={management?.middle_name ?? ""} /></div>
          <div className="space-y-1"><Label htmlFor="staff-callsign">Позывной</Label><Input id="staff-callsign" name="callsign" maxLength={64} defaultValue={management?.callsign ?? employee?.callsign ?? ""} /></div>
          {employee === null && <div className="space-y-1 sm:col-span-2"><Label htmlFor="staff-iin">ИИН</Label><Input id="staff-iin" name="iin" required inputMode="numeric" pattern="[0-9]{12}" maxLength={12} /></div>}
          <div className="space-y-1"><Label htmlFor="staff-division">Подразделение</Label><select id="staff-division" name="division" required className={selectClass} defaultValue={row?.division?.id ?? employee?.division?.id ?? ""}><option value="">Выберите подразделение</option>{options.divisions.map((item) => <option key={item.id} value={item.id}>{"— ".repeat(item.level)}{item.name}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="staff-position">Должность</Label><select id="staff-position" name="position" required className={selectClass} defaultValue={row?.position?.id ?? ""}><option value="">Выберите должность</option>{positions.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="staff-rank">Звание</Label><select id="staff-rank" name="rank" className={selectClass} defaultValue={management?.rank_id ?? ""}><option value="">Без звания</option>{ranks.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="staff-account-search">Поиск учётной записи</Label><Input id="staff-account-search" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Логин или имя" /></div>
          <div className="space-y-1"><Label htmlFor="staff-user">Учётная запись</Label><select id="staff-user" name="user" className={selectClass} defaultValue={management?.user?.id ?? ""}><option value="">Не привязывать</option>{management?.user && !accounts.data?.results.some((item) => item.id === management.user?.id) && <option value={management.user.id}>{management.user.username}</option>}{accounts.data?.results.map((item) => <option key={item.id} value={item.id}>{item.full_name || item.username} · {item.username}</option>)}</select></div>
        </fieldset>
        {(error || positions.isError || ranks.isError || accounts.isError || staffing.isError) && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error ?? "Не удалось загрузить данные формы."}</AlertDescription></Alert>}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <div>{employee && management?.is_active && <Button type="button" variant="destructive" disabled={saving} onClick={() => void deactivate()}>Деактивировать</Button>}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Отмена</Button><Button type="submit" disabled={loading || saving}>{saving ? "Сохранение…" : "Сохранить"}</Button></div>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
