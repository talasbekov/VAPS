"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import { ACCESS_ACCOUNTS_PATH, accessAccountPath, type AccessAccount } from "@/entities/access";

type EmployeeOption = { id: number; name: string; personnel_number: string; user_id: number | null };

export function AccountEmployeeLink({ account }: { account: AccessAccount }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState(String(account.employee_id ?? ""));
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null);
  const previousAccount = useRef({ id: account.id, employeeId: String(account.employee_id ?? "") });
  useEffect(() => {
    const previous = previousAccount.current;
    const next = String(account.employee_id ?? "");
    setEmployeeId((draft) => previous.id !== account.id || draft === previous.employeeId ? next : draft);
    previousAccount.current = { id: account.id, employeeId: next };
  }, [account.id, account.employee_id]);
  const options = useQuery({
    queryKey: ["account-employee-options", search],
    queryFn: () => opsApiClient.get<{ results: EmployeeOption[]; count: number }>(
      `${ACCESS_ACCOUNTS_PATH}employee-options/?search=${encodeURIComponent(search)}`
    ),
  });
  const save = useOpsMutation<AccessAccount, { employee_id: number | null }>({
    mutationFn: (body) => opsApiClient.patch<AccessAccount>(accessAccountPath(account.id), body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["ops-access-accounts"] });
      void client.invalidateQueries({ queryKey: ["account-employee-options"] });
      void client.invalidateQueries({ queryKey: ["ops-my-employee"] });
    },
  });
  return (
    <div className="space-y-2 border-t pt-3">
      <Label htmlFor="account-employee">Сотрудник</Label>
      <p className="text-xs text-muted-foreground">{account.employee_name ?? "Учётная запись не связана с сотрудником"}. Связь нужна для профиля и личных действий сотрудника; область доступа задаётся ролью.</p>
      <Input aria-label="Поиск сотрудника для учётной записи" placeholder="ФИО или табельный номер" value={search} disabled={save.isPending} onChange={(event) => setSearch(event.target.value)} />
      <select id="account-employee" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={employeeId} disabled={save.isPending} onChange={(event) => {
        setEmployeeId(event.target.value);
        setSelectedEmployee(options.data?.results.find((row) => String(row.id) === event.target.value) ?? null);
      }}>
        <option value="">Без сотрудника</option>
        {account.employee_id && !options.data?.results.some((row) => row.id === account.employee_id) && (
          <option value={account.employee_id}>{account.employee_name}</option>
        )}
        {selectedEmployee && String(selectedEmployee.id) === employeeId && selectedEmployee.id !== account.employee_id && !options.data?.results.some((row) => row.id === selectedEmployee.id) && (
          <option value={selectedEmployee.id}>{selectedEmployee.name} · {selectedEmployee.personnel_number}</option>
        )}
        {options.data?.results.map((row) => (
          <option key={row.id} value={row.id} disabled={row.user_id !== null && row.user_id !== account.id}>
            {row.name} · {row.personnel_number}{row.user_id !== null && row.user_id !== account.id ? " (уже связан)" : ""}
          </option>
        ))}
      </select>
      {options.data && options.data.count > options.data.results.length && <p className="text-xs text-muted-foreground">Уточните поиск, чтобы найти сотрудника среди {options.data.count} записей.</p>}
      {options.isError && <Button variant="outline" onClick={() => void options.refetch()}>Повторить загрузку сотрудников</Button>}
      <Button size="sm" disabled={save.isPending || options.isLoading || employeeId === String(account.employee_id ?? "")} onClick={() => save.mutate({ employee_id: employeeId ? Number(employeeId) : null })}>Сохранить связь</Button>
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </div>
  );
}
