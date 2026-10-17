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
  if (isPermissionsCheckFailure(error) && !canSuspendOnFailure) return unavailable;

  return <OpsPermissionSuspensionContext.Provider value={suspension.promise}>
    <OpsProtectedPortalContext.Provider value={portalContainer}>
      <OpsProtectedInteractionContext.Provider value={readInteractionBlocked}>
        <Suspense fallback={unavailable}>
          <PermissionContent pending={canSuspendOnFailure ? suspension.promise : null}>
            <div ref={retainPortalContainer}>{children}</div>
          </PermissionContent>
        </Suspense>
      </OpsProtectedInteractionContext.Provider>
    </OpsProtectedPortalContext.Provider>
  </OpsPermissionSuspensionContext.Provider>;
}
