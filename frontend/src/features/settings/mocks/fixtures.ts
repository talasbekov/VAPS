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
import type { SettingChangeEvent, StoredSetting } from '../model/types'

export interface SettingsSlice {
  policyVersion: string
  /** Версия правил конфликтов §21.34 — СВОЯ: см. `SettingSectionCode`. */
  conflictPolicyVersion: string
  settings: StoredSetting[]
  changeLog: SettingChangeEvent[]
}

export const INITIAL_POLICY_VERSION = 'attention-policy-2026.07.1'
export const INITIAL_CONFLICT_POLICY_VERSION = 'conflict-rules-2026.07.1'

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
export const POLICY_SETTINGS: readonly StoredSetting[] = [
  {
    settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'ACKNOWLEDGEMENT_MISSING',
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
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.WARNING_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'ACKNOWLEDGEMENT_MISSING',
    field: 'WARNING_FROM',
    safeLabel: 'Записей без отметки — порог предупреждения',
    description: 'С какого количества записей наблюдение показывается как предупреждение.',
    valueType: 'COUNT',
    value: 1,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.ACKNOWLEDGEMENT_MISSING.CRITICAL_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'ACKNOWLEDGEMENT_MISSING',
    field: 'CRITICAL_FROM',
    safeLabel: 'Записей без отметки — критический порог',
    description: 'С какого количества записей наблюдение становится критическим.',
    valueType: 'COUNT',
    value: 4,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.CONFLICT_SHARE.WARNING_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'CONFLICT_SHARE',
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
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.CONFLICT_SHARE.CRITICAL_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'CONFLICT_SHARE',
    field: 'CRITICAL_FROM',
    safeLabel: 'Доля конфликтных записей — критический порог',
    description: 'С какой доли записей периода наблюдение становится критическим.',
    valueType: 'PERCENT',
    value: 34,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.UNFINISHED_OVERDUE.PARAMETER',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'UNFINISHED_OVERDUE',
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
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.UNFINISHED_OVERDUE.WARNING_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'UNFINISHED_OVERDUE',
    field: 'WARNING_FROM',
    safeLabel: 'Незавершённых записей — порог предупреждения',
    description: 'С какого количества просроченных записей наблюдение становится предупреждением.',
    valueType: 'COUNT',
    value: 1,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.UNFINISHED_OVERDUE.CRITICAL_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'UNFINISHED_OVERDUE',
    field: 'CRITICAL_FROM',
    safeLabel: 'Незавершённых записей — критический порог',
    description: 'С какого количества просроченных записей наблюдение становится критическим.',
    valueType: 'COUNT',
    value: 5,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.UNCONFIRMED_OVERDUE.PARAMETER',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'UNCONFIRMED_OVERDUE',
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
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.UNCONFIRMED_OVERDUE.WARNING_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'UNCONFIRMED_OVERDUE',
    field: 'WARNING_FROM',
    safeLabel: 'Неподтверждённых записей — порог предупреждения',
    description: 'С какого количества записей наблюдение показывается как предупреждение.',
    valueType: 'COUNT',
    value: 1,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.UNCONFIRMED_OVERDUE.CRITICAL_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'UNCONFIRMED_OVERDUE',
    field: 'CRITICAL_FROM',
    safeLabel: 'Неподтверждённых записей — критический порог',
    description: 'С какого количества записей наблюдение становится критическим.',
    valueType: 'COUNT',
    value: 4,
    minValue: 1,
    maxValue: 100,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.SOURCE_AGE.PARAMETER',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'SOURCE_AGE',
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
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'ATTENTION.SOURCE_AGE.WARNING_FROM',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode:'SOURCE_AGE',
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
    editable: true,
    lockedReason: null,
  },
]

/**
 * Правила конфликтов §29 (`conflict rules`). §21.35 разделяет владение прямо:
 * СРОК обязательного отдыха — у вида дежурства («используй `restAfterMinutes`
 * вида дежурства»), РЕЖИМ — глобальная серверная политика
 * (`REST_AFTER_DUTY_POLICY`, значения `HARD_BLOCK` / `SOFT_OVERRIDE`). До этого
 * среза режим лежал атрибутом вида — то есть глобальной действующей политики,
 * которую §21.35 велит читать, не существовало и администрировать её было
 * негде.
 */
export const CONFLICT_RULE_SETTINGS: readonly StoredSetting[] = [
  {
    settingCode: 'CONFLICT.REST_AFTER_DUTY.MODE',
    kind: 'CHOICE',
    sectionCode: 'CONFLICT_RULES',
    groupCode: 'REST_AFTER_DUTY',
    field: 'MODE',
    safeLabel: 'Режим обязательного отдыха после дежурства',
    description:
      'Как поступать с назначением, попадающим в период обязательного отдыха. Длительность отдыха режимом не задаётся — она остаётся свойством вида дежурства.',
    valueType: 'MODE',
    // Сеяное значение — мягкое, а дефолт при ОТСУТСТВИИ политики — жёсткий
    // (§21.35 «по умолчанию применяй REST_AFTER_DUTY_POLICY=HARD_BLOCK»). Это
    // не противоречие: сид демонстрирует обход с обоснованием, который иначе
    // недостижим ни на одном экране, а дефолт отвечает на другой вопрос —
    // что делать, когда действующего значения нет вовсе.
    value: 'SOFT_OVERRIDE',
    options: [
      {
        value: 'HARD_BLOCK',
        safeLabel: 'Жёсткий запрет',
        description:
          'Назначение в период отдыха отвергается (422). Обойти нельзя ни с каким правом.',
      },
      {
        value: 'SOFT_OVERRIDE',
        safeLabel: 'Обход с обоснованием',
        description:
          'Назначение отвергается (409), но может быть подтверждено с указанием причины — след остаётся в аудите.',
      },
    ],
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
  },
  {
    settingCode: 'CONFLICT.DUTY_OVERLAP.MODE',
    kind: 'CHOICE',
    sectionCode: 'CONFLICT_RULES',
    groupCode: 'DUTY_OVERLAP',
    field: 'MODE',
    safeLabel: 'Режим пересечения дежурств',
    description:
      'Как поступать со вторым дежурством того же сотрудника в тот же день.',
    valueType: 'MODE',
    value: 'HARD_BLOCK',
    options: [
      {
        value: 'HARD_BLOCK',
        safeLabel: 'Жёсткий запрет',
        description: 'Второе дежурство в тот же день отвергается (422).',
      },
    ],
    updatedAt: null,
    updatedBy: null,
    // Правило показано, но не редактируется: §21.34 относит пересечение к
    // hard-конфликтам и запрещает их обходить — единственный вариант здесь не
    // «выбор из одного», а отсутствие выбора, и сказать об этом должен сервер.
    editable: false,
    lockedReason:
      'Пересечение с другим дежурством — hard-конфликт (§21.34): его нельзя обойти, поэтому режим не переключается.',
  },
]

export function buildSettingsSeed(): { sliceName: string; data: SettingsSlice } {
  return {
    sliceName: 'settings',
    data: {
      policyVersion: INITIAL_POLICY_VERSION,
      conflictPolicyVersion: INITIAL_CONFLICT_POLICY_VERSION,
      settings: [...POLICY_SETTINGS, ...CONFLICT_RULE_SETTINGS].map((item) => ({ ...item })),
      // Журнал пуст: сеяных «изменений» не бывает — они не происходили.
      changeLog: [],
    },
  }
}
