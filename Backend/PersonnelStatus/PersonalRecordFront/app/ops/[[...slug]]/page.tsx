'use client'
// Smart Josparlau — клиентский под-app (перенос из Vite-фронта): весь роутинг
// внутри ведёт React Router с basename /ops; SSR выключен — mock-runtime
// (MSW worker + IndexedDB) существует только в браузере.
import dynamic from 'next/dynamic'

const JosparlauMount = dynamic(() => import('@/josparlau/mount'), { ssr: false })

export default function OpsPage() {
  return <JosparlauMount />
}
