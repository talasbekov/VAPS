'use client';

import { createContext, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { resolveWorkspaceRole, resolveWorkspaceView } from '@/features/forces-workspace/model/workspace';
import { navigationFor, navigationHref, sectionForLocation, type NavigationSectionId } from '@/components/navigation/navigation-model';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';

const SectionContext = createContext<{ preferred?: NavigationSectionId; select(id: NavigationSectionId): void }>({ select: () => {} });

export function NavigationSectionProvider({ children }: { children: ReactNode }) {
  const [preferred, select] = useState<NavigationSectionId>();
  const value = useMemo(() => ({ preferred, select }), [preferred]);
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

export function useSectionNavigation() {
  const access = useOpsPermissions();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const query = new URLSearchParams(searchParams);
  const context = useContext(SectionContext);
  const model = navigationFor(access);
  const role = resolveWorkspaceRole(access);
  const defaultMode: 'daily' | 'forces' = role === 'responsible' || role === 'headquarters' || role === 'expense'
    ? resolveWorkspaceView(role, new URLSearchParams(), access.hasPermission('status.view')) === 'daily' ? 'daily' : 'forces'
    : 'daily';
  const sectionId = sectionForLocation(pathname, query, model.sections, context.preferred, defaultMode);
  useEffect(() => {
    if (sectionId && context.preferred !== sectionId) context.select(sectionId);
  }, [sectionId, context]);
  return { ...model, sectionId, selectSection: context.select, pathname, query, defaultMode };
}

function TopNavigationContent() {
  const { sections, sectionId, selectSection, pathname, query } = useSectionNavigation();
  return <nav className="sj-top-navigation" aria-label="Разделы системы">
    {sections.map(section => <Link
      key={section.id}
      href={navigationHref(section.items[0], pathname, query)}
      data-section={section.id}
      aria-current={section.id === sectionId ? 'true' : undefined}
      onClick={() => selectSection(section.id)}
    >{section.title}</Link>)}
  </nav>;
}

export function TopNavigation() {
  return <Suspense fallback={<nav className="sj-top-navigation" aria-label="Разделы системы" aria-busy="true" />}><TopNavigationContent /></Suspense>;
}

function NavigationBreadcrumbsContent() {
  const { sectionId } = useSectionNavigation();
  return <Breadcrumbs sectionId={sectionId} />;
}
export function NavigationBreadcrumbs() {
  return <Suspense fallback={null}><NavigationBreadcrumbsContent /></Suspense>;
}
