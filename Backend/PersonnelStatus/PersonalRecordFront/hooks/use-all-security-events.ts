"use client";

import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { SECURITY_EVENTS_PATH, type ListSecurityEventsResponse, type SecurityEvent } from "@/entities/security-event";

/** Complete registry for links and aggregates that must include every page. */
export function useAllSecurityEvents(options: { enabled: boolean }) {
  return useQuery<SecurityEvent[], Error>({
    queryKey: ["ops-security-events", "all-person-links"],
    enabled: options.enabled,
    queryFn: async ({ signal }) => {
      const events = new Map<string, SecurityEvent>();
      for (let page = 1; ; page++) {
        if (signal.aborted) throw new Error("Загрузка отменена");
        // Build the same-origin path ourselves instead of forwarding a next URL.
        const response = await opsApiClient.get<ListSecurityEventsResponse>(
          `${SECURITY_EVENTS_PATH}?page=${page}&page_size=200`,
        );
        const previousSize = events.size;
        for (const event of response.results) events.set(event.id, event);
        if (!response.next) return [...events.values()];
        if (events.size === previousSize) throw new Error("Не удалось загрузить следующую страницу мероприятий");
      }
    },
  });
}
