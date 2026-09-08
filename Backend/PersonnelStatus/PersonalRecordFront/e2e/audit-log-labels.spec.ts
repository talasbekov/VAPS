/**
 * Подписи записи «действие старшего объекта» в журнале (Plane №860, п. 5;
 * доведено по ревью №825 08.09.2026).
 *
 * Заказчику обещана запись «с именем человека, кодом ОМ и объектом». Пейлоад
 * `record_object_lead_action` (бэк, `security_events.py`) несёт шесть ключей:
 * `code`, `action`, `leadId`, `leadName`, `visitObjectId`, `objectName`.
 * Первая правка подписала четыре, а самый содержательный — `action` — так и
 * печатался сырым ключом с английским кодом (`action approval_send`).
 *
 * Проба чистая (без стенда): зовёт `auditChanges` напрямую. Красна, если
 * подпись поля или перевод кода действия пропадут из карты.
 */
import { expect, test } from '@playwright/test'

import { auditChanges } from '../entities/audit-log'

test.describe('журнал действий: подписи записи старшего объекта', () => {
  test('все шесть ключей пейлоада подписаны, а не печатаются сырыми', () => {
    const rows = auditChanges(
      {},
      {
        code: 'ОМ-2026-7',
        action: 'approval_send',
        leadId: '15',
        leadName: 'Иванов И.И.',
        visitObjectId: '3',
        objectName: 'Резиденция',
      },
    )
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]))
    for (const key of ['code', 'action', 'leadId', 'leadName', 'visitObjectId', 'objectName']) {
      expect(byKey[key]?.isKnownField, `ключ «${key}» без подписи`).toBe(true)
    }
    expect(byKey.leadName.label).toBe('Старший объекта')
    expect(byKey.action.label).toBe('Действие')
  })

  test('код действия переведён, неизвестный код остаётся как есть', () => {
    const label = (action: string) =>
      auditChanges({}, { action }).find((row) => row.key === 'action')!.after
    expect(label('approval_send')).toBe('Отправил на согласование')
    expect(label('approval_withdraw')).toBe('Отозвал с согласования')
    expect(label('approval_remark_resolve')).toBe('Снял замечание')
    // Прятать неизвестное за «прочее» значило бы скрыть, что именно произошло.
    expect(label('something_new')).toBe('something_new')
  })
})
