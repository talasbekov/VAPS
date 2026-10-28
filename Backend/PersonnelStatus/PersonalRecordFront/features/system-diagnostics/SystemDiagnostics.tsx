'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { opsApiClient } from '@/lib/ops-api';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { useOpsProtectedRead, useOpsReadAccess } from '@/hooks/use-ops-protected-read';
import { formatIsoDateTime } from '@/shared/lib/date';
import type { AssistantQueueEvidence, ConnectionCheck, Diagnostics } from './model';

function ConnectionEvidence({ check }: { check: ConnectionCheck | null | undefined }) {
  if (!check) return <p>Сохранённых результатов проверки подключения пока нет.</p>;
  const label = check.configuration_match === 'current' ? 'Проверены текущие сохранённые настройки' :
    check.configuration_match === 'previous' ? 'Проверены прежние настройки' : 'Проверен черновик';
  return <div className="space-y-1 border-t pt-2">
    <p>{label}: {check.model || 'модель не указана'} · {formatIsoDateTime(check.checked_at)}.</p>
    <p className={check.succeeded ? undefined : 'text-destructive'}>{check.succeeded ? 'Модель вернула корректный ответ при проверке.' : 'Проверка завершилась ошибкой.'}</p>
    <p className="text-muted-foreground">Этот результат не подтверждает доступность сейчас.</p>
  </div>;
}

function QueueEvidence({ queue }: { queue: AssistantQueueEvidence }) {
  const { pending, counts } = queue;
  return <div className="rounded-lg border p-3">
    <dt className="font-medium">Обработка поручений ИИ</dt>
    <dd className="mt-1 space-y-2 text-sm">
      <p>Доступные вам поручения: ваши и переданные в Штаб, если у вас есть соответствующее право. Чужие личные поручения не учитываются.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <p>{`В очереди: ${counts.queued}`}</p><p>{`Обрабатываются: ${counts.running}`}</p><p>{`С ошибкой: ${counts.failed}`}</p>
      </div>
      <p>{`Записи старше ${queue.lease_seconds} секунд: в очереди ${pending.stale_queued}, в обработке ${pending.stale_running}.`}
        {(counts.failed > 0 || pending.stale_queued > 0 || pending.stale_running > 0) && ' Автор может проверить доступность повтора в своём поручении.'}</p>
      <p className="text-muted-foreground">{`Проверено отметок времени: ${pending.inspected}; предел ${pending.limit}, сначала наиболее давно изменённые. При подсчёте ожидали или обрабатывались: ${pending.total}.`}
        {pending.truncated && ' Счётчики старых записей — нижняя граница; оставшиеся записи не проверены.'}</p>
      <p className="text-muted-foreground">Счётчики и отметки времени читаются последовательно. Если очередь меняется во время запроса, значения могут различаться; обновите сведения.</p>
      {pending.invalid_timestamps > 0 && <p>{`Некорректное или отсутствующее время: ${pending.invalid_timestamps}. Возраст этих записей неизвестен.`}</p>}
      {pending.future_timestamps > 0 && <p>{`Время в будущем: ${pending.future_timestamps}. Проверьте часы сервера; возраст не вычислен.`}</p>}
      {pending.oldest_queued_at && <p>Самое раннее ожидание среди проверенных: {formatIsoDateTime(pending.oldest_queued_at)}.</p>}
      {pending.oldest_started_at && <p>Самое раннее начало обработки среди проверенных: {formatIsoDateTime(pending.oldest_started_at)}.</p>}
      <p className="text-muted-foreground">Состояния прочитаны: {formatIsoDateTime(queue.observed_at)}. Доступность фонового обработчика не проверяется. Пустая очередь не подтверждает его работу.</p>
    </dd>
  </div>;
}

export function SystemDiagnostics() {
  const access = useOpsPermissions();
  const readAccess = useOpsReadAccess('settings.manage');
  const [open, setOpen] = useState(false);
  const allowed = readAccess.allowed && !access.isLoading && !access.error && access.hasGlobalPermission('settings.manage');
  const query = useOpsProtectedRead<Diagnostics>(['ops-system-diagnostics', 'snapshot'], [], { ...readAccess, allowed },
    () => opsApiClient.get<Diagnostics>('/api/ops/system-diagnostics/'), { enabled: open, staleTime: 0 });
  if (!allowed) return null;
  const data = !query.isError && !query.isFetching ? query.data : undefined;
  const receipt = data?.digital_twin?.catalog_import;
  return <details className="rounded-xl border bg-card p-4" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Состояние системы</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">Доступность приложения, настройки подключений и сведения об обслуживании.</p>
      {(query.isLoading || query.isFetching) && <p role="status">Получаем сведения с сервера…</p>}
      {query.isError && <p role="alert" className="text-sm text-destructive">Не удалось получить состояние системы. Прежний результат скрыт.</p>}
      {data && <>
        <p className="text-xs text-muted-foreground">Ответ сервера: {formatIsoDateTime(data.checked_at)} · Часовой пояс службы: {data.time_zone}</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3"><dt className="font-medium">Приложение и база</dt><dd className="mt-1 text-sm">Отвечают на запрос. Сведения о настройках прочитаны из базы.</dd></div>
          <div className="rounded-lg border p-3"><dt className="font-medium">Подключение ИИ</dt><dd className="mt-1 space-y-2 text-sm">
            <p>{data.ai.state === 'disabled' ? 'Подключение отключено.' : `Настроена модель: ${data.ai.model}.`}</p>
            <p>Связь с моделью этим запросом не проверяется.</p>
            {data.ai.updated_at && <p className="text-muted-foreground">Настройки сохранены: {formatIsoDateTime(data.ai.updated_at)}</p>}
            <ConnectionEvidence check={data.ai.last_check} />
            <Button asChild size="sm" variant="outline"><Link href="/settings/ai/">Проверить подключение ИИ</Link></Button>
          </dd></div>
          {data.ai_queue && <QueueEvidence queue={data.ai_queue} />}
          <div className="rounded-lg border p-3"><dt className="font-medium">Обмен с цифровым двойником</dt><dd className="mt-1 space-y-2 text-sm">
            <p>Время выдачи снимка и подтверждение его получения двойником не регистрируются. Актуальность данных двойника неизвестна.</p>
            {receipt?.state === 'recorded' ? <div className="space-y-1 border-t pt-2">
              <p>Импорт каталога в Smart: {receipt.recorded_at ? formatIsoDateTime(receipt.recorded_at) : 'время неизвестно'}.</p>
              <p className="break-all">Идентификатор экспорта: {receipt.export_id}.</p>
              <details><summary className="cursor-pointer">Контрольная сумма пакета</summary><p className="mt-1 break-all font-mono text-xs">{receipt.bundle_sha256}</p></details>
              <p>Эта квитанция не подтверждает получение данных двойником и актуальность всей связки.</p>
            </div> : <p>{receipt?.state === 'invalid' ? 'Последняя запись импорта каталога содержит неполную или некорректную квитанцию.' : 'Квитанций импорта каталога в Smart пока нет.'}</p>}
          </dd></div>
          <div className="rounded-lg border p-3"><dt className="font-medium">Резервная копия</dt><dd className="mt-1 text-sm">В приложении нет подтверждения последней проверенной копии. Дату и результат восстановления проверяет администратор сервера.</dd></div>
        </dl>
        <details className="text-sm"><summary className="cursor-pointer">Версия и обслуживание</summary><div className="mt-2 space-y-2 break-words">
          <p>{data.release.revision ? `Версия, указанная в окружении сервера: ${data.release.revision}. Это не подтверждение успешной установки.` : 'Версия установленного выпуска приложению не передана. Проверяйте результат обновления на сервере.'}</p>
          {data.database.last_recorded_migration && <p>Последняя записанная миграция: {data.database.last_recorded_migration}{data.database.migration_recorded_at ? ` · ${formatIsoDateTime(data.database.migration_recorded_at)}` : ''}. Эта запись не заменяет проверку обновления.</p>}
        </div></details>
      </>}
      <Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Обновляем…' : 'Обновить состояние системы'}</Button>
    </div>
  </details>;
}

