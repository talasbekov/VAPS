'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { dutyWorkspaceHref, type DutyWorkspaceSection } from '../model/workspace';

export function LegacyDutyRedirect({ section }: { section: DutyWorkspaceSection }) {
  const router = useRouter();
  const params = useSearchParams();
  const href = dutyWorkspaceHref(section, new URLSearchParams(params));
  useEffect(() => { router.replace(href, { scroll: false }); }, [href, router]);
  return <p role="status">Открываем журнал дежурств…</p>;
}
