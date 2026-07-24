// Русские подписи и badge-классы стадий (прототип «Реестр ОМ», Smart
// Josparlau.dc.html:255-256). Статичные строки классов через cva — конвенция
// feature `traffic-light` (TrafficLightNode.tsx): токен-классы Tailwind,
// НЕ собранный литерал (JIT-сканер видит только целые классы в исходнике).
import { cva } from 'class-variance-authority'
import type { SecurityEventStage } from '../model/types'

export const STAGE_LABEL: Record<SecurityEventStage, string> = {
  BULLETIN: 'Бюллетень',
  RECON: 'Рекогносцировка',
  DEMAND: 'Потребность',
  FORCES: 'Запрос сил',
  PLACEMENT: 'Расстановка',
  APPROVAL: 'Согласование',
  ACKNOWLEDGEMENT: 'Ознакомление',
  CONDUCT: 'Проведение',
  CLOSED: 'Закрыто',
}

export const stageBadgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      stage: {
        BULLETIN: 'bg-purple-100 text-purple-800',
        RECON: 'bg-purple-100 text-purple-800',
        DEMAND: 'bg-amber-100 text-amber-800',
        FORCES: 'bg-amber-100 text-amber-800',
        PLACEMENT: 'bg-blue-100 text-blue-800',
        APPROVAL: 'bg-green-100 text-green-800',
        ACKNOWLEDGEMENT: 'bg-blue-100 text-blue-800',
        CONDUCT: 'bg-green-100 text-green-800',
        CLOSED: 'bg-muted text-muted-foreground',
      } satisfies Record<SecurityEventStage, string>,
    },
  },
)
