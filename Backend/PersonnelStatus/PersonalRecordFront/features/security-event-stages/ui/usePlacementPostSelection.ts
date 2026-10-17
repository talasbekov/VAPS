"use client";

import { useCallback, useEffect, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReconSectorPost } from '@/entities/security-event';

export function usePlacementPostSelection(posts: readonly ReconSectorPost[], visitId?: string) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const [isSelecting, startSelection] = useTransition();
  const wanted = query.get('post');
  const selected = posts.find(post => post.id === wanted) ?? posts[0] ?? null;

  const selectPost = useCallback((postId: string) => {
    if ((postId === wanted && !query.has('mapTarget')) || !posts.some(post => post.id === postId)) return;
    const next = new URLSearchParams(query);
    next.set('post', postId);
    next.delete('mapTarget');
    startSelection(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }, [pathname, posts, query, router, wanted]);

  useEffect(() => {
    if (wanted === null || posts.some(post => post.id === wanted)) return;
    // The page normalizes an invalid visit first. Two replacements based on
    // the same old URL could otherwise restore one another's invalid values.
    const visitParam = query.get('visit');
    if (visitId !== undefined && visitParam !== null && visitParam !== visitId) return;
    const next = new URLSearchParams(query);
    next.delete('post');
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  }, [pathname, posts, query, router, visitId, wanted]);

  return { selected, selectPost, isSelecting };
}
