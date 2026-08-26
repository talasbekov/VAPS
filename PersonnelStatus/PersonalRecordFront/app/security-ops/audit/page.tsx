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
import { useOpsAuditLogs } from "@/hooks/use-ops-audit";
import {
  auditActionLabel,
  auditChanges,
  auditEntityLabel,
  isKnownAuditAction,
  isKnownAuditEntity,
} from "@/entities/audit-log";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { PageHeader } from "@/components/page-header";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { formatIsoDateTime } from "@/shared/lib/date";

export default function OpsAuditPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const [search, setSearch] = useState("");
  const query = useOpsAuditLogs();

  const filtered = useMemo(() => {
    const all = query.data?.results ?? [];
    const q = search.trim().toLowerCase();
    if (q === "") return all;
    return all.filter((log) =>
      // Поиск идёт и ПО ПОДПИСИ, а не только по коду: человек ищет
      // «замещающ», а не `SECURITY_EVENT_DEPUTY_ASSIGNED`. Код тоже остаётся
      // искомым — по нему ищут те, кто пришёл из кода или из отчёта.
      `${auditActionLabel(log.action)} ${log.action} ${log.entityType} ${log.entityId} ${log.actorUserId} ${log.reason}`
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
        <PageHeader
          eyebrow="Система"
          title="Аудит"
          description="Журнал действий раздела ОМ — только для чтения"
        />

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
                  {/* Ширины назначены ЗАМЕРОМ, а не на глаз: до правки
                      таблица была 1168px в окне 958px, и колонка «Изменение»
                      уезжала за край — читатель видел обрывок строки, ради
                      которой пришёл. Служебные колонки сжаты, разбор
                      изменения получил остаток. */}
                  <TableHead className="w-[110px]">Дата и время</TableHead>
                  <TableHead className="w-[80px]">Пользователь</TableHead>
                  <TableHead className="w-[190px]">Действие</TableHead>
                  <TableHead className="w-[150px]">Сущность</TableHead>
                  <TableHead className="min-w-[300px]">Изменение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatIsoDateTime(log.createdAt)}
                    </TableCell>
                    {/* Имени автора в журнале нет — сервер пишет только
                        идентификатор учётной записи. Подпись «ID» ставит его
                        на место: голая «1» в колонке «Пользователь» читалась
                        как обрезанное имя. */}
                    <TableCell className="tabular-nums">
                      ID {log.actorUserId}
                    </TableCell>
                    {/* Подпись действия, а не код: журнал читают вслух при
                        разбирательстве. Действие без подписи печатается кодом
                        и моноширинным — так видно, что подписи нет; полноту
                        карты стережёт проба на стороне сервера. */}
                    <TableCell
                      className={
                        (isKnownAuditAction(log.action)
                          ? ""
                          : "font-mono text-xs ") + "whitespace-normal break-words"
                      }
                      title={isKnownAuditAction(log.action) ? log.action : undefined}
                    >
                      {auditActionLabel(log.action)}
                    </TableCell>
                    {/* Тип сущности — ПОДПИСЬЮ: колонка печатала машинную
                        строку `access_user_role · 12`, и читать её вслух на
                        разбирательстве было нечем. Неизвестный тип остаётся
                        кодом и моноширинным — так видно, что подписи нет
                        (та же конвенция, что у действия). */}
                    <TableCell className="text-muted-foreground">
                      <span
                        className={
                          isKnownAuditEntity(log.entityType)
                            ? ""
                            : "font-mono text-xs"
                        }
                        title={
                          isKnownAuditEntity(log.entityType)
                            ? log.entityType
                            : undefined
                        }
                      >
                        {auditEntityLabel(log.entityType)}
                      </span>
                      <span className="ml-1 tabular-nums">
                        · {log.entityId}
                      </span>
                    </TableCell>
                    {/* Изменение ПО ПОЛЯМ, а не двумя JSON-строками: вопрос
                        читателя один — что именно изменилось, — и раньше на
                        него отвечали двумя объектами, которые он сравнивал
                        глазами. Поля, которые не менялись, не показываются:
                        они отнимают место у той строки, где что-то
                        произошло. */}
                    <TableCell className="text-xs whitespace-normal break-words text-muted-foreground">
                      <AuditChangeCell log={log} />
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

/** Ячейка «Изменение»: разница по полям, длинный список — под раскрытием. */
function AuditChangeCell({
  log,
}: {
  log: {
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  };
}) {
  const changes = auditChanges(log.oldValue, log.newValue);
  // Разобрать не удалось (значение не объект, а строка или число) — печатаем
  // как есть: молчание здесь скрыло бы содержимое записи целиком.
  const raw =
    changes.length === 0 &&
    (log.oldValue !== null || log.newValue !== null) ? (
      <span className="font-mono">
        {log.oldValue !== null && <>было: {JSON.stringify(log.oldValue)} </>}
        {log.newValue !== null && <>стало: {JSON.stringify(log.newValue)}</>}
      </span>
    ) : null;

  // Первые три поля видны сразу, остальные — под раскрытием: в узкой колонке
  // десять строк выдавливают соседние записи с экрана, а прятать их целиком
  // нельзя — на разбирательстве спрашивают именно про поле.
  const VISIBLE = 3;
  const head = changes.slice(0, VISIBLE);
  const tail = changes.slice(VISIBLE);

  return (
    <div className="space-y-0.5">
      {raw}
      {head.map((change) => (
        <AuditChangeRow key={change.key} change={change} />
      ))}
      {tail.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
            ещё {tail.length}{" "}
            {tail.length === 1 ? "поле" : tail.length < 5 ? "поля" : "полей"}
          </summary>
          <div className="mt-0.5 space-y-0.5">
            {tail.map((change) => (
              <AuditChangeRow key={change.key} change={change} />
            ))}
          </div>
        </details>
      )}
      {log.reason !== "" && (
        <div>
          <span className="text-muted-foreground">Причина: </span>
          {log.reason}
        </div>
      )}
    </div>
  );
}

function AuditChangeRow({
  change,
}: {
  change: ReturnType<typeof auditChanges>[number];
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1">
      <span className={change.isKnownField ? "" : "font-mono"}>
        {change.label}:
      </span>
      {change.before !== null && (
        <span className="line-through decoration-1">{change.before}</span>
      )}
      {change.before !== null && change.after !== null && <span>→</span>}
      {change.after !== null && (
        <span className="text-foreground">{change.after}</span>
      )}
    </div>
  );
}
