"use client";

// Аудит ОМ: read-only журнал действий с поиском. Записи создаёт сервер при
// мутациях — на этой странице нет ни одной кнопки изменения.
import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollText } from "lucide-react";
import { useOpsAuditLogs } from "@/hooks/use-ops-audit";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

export default function OpsAuditPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const [search, setSearch] = useState("");
  const query = useOpsAuditLogs();

  const filtered = useMemo(() => {
    const all = query.data?.results ?? [];
    const q = search.trim().toLowerCase();
    if (q === "") return all;
    return all.filter((log) =>
      `${log.action} ${log.entityType} ${log.entityId} ${log.actorUserId} ${log.reason}`
        .toLowerCase()
        .includes(q)
    );
  }, [query.data, search]);

  if (!permissionsLoading && !hasPermission("audit.view")) {
    return <OpsAccessDenied what="журнала аудита" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ScrollText className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Аудит</h1>
            <p className="text-muted-foreground">
              Журнал действий раздела ОМ — только для чтения
            </p>
          </div>
        </div>

        <Input
          className="max-w-md"
          placeholder="Поиск по действию, сущности, пользователю…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {query.isLoading && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка журнала…
            </CardContent>
          </Card>
        )}
        {query.isError && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-destructive">
              Не удалось загрузить журнал аудита.
            </CardContent>
          </Card>
        )}
        {query.data !== undefined && filtered.length === 0 && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Записи не найдены
            </CardContent>
          </Card>
        )}
        {filtered.length > 0 && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата и время</TableHead>
                  <TableHead>Пользователь</TableHead>
                  <TableHead>Действие</TableHead>
                  <TableHead>Сущность</TableHead>
                  <TableHead>Изменение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {log.createdAt}
                    </TableCell>
                    <TableCell>{log.actorUserId}</TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.entityType} · {log.entityId}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs text-muted-foreground">
                      {log.oldValue !== null && (
                        <span>было: {JSON.stringify(log.oldValue)} </span>
                      )}
                      {log.newValue !== null && (
                        <span>стало: {JSON.stringify(log.newValue)}</span>
                      )}
                      {log.reason !== "" && (
                        <span className="block">причина: {log.reason}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
