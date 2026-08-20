"use client";

// Аудит ОМ: read-only журнал действий с поиском. Записи создаёт сервер при
// мутациях — на этой странице нет ни одной кнопки изменения.
//
// Селекты действия и актора — по образцу экрана прототипа «Аудит и настройки».
// Фильтруют КЛИЕНТСКИ в пределах загруженной ленты (адаптер /api/ops/audit-logs/
// отдаёт последние 200 без параметров) — об этом строка под фильтрами; серверные
// фильтры живут у /api/operations/audit-logs/ и ждут своего среза.
import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOpsAuditLogs } from "@/hooks/use-ops-audit";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { PageHeader } from "@/components/page-header";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const ALL = "__all__";

export default function OpsAuditPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState(ALL);
  const [actor, setActor] = useState(ALL);
  const query = useOpsAuditLogs();

  // Значения селектов — из фактической ленты, а не из зашитого словаря:
  // закрытый словарь кодов живёт на бэке, и его копия здесь разошлась бы.
  const { actions, actors } = useMemo(() => {
    const all = query.data?.results ?? [];
    return {
      actions: [...new Set(all.map((log) => log.action))].sort(),
      actors: [...new Set(all.map((log) => String(log.actorUserId)))].sort(
        (a, b) => Number(a) - Number(b)
      ),
    };
  }, [query.data]);

  const hasActiveFilters = search.trim() !== "" || action !== ALL || actor !== ALL;
  const resetFilters = () => {
    setSearch("");
    setAction(ALL);
    setActor(ALL);
  };

  const filtered = useMemo(() => {
    const all = query.data?.results ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((log) => {
      if (action !== ALL && log.action !== action) return false;
      if (actor !== ALL && String(log.actorUserId) !== actor) return false;
      if (q === "") return true;
      return `${log.action} ${log.entityType} ${log.entityId} ${log.actorUserId} ${log.reason}`
        .toLowerCase()
        .includes(q);
    });
  }, [query.data, search, action, actor]);

  if (!permissionsLoading && !hasPermission("audit.view")) {
    return <OpsAccessDenied what="журнала аудита" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Администрирование"
          title="Аудит"
          description="Журнал действий раздела ОМ — только для чтения"
        />

        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-md flex-1"
            placeholder="Поиск по действию, сущности, пользователю…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-56" aria-label="Действие">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все действия</SelectItem>
              {actions.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger className="w-44" aria-label="Актор">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все акторы</SelectItem>
              {actors.map((id) => (
                <SelectItem key={id} value={id}>
                  Пользователь {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Чего нет и почему — вслух: экспорт и глубина ленты. */}
        <p className="text-xs text-muted-foreground">
          Фильтры действуют в пределах загруженной ленты (последние 200
          записей). Выгрузки журнала файлом на бэке нет — журнал append-only
          читается постранично.
        </p>

        {query.isLoading && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка журнала…
            </CardContent>
          </Card>
        )}
        {query.isError && (
          <Card>
            <CardContent className="p-4">
              <LoadFailure
                what="журнал аудита"
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
                className="items-center text-center"
              />
            </CardContent>
          </Card>
        )}
        {query.data !== undefined && filtered.length === 0 && (
          <Card>
            <CardContent className="space-y-2 p-9 text-center text-sm text-muted-foreground">
              <p>Записи не найдены</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              )}
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
