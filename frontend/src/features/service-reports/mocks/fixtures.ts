// Demo-сид отчётного реестра (§8.7: только синтетические данные).
import type {
  ReportArtifact,
  ReportJob,
  ReportRetentionPolicy,
  ReportTypeDefinition,
} from '../model/types'

export interface ServiceReportsSlice {
  jobs: ReportJob[]
  artifacts: ReportArtifact[]
  reportTypes: ReportTypeDefinition[]
  retentionPolicy: ReportRetentionPolicy
}

/** §22.19 «Определение отчёта». Один тип — тот, под который есть РЕАЛЬНЫЕ
 * данные (смены дежурств). Второй выдуманный тип был бы пустой строкой в
 * реестре, а не расширением возможностей. */
export const REPORT_TYPES: readonly ReportTypeDefinition[] = [
  {
    reportTypeCode: 'PERSONNEL_EXPENSE',
    safeTitle: 'Расход личного состава',
    description:
      'Смены дежурств за период: дата, сотрудник, объект, пост из снимка паспорта, состояние.',
    formats: ['CSV'],
    // §22.19: глубина периода — параметр политики, а не число в форме. 92 дня
    // (квартал), НАМЕРЕННО не круглые 90: совпадение с «привычным» числом
    // скрыло бы захардкоженное ограничение, если бы оно где-то осталось —
    // тот же приём, что интервал 120 в политике свежести паспорта (§21.7).
    maxPeriodDays: 92,
  },
]

/** §22.22: срок хранения артефакта — в ДАННЫХ. Хардкода «файлы доступны 30
 * дней» в проекте нет; 21 день — снова не круглое «привычное» число. */
export const RETENTION_POLICY: ReportRetentionPolicy = {
  retentionDays: 21,
  policyVersion: 'retention-2026.07.1',
}

export function buildServiceReportsSeed(): {
  sliceName: string
  data: ServiceReportsSlice
} {
  // Ни работ, ни артефактов: отчёт — действие человека, и «уже сформирован»
  // из сида читался бы как чья-то реальная выгрузка, которой не было.
  return {
    sliceName: 'serviceReports',
    data: {
      jobs: [],
      artifacts: [],
      reportTypes: [...REPORT_TYPES],
      retentionPolicy: { ...RETENTION_POLICY },
    },
  }
}
