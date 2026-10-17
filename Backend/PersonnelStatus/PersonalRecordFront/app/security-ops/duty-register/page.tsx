'use client';

import { Suspense } from 'react';
import { DutyRegisterWorkspace } from '@/features/duty-register/ui/DutyRegisterWorkspace';

export default function DutyRegisterPage() {
  return <Suspense fallback={<p role="status">Загрузка журнала дежурств…</p>}><DutyRegisterWorkspace /></Suspense>;
}
