"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { moduleOpenFor } from "@/entities/portal-access";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { workspaceHref } from "../model/workspace";

/** A headquarters collection and a department's requests are different views. */
export function EventForcesLink({ eventId, children, className }: {
  eventId: string;
  children: ReactNode;
  className?: string;
}) {
  const params = useSearchParams();
  const access = useOpsPermissions();
  if (access.isLoading || access.error || !moduleOpenFor("/employees", access.hasPermission)) return null;
  const target = access.hasPermission("forces.command") ? { collection: eventId }
    : access.hasPermission("forces.allocate") ? { tab: "requests" as const } : undefined;
  return <Link className={className} href={workspaceHref(new URLSearchParams(params), "forces", target)}>{children}</Link>;
}
