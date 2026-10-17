"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getProfile } from "../api/edit-profile-api";

export function useAccountProfile(enabled = false) {
  const { user } = useAuth();
  const queryKey = ["account-profile", user?.id] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getProfile(signal),
    enabled: enabled && Boolean(user?.id),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  return { ...query, queryKey };
}
