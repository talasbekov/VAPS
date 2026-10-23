"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hasCurrentOpsReadAuthority, type OpsReadAccess } from "@/hooks/use-ops-protected-read";

/** Manual report results obey the same actor/scope boundary as query reads. */
export function useOpsReadSnapshot<T>(access: OpsReadAccess, empty: T) {
  const client = useQueryClient();
  const { actor, scope, allowed } = access;
  const [snapshot, setSnapshot] = useState<{ scope: string; revision: number; value: T } | null>(null);
  const revision = useRef(0);
  const isCurrent = useCallback(() => hasCurrentOpsReadAuthority(client, { actor, scope, allowed }),
    [client, actor, scope, allowed]);
  const setValue = useCallback((next: SetStateAction<T>) => {
    if (!isCurrent()) return;
    const nextRevision = ++revision.current;
    setSnapshot(previous => {
      if (!isCurrent()) return previous;
      const current = previous?.scope === scope ? previous.value : empty;
      return { scope, revision: nextRevision, value: typeof next === "function" ? (next as (value: T) => T)(current) : next };
    });
  }, [isCurrent, scope, empty]);

  useEffect(() => {
    setSnapshot(previous => isCurrent() && previous?.scope === scope ? previous : null);
  }, [isCurrent, scope]);

  return { value: isCurrent() && snapshot?.scope === scope ? snapshot.value : empty, setValue, isCurrent,
    canUseValue: () => isCurrent() && snapshot?.scope === scope && snapshot.revision === revision.current };
}
