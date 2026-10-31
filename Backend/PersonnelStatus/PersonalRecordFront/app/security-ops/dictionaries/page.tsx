"use client";

import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { OpsAccessDenied } from '@/components/ops-access-denied';
import { useDictionaries } from '@/hooks/use-dictionaries';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { DictionariesWorkspace } from '@/features/dictionaries-workspace/ui/DictionariesWorkspace';

export default function DictionariesPage() {
  const { hasPermission, isLoading } = useOpsPermissions();
  const canView = !isLoading && hasPermission('dictionary.view');
  const query = useDictionaries({ enabled: canView });

  if (!isLoading && !canView) return <OpsAccessDenied what="справочников" />;

  return (
    <DictionariesWorkspace>
      <div className="space-y-4">
        <PageHeader  title="Справочники" description="Значения для мероприятий, кадровых данных, стран и городов." />
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <BookOpen className="h-8 w-8 text-primary-ink" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Выберите справочник</h2>
            {query.data !== undefined && !query.isError && <div className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
              <span><strong className="tabular-nums">{query.data.results.length}</strong> справочников</span>
              <span><strong className="tabular-nums">{query.data.results.reduce((sum, row) => sum + row.totalCount, 0)}</strong> значений</span>
              <span><strong className="tabular-nums">{query.data.results.reduce((sum, row) => sum + row.activeCount, 0)}</strong> активных</span>
            </div>}
          </CardContent>
        </Card>
      </div>
    </DictionariesWorkspace>
  );
}
