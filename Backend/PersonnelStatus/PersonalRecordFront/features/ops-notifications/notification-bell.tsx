"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeOpsWsMessages } from "@/lib/ops-ws";

/** Transport messages request fresh server data; they never represent unread counts. */
export function OpsNotificationSync() {
  const queryClient = useQueryClient();
  useEffect(() => subscribeOpsWsMessages(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] }),
      queryClient.invalidateQueries({ queryKey: ["ops-ratings", "notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["ops-notifications", "feed"] }),
    ]);
  }), [queryClient]);
  return null;
}
