"use client";

// Реестр справочников: код, название, всего/активных значений.
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDictionaries } from "@/hooks/use-dictionaries";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

export default function DictionariesPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const query = useDictionaries();

  if (!permissionsLoading && !hasPermission("dictionary.view")) {
    return <OpsAccessDenied what="справочников" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Система"
          title="Справочники"
          description="Значения, которые читают формы раздела ОМ"
        />

        {query.isLoading && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка справочников…
            </CardContent>
          </Card>
        )}
        {query.isError && (
          <Card>
            <CardContent className="p-4">
              <LoadFailure
                what="справочники"
                onRetry={() => void query.refetch()}
                isRetrying={query.isFetching}
                className="items-center text-center"
              />
            </CardContent>
          </Card>
        )}
        {query.data !== undefined && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Справочник</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead>Значений</TableHead>
                  <TableHead>Активных</TableHead>
                  <TableHead>
                    <span className="sr-only">Действия</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.results.map((definition) => (
                  <TableRow key={definition.code}>
                    <TableCell>
                      <Link
                        href={`/security-ops/dictionaries/${definition.code}`}
                        className="block"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {definition.code}
                        </span>
                        <span className="block font-semibold">
                          {definition.label}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {definition.description}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {definition.totalCount}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {definition.activeCount}
                    </TableCell>
                    <TableCell className="text-center">
                      <Link
                        href={`/security-ops/dictionaries/${definition.code}`}
                        className="text-primary-ink"
                      >
                        ›
                      </Link>
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
