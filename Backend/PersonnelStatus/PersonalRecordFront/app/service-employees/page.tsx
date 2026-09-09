import { Suspense } from 'react';
import { ServiceEmployeesScreen } from '@/features/service-employees/ui/ServiceEmployeesScreen';

export default function ServiceEmployeesPage() {
  return <Suspense fallback={<p className="p-6">Загрузка сотрудников…</p>}><ServiceEmployeesScreen /></Suspense>;
}
