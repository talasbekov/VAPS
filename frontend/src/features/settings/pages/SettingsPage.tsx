// «Настройки» (§29 — role-restricted administration, отделённая от read-only
// `/audit`). Экран администрирует политику наблюдений §22.11: допуски и пороги
// детекторов блока «Требует внимания». Изменение здесь видно на аналитике
// службы — это не декоративная панель.
//
// Право на изменение приходит С СЕРВЕРА (`canManage` в ответе списка), а не
// вычисляется экраном: кнопка, выключенная только на клиенте, ограничением
// доступа не является — сервер всё равно перепроверяет право на PATCH.
import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { useSettingChangeLog, useSettings } from '../api/queries'
import type { PolicySetting } from '../model/types'
import { EditSettingDialog } from './EditSettingDialog'

const UNIT_LABEL: Record<PolicySetting['valueType'], string> = {
  DAYS: 'сут.',
  HOURS: 'ч',
  PERCENT: '%',
  COUNT: 'шт.',
}

const DETECTOR_LABEL: Record<string, string> = {
  ACKNOWLEDGEMENT_MISSING: 'Отметка об ознакомлении',
  CONFLICT_SHARE: 'Конфликты планирования',
  UNFINISHED_OVERDUE: 'Незавершённые записи',
  UNCONFIRMED_OVERDUE: 'Неподтверждённые отметки времени',
  SOURCE_AGE: 'Возраст источника',
}

export function SettingsPage() {
  const settingsQuery = useSettings()
  const changeLogQuery = useSettingChangeLog()
  const [editing, setEditing] = useState<PolicySetting | null>(null)

  const settings = settingsQuery.data?.results ?? []
  const canManage = settingsQuery.data?.canManage ?? false

  // Группировка — по детектору, порядок внутри группы серверный (не пересортируем).
  const groups: { detectorCode: string; items: PolicySetting[] }[] = []
  for (const setting of settings) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.detectorCode === setting.detectorCode) {
      last.items.push(setting)
    } else {
      groups.push({ detectorCode: setting.detectorCode, items: [setting] })
    }
  }

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Администрирование
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
        <span className="text-sm text-muted-foreground">
          Политика наблюдений блока «Требует внимания» — допуски и пороги, по которым аналитика
          службы решает, что показать
        </span>
      </header>

      {settingsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка настроек…</p>
      )}
      {settingsQuery.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить настройки.</p>
      )}

      {!settingsQuery.isLoading && !settingsQuery.isError && (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            Действующая версия политики:{' '}
            <span className="font-mono font-semibold">{settingsQuery.data?.policyVersion}</span>.
            Каждое принятое изменение поднимает версию — по ней снимок аналитики сопоставляется с
            методикой, по которой считался.
          </p>

          {!canManage && (
            <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Просмотр без изменения: право на администрирование политики не выдано.
            </p>
          )}

          <div className="flex flex-col gap-3.5">
            {groups.map((group) => (
              <section key={group.detectorCode} className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold">
                  {DETECTOR_LABEL[group.detectorCode] ?? group.detectorCode}
                </div>
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">
                    Настройки детектора «{DETECTOR_LABEL[group.detectorCode] ?? group.detectorCode}»
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                        Параметр
                      </th>
                      <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                        Значение
                      </th>
                      <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                        Диапазон
                      </th>
                      <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                        Изменено
                      </th>
                      <th scope="col" className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((setting) => (
                      <tr key={setting.settingCode} className="border-t align-top">
                        <td className="p-3">
                          <span className="block text-sm font-medium">{setting.safeLabel}</span>
                          <span className="block text-xs text-muted-foreground">
                            {setting.description}
                          </span>
                        </td>
                        <td className="p-3 text-sm tabular-nums">
                          {setting.value} {UNIT_LABEL[setting.valueType]}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground tabular-nums">
                          {setting.minValue}–{setting.maxValue}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {setting.updatedAt === null ? (
                            <span>не менялось</span>
                          ) : (
                            <span>
                              {setting.updatedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                              {setting.updatedBy}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {canManage && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditing(setting)}
                            >
                              Изменить
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>

          <section className="mt-6 overflow-hidden rounded-xl border bg-card">
            <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold">
              История изменений
            </div>
            {changeLogQuery.isLoading && (
              <p className="p-4 text-sm text-muted-foreground">Загрузка истории…</p>
            )}
            {changeLogQuery.isError && (
              <p className="p-4 text-sm text-destructive">Не удалось загрузить историю.</p>
            )}
            {!changeLogQuery.isLoading &&
              !changeLogQuery.isError &&
              (changeLogQuery.data?.results.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Изменений не было — политика действует в исходной редакции.
                </p>
              ) : (
                <ul className="divide-y">
                  {(changeLogQuery.data?.results ?? []).map((event) => (
                    <li key={event.id} className="p-4">
                      <p className="text-sm font-medium">
                        {event.safeLabel}: {event.oldValue} → {event.newValue}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.changedAt.slice(0, 16).replace('T', ' ')} · {event.actorUserId} ·
                        версия политики {event.policyVersionAfter}
                      </p>
                      <p className="mt-1 text-sm">Причина: {event.reason}</p>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        </>
      )}

      {editing !== null && (
        <EditSettingDialog
          setting={editing}
          unitLabel={UNIT_LABEL[editing.valueType]}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
