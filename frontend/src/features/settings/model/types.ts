// Настройки (§29 мастер-промпта). Промпт объединяет аудит и настройки одним
// разделом, но требует РАЗДЕЛИТЬ ответственность: `/audit` — read-only
// operational audit, `/settings` — role-restricted administration. Здесь
// вторая половина.
//
// ЧТО ИМЕННО АДМИНИСТРИРУЕТСЯ. Список §29 («status types, conflict rules,
// rating rules, weather corrections, notification settings, demo feature
// flags, system settings, reset demo data, dictionaries») покрыт ровно в той
// части, под которой есть живой потребитель:
//
// * ПОЛИТИКА НАБЛЮДЕНИЙ §22.11 — допуски и пороги детекторов блока «Требует
//   внимания». Их читает аналитика службы, поэтому изменение здесь ВИДНО на
//   другом экране, а не остаётся украшением.
// * `reset demo data`, `feature flags`, persona/scenario — сознательно НЕ
//   сюда: §8.3 прямо называет их `mock-only-demo` runtime-функциями, которым
//   запрещено появляться в продуктовом API. Они и остаются в DemoToolbar.
// * `status types`/`dictionaries` уже администрируются разделом «Справочники»
//   (§30) — дублировать их вторым экраном значило бы завести второй источник
//   истины для одних и тех же значений.
// * `rating rules` — рейтингов в этой сборке нет (сознательный scope cut
//   A24), настройка без предмета была бы мёртвой (§35).

/** Единица измерения значения. Нужна, чтобы экран не подписывал «3» без смысла. */
export type SettingValueType = 'DAYS' | 'PERCENT' | 'COUNT' | 'HOURS'

/** Поле определения детектора §22.11, которым управляет запись настройки. */
export type SettingField = 'PARAMETER' | 'WARNING_FROM' | 'CRITICAL_FROM'

export interface PolicySetting {
  settingCode: string
  sectionCode: 'ATTENTION_POLICY'
  /** `categoryCode` детектора §22.11, к которому относится значение. */
  detectorCode: string
  field: SettingField
  safeLabel: string
  /** Что именно меняется — своими словами, не пересказ имени поля. */
  description: string
  valueType: SettingValueType
  value: number
  /** Границы приходят с СЕРВЕРА вместе со значением: диапазон — часть
   * политики, а не догадка формы (иначе клиент и сервер разошлись бы). */
  minValue: number
  maxValue: number
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * Запись журнала изменений §29 («кто, когда, что, old/new, reason»).
 * Собственный журнал фичи, а НЕ запись в `/api/audit/logs/`: тот в этой сборке
 * read-only витрина фиксированных данных, и дописывание в чужой аггрегат
 * нарушило бы ARCH-FE-013 — тот же вывод, что у ленты обращения и журнала
 * переходов ОМ, которые тоже ведут свой журнал.
 */
export interface SettingChangeEvent {
  id: string
  settingCode: string
  safeLabel: string
  oldValue: number
  newValue: number
  reason: string
  actorUserId: string
  changedAt: string
  /** Версия политики ПОСЛЕ изменения — по ней снимок аналитики сопоставляется
   * с методикой, по которой считался. */
  policyVersionAfter: string
}
