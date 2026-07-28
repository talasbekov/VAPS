// Demo-сид «Настроек» (§8.7: только синтетические данные).
//
// В слайсе лежит ПОЛИТИКА, а не показатели: допуски и пороги детекторов
// §22.11. Владелец политики — настройки, потребитель — аналитика службы
// (`features/service-analytics/mocks/settingsSlice.ts` читает этот слайс
// узкой проекцией, как читает duties). Обратной зависимости нет: настройки
// ничего не знают про снимок аналитики.
//
// Стартовые значения совпадают с прежними константами детекторов, а
// `policyVersion` — с прежней `ATTENTION_POLICY_VERSION`: перенос владения не
// должен молча изменить наблюдения на первом же запуске.
import type { PolicySetting, SettingChangeEvent } from '../model/types'

export interface SettingsSlice {
  policyVersion: string
  settings: PolicySetting[]
  changeLog: SettingChangeEvent[]
}

export const INITIAL_POLICY_VERSION = 'attention-policy-2026.07.1'

/**
 * Записи настроек. Одна запись — одно администрируемое число, а не «объект
 * детектора целиком»: журнал §29 обязан показывать old/new ОДНОГО значения,
 * а изменение объекта пришлось бы разбирать на поля задним числом.
 *
 * Администрируется только то, что детектор ДЕЙСТВИТЕЛЬНО читает: у
 * `CONFLICT_SHARE` записи `PARAMETER` нет, потому что его мера (доля за
 * период) допуск не использует — настройка появилась бы ради симметрии
 * таблицы и не влияла бы ни на что (§35).
 */
export const POLICY_SETTINGS: readonly PolicySetting[] = [
  {
    settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'ACKNOWLEDGEMENT_MISSING',
    field: 'PARAMETER',
    safeLabel: 'Срок упреждения по отметке об ознакомлении',
    description:
      'За сколько суток до заступления отсутствие отметки становится наблюдением. Смена через месяц без отметки — ещё не повод требовать проверки.',
    valueType: 'DAYS',
    value: 3,
    minValue: 1,
    maxValue: 30,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.WARNING_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'ACKNOWLEDGEMENT_MISSING',
    field: 'WARNING_FROM',
    safeLabel: 'Записей без отметки — порог предупреждения',
    description: 'С какого количества записей наблюдение показывается как предупреждение.',
    valueType: 'COUNT',
    value: 1,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.CRITICAL_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'ACKNOWLEDGEMENT_MISSING',
    field: 'CRITICAL_FROM',
    safeLabel: 'Записей без отметки — критический порог',
    description: 'С какого количества записей наблюдение становится критическим.',
    valueType: 'COUNT',
    value: 4,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.CONFLICT_SHARE.WARNING_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'CONFLICT_SHARE',
    field: 'WARNING_FROM',
    safeLabel: 'Доля конфликтных записей — порог предупреждения',
    description:
      'С какой доли записей периода с конфликтом планирования наблюдение показывается как предупреждение. Считается доля, а не количество: три конфликта на четыре смены и три на сорок — разные наблюдения.',
    valueType: 'PERCENT',
    value: 18,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.CONFLICT_SHARE.CRITICAL_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'CONFLICT_SHARE',
    field: 'CRITICAL_FROM',
    safeLabel: 'Доля конфликтных записей — критический порог',
    description: 'С какой доли записей периода наблюдение становится критическим.',
    valueType: 'PERCENT',
    value: 34,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.UNFINISHED_OVERDUE.PARAMETER',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'UNFINISHED_OVERDUE',
    field: 'PARAMETER',
    safeLabel: 'Допуск незавершённой записи',
    description:
      'Сколько суток запись может оставаться незавершённой, прежде чем это станет наблюдением. Вчерашняя незакрытая смена — обычный ход работы.',
    valueType: 'DAYS',
    value: 2,
    minValue: 1,
    maxValue: 30,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.UNFINISHED_OVERDUE.WARNING_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'UNFINISHED_OVERDUE',
    field: 'WARNING_FROM',
    safeLabel: 'Незавершённых записей — порог предупреждения',
    description: 'С какого количества просроченных записей наблюдение становится предупреждением.',
    valueType: 'COUNT',
    value: 1,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.UNFINISHED_OVERDUE.CRITICAL_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'UNFINISHED_OVERDUE',
    field: 'CRITICAL_FROM',
    safeLabel: 'Незавершённых записей — критический порог',
    description: 'С какого количества просроченных записей наблюдение становится критическим.',
    valueType: 'COUNT',
    value: 5,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.UNCONFIRMED_OVERDUE.PARAMETER',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'UNCONFIRMED_OVERDUE',
    field: 'PARAMETER',
    safeLabel: 'Допуск неподтверждённых отметок времени',
    description:
      'Сколько суток запись может оставаться без подтверждённых отметок фактического времени, прежде чем это станет наблюдением.',
    valueType: 'DAYS',
    value: 2,
    minValue: 1,
    maxValue: 30,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.UNCONFIRMED_OVERDUE.WARNING_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'UNCONFIRMED_OVERDUE',
    field: 'WARNING_FROM',
    safeLabel: 'Неподтверждённых записей — порог предупреждения',
    description: 'С какого количества записей наблюдение показывается как предупреждение.',
    valueType: 'COUNT',
    value: 1,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.UNCONFIRMED_OVERDUE.CRITICAL_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'UNCONFIRMED_OVERDUE',
    field: 'CRITICAL_FROM',
    safeLabel: 'Неподтверждённых записей — критический порог',
    description: 'С какого количества записей наблюдение становится критическим.',
    valueType: 'COUNT',
    value: 4,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.SOURCE_AGE.PARAMETER',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'SOURCE_AGE',
    field: 'PARAMETER',
    safeLabel: 'Допуск возраста источника',
    description:
      'Допуск, который сервер называет в тексте наблюдения. Отдельная запись от порога срабатывания: в сиде они совпадают, но это совпадение значений, а не одно и то же число.',
    valueType: 'HOURS',
    value: 53,
    minValue: 1,
    maxValue: 720,
    updatedAt: null,
    updatedBy: null,
  },
  {
    settingCode: 'ATTENTION.SOURCE_AGE.WARNING_FROM',
    sectionCode: 'ATTENTION_POLICY',
    detectorCode: 'SOURCE_AGE',
    field: 'WARNING_FROM',
    safeLabel: 'Возраст источника — порог предупреждения',
    description:
      'Сколько часов без изменений источника делают наблюдение предупреждением. Утверждение об источнике, а не о людях.',
    valueType: 'HOURS',
    value: 53,
    minValue: 1,
    maxValue: 720,
    updatedAt: null,
    updatedBy: null,
  },
]

export function buildSettingsSeed(): { sliceName: string; data: SettingsSlice } {
  return {
    sliceName: 'settings',
    data: {
      policyVersion: INITIAL_POLICY_VERSION,
      settings: POLICY_SETTINGS.map((item) => ({ ...item })),
      // Журнал пуст: сеяных «изменений» не бывает — они не происходили.
      changeLog: [],
    },
  }
}
