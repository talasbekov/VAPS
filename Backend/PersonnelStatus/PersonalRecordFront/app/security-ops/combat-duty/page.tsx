'use client';

import { Suspense } from 'react';
import { LegacyDutyRedirect } from '@/features/duty-register/ui/LegacyDutyRedirect';

export default function CombatDutyPage() {
  return <Suspense fallback={<p role="status">Загрузка…</p>}><LegacyDutyRedirect section="combat" /></Suspense>;
}
