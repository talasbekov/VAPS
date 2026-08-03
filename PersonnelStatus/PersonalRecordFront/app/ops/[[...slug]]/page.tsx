'use client'
// Smart Josparlau — раздел ВНУТРИ каркаса старого фронта (Этап M4): вокруг —
// их DashboardLayout (сайдбар и шапка PersonalRecordFront), контент — SPA
// переноса (свой chrome выключен флагом VITE_EMBEDDED_CHROME). SSR выключен —
// mock-runtime (MSW worker + IndexedDB) существует только в браузере.
import dynamic from 'next/dynamic'
import { DashboardLayout } from '@/components/dashboard-layout'

const JosparlauMount = dynamic(() => import('@/josparlau/mount'), { ssr: false })

export default function OpsPage() {
  return (
    <DashboardLayout>
      <JosparlauMount />
    </DashboardLayout>
  )
}
