"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

const PATH = "/api/ops/security-events/forces/campaigns/";
export const FORCE_CAMPAIGNS_KEY = ["ops-force-campaigns"] as const;
export const FORCE_CAMPAIGN_RESERVES_KEY = ["ops-force-campaign-reserves"] as const;

export interface ForceCampaignReserve {
  employeeId: string;
  employeeName: string;
  campaignId: string;
  campaignCode: string;
  campaignTitle: string;
  kindCode: string;
}

export interface ForceCampaignDemand {
  id: string;
  visitObjectId?: string | null;
  kindCode?: string;
  place?: string;
  specification?: string;
  need?: number;
}

export interface ForceCampaignEvent {
  eventId: string;
  code: string;
  title: string;
  businessDate: string;
  businessDateEnd: string | null;
  eventTime: string | null;
  visitObjects: { visitObjectId: string; objectName: string }[];
  demandRows: ForceCampaignDemand[];
}

export interface ForceCampaign {
  id: string;
  code: string;
  title: string;
  status: "DRAFT" | "GATHERING" | "DISTRIBUTING" | "HANDED_OVER" | "CLOSED";
  events: ForceCampaignEvent[];
  pool: {
    employeeId: string;
    employeeName: string;
    kindCode: string;
    sourceEventIds: string[];
  }[];
  assignments: {
    id: string;
    employeeId: string;
    employeeName: string;
    eventId: string;
    visitObjectId: string;
    demandRowId: string;
    kindCode: string;
    overrideReason: string;
  }[];
  warnings: { eventId: string; message: string }[];
}

export function useForceCampaigns(enabled = true) {
  return useQuery<{ results: ForceCampaign[] }, OpsApiFailure>({
    queryKey: FORCE_CAMPAIGNS_KEY,
    queryFn: () => opsApiClient.get(PATH),
    enabled,
  });
}

export function useForceCampaignReserves(enabled = true) {
  return useQuery<{ results: ForceCampaignReserve[] }, OpsApiFailure>({
    queryKey: FORCE_CAMPAIGN_RESERVES_KEY,
    queryFn: () =>
      opsApiClient.get("/api/ops/security-events/forces/campaign-reserves/"),
    enabled,
  });
}

export function useForceCampaign(id: string | null, enabled = true) {
  return useQuery<ForceCampaign, OpsApiFailure>({
    queryKey: ["ops-force-campaign", id],
    queryFn: () => opsApiClient.get(`${PATH}${id}/`),
    enabled: enabled && id !== null,
  });
}

function useCampaignMutation<TBody>(
  mutationFn: (body: TBody) => Promise<ForceCampaign>
) {
  const client = useQueryClient();
  return useMutation<ForceCampaign, OpsApiFailure, TBody>({
    mutationFn,
    onSuccess: (campaign) => {
      client.setQueryData(["ops-force-campaign", campaign.id], campaign);
      void client.invalidateQueries({ queryKey: FORCE_CAMPAIGNS_KEY });
      void client.invalidateQueries({ queryKey: ["ops-force-collections"] });
      void client.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}

export function useCreateForceCampaign() {
  return useCampaignMutation<{ title: string; eventIds: string[] }>((body) =>
    opsApiClient.post(PATH, body)
  );
}

export function useAssignForceCampaign(id: string) {
  return useCampaignMutation<{
    employeeId: string;
    eventId: string;
    visitObjectId: string;
    demandRowId: string;
    overrideConflict?: boolean;
    overrideReason?: string;
  }>((body) => opsApiClient.post(`${PATH}${id}/assignments/`, body));
}

export function useHandOverForceCampaign(id: string) {
  return useCampaignMutation<{ comment: string }>((body) =>
    opsApiClient.post(`${PATH}${id}/hand-over/`, body)
  );
}
