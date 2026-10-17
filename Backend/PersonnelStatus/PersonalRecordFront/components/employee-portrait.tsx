'use client';

import { useState } from 'react';
import { photoSrc } from '@/entities/employee/model/photo-src';

export function EmployeePortrait({ name, photoUrl, className = 'h-12 w-12' }: {
  name: string;
  photoUrl?: string | null;
  className?: string;
}) {
  const source = photoSrc(photoUrl, null, '');
  // Portraits use the application's media proxy, never an external image host.
  const src = source.startsWith('/') && !source.startsWith('//') && !source.includes('\\') ? source : '';
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toLocaleUpperCase('ru-RU') || '—';
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary-ink ${className}`} data-testid="employee-portrait">
    {src && failedSource !== src
      ? <img src={src} alt={`Фото: ${name}`} loading="lazy" className="h-full w-full object-cover" onError={() => setFailedSource(src)} />
      : <span aria-hidden="true" data-testid="employee-initials">{initials}</span>}
  </span>;
}
