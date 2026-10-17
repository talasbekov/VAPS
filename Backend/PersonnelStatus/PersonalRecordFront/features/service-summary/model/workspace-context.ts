"use client";

import { createContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

export interface ServiceSummaryContext {
  root_division_id: number;
  root_name: string;
  can_generate_root_summary: boolean;
}

export const ServiceSummaryRootContext = createContext<number | null>(null);
export const ServiceSummaryRootActionContext = createContext(false);
export const ServiceSummaryWorkspaceReadyContext = createContext(false);

export function useServiceSummaryContext(enabled: boolean) {
  return useQuery<ServiceSummaryContext, OpsApiFailure>({
    queryKey: ["service-summary-context"],
    queryFn: () => opsApiClient.get("/api/operations/service-summary-context/"),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    // Scope can change while aggregate permissions stay the same. Revalidate
    // this authority alongside ops-me when returning to the workspace.
    refetchOnWindowFocus: "always",
    retry: false,
  });
}
