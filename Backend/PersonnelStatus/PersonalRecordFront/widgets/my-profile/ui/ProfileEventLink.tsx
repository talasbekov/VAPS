"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { moduleOpenFor } from "@/entities/portal-access";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

/** Both assignment titles and personal instructions use the event module's gate. */
export function ProfileEventLink({ eventId, className, children, hideWithoutAccess = false }: {
  eventId: string;
  className: string;
  children: ReactNode;
  hideWithoutAccess?: boolean;
}) {
  const access = useOpsPermissions();
  const allowed = !access.isLoading && !access.error && moduleOpenFor("/security-ops/events", access.hasPermission,
    code => access.roles.some(role => role.code === code));
  if (!allowed) return hideWithoutAccess ? null : <span className={className}>{children}</span>;
  return <Link href={`/security-ops/events/${eventId}`} className={className}>{children}</Link>;
}
