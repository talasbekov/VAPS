"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { OpsPermissionsUnavailable, isPermissionsCheckFailure } from "@/components/ops-permissions-unavailable";
import { OpsPermissionSuspensionContext, OpsProtectedPortalContext, OpsProtectedInteractionContext } from "@/lib/ops-permission-suspension";

function PermissionContent({ pending, children }: { pending: Promise<void> | null; children: ReactNode }) {
  if (pending) throw pending;
  return <>{children}</>;
}

/** Keep a known editor mounted and hidden during a transient authority check.
 * Explicit denial still reconciles normal page gates and removes its data. */
export function OpsPermissionBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { error, isLoading, canSuspendOnFailure } = useOpsPermissions();
  const [isRetrying, setIsRetrying] = useState(false);
  const interactionBlocked = useRef(false);
  interactionBlocked.current = canSuspendOnFailure;
  const readInteractionBlocked = useCallback(() => interactionBlocked.current, []);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const retainPortalContainer = useCallback((node: HTMLDivElement | null) => {
    // Suspense detaches this ref while hidden. Keep the last portal target
    // so an open dialog cannot move back into the visible document body.
    if (node) setPortalContainer(node);
  }, []);
  const suspension = useMemo(() => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }, [canSuspendOnFailure]);
  useEffect(() => () => suspension.resolve(), [suspension]);

  const unavailable = <OpsPermissionsUnavailable isRetrying={isRetrying || isLoading} onRetry={() => {
    setIsRetrying(true);
    client.refetchQueries({ queryKey: ["ops-me"] }).finally(() => setIsRetrying(false));
  }} />;
  const permissionFailure = isPermissionsCheckFailure(error);
  if (permissionFailure && !canSuspendOnFailure) return unavailable;
  // Descendants also suspend for route/data loading. That is not evidence
  // that the permissions request failed; keep its recovery screen for errors.
  const fallback = permissionFailure ? unavailable : (
    <div role="status" aria-busy="true" className="flex min-h-screen items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      Загружаем раздел…
    </div>
  );

  return <OpsPermissionSuspensionContext.Provider value={suspension.promise}>
    <OpsProtectedPortalContext.Provider value={portalContainer}>
      <OpsProtectedInteractionContext.Provider value={readInteractionBlocked}>
        <Suspense fallback={fallback}>
          <PermissionContent pending={canSuspendOnFailure ? suspension.promise : null}>
            <div ref={retainPortalContainer}>{children}</div>
          </PermissionContent>
        </Suspense>
      </OpsProtectedInteractionContext.Provider>
    </OpsProtectedPortalContext.Provider>
  </OpsPermissionSuspensionContext.Provider>;
}
