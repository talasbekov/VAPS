// Demo-сид отчётного реестра (§8.7: только синтетические данные).
import type { ReportArtifact, ReportJob } from '../model/types'

/**
 * Определение типа отчёта БЕЗ предела периода: глубина принадлежит политике
 * «Настроек» (§22.5) и приезжает к типу на чтении. Хранить её здесь значило бы
 * держать два источника одного числа — и сеяное побеждало бы отредактированное.
 */
export interface StoredReportType {
  reportTypeCode: string
  safeTitle: string
  description: string
  formats: ReportArtifact['format'][]
}

export interface ServiceReportsSlice {
  jobs: ReportJob[]
  artifacts: ReportArtifact[]
  reportTypes: StoredReportType[]
}

/** §22.19 «Определение отчёта». Один тип — тот, под который есть РЕАЛЬНЫЕ
 * данные (смены дежурств). Второй выдуманный тип был бы пустой строкой в
 * реестре, а не расширением возможностей. */
export const REPORT_TYPES: readonly StoredReportType[] = [
  {
    reportTypeCode: 'PERSONNEL_EXPENSE',
    safeTitle: 'Расход личного состава',
    description:
      'Смены дежурств за период: дата, сотрудник, объект, пост из снимка паспорта, состояние.',
    formats: ['CSV'],
  },
]

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
      reportTypes: REPORT_TYPES.map((type) => ({ ...type })),
    },
  }
}
