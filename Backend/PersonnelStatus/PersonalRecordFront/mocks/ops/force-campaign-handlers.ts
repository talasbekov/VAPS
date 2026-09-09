import { http, HttpResponse } from "msw";

import type { SecurityEvent } from "@/entities/security-event";
import type { ForceCampaign } from "@/hooks/use-force-campaigns";
import { readEventsStore } from "./security-events-handlers";

const PATH = "/api/ops/security-events/forces/campaigns/";
const RESERVES_PATH = "/api/ops/security-events/forces/campaign-reserves/";
let campaigns: ForceCampaign[] = [];

function error(status: number, errorCode: string, message: string, details = {}) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details,
      request_id: null,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}

function eventRow(event: SecurityEvent): ForceCampaign["events"][number] {
  return {
    eventId: event.id,
    code: event.code,
    title: event.title,
    businessDate: event.businessDate,
    businessDateEnd: event.businessDateEnd ?? null,
    eventTime: event.eventTime ?? null,
    visitObjects: event.visitObjects.map((visit) => ({
      visitObjectId: visit.id,
      objectName: visit.objectName,
    })),
    demandRows: event.demandRows,
  };
}

function poolOf(events: SecurityEvent[]): ForceCampaign["pool"] {
  const rows = new Map<string, ForceCampaign["pool"][number]>();
  for (const event of events) {
    for (const member of event.forceRoster) {
      const row = rows.get(member.employeeId) ?? {
        employeeId: member.employeeId,
        employeeName: member.name,
        kindCode: "PHYSICAL_SQUAD",
        sourceEventIds: [],
      };
      row.sourceEventIds.push(event.id);
      rows.set(member.employeeId, row);
    }
  }
  return [...rows.values()];
}

function findCampaign(id: string) {
  return campaigns.find((campaign) => campaign.id === id);
}

export const forceCampaignHandlers = [
  http.get(`*${RESERVES_PATH}`, () =>
    HttpResponse.json({
      results: campaigns.flatMap((campaign) => {
        const assigned = new Set(
          campaign.assignments.map((row) => row.employeeId)
        );
        return campaign.pool
          .filter((row) => !assigned.has(row.employeeId))
          .map((row) => ({
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            campaignId: campaign.id,
            campaignCode: campaign.code,
            campaignTitle: campaign.title,
            kindCode: row.kindCode,
          }));
      }),
    })
  ),
  http.get(`*${PATH}`, () => HttpResponse.json({ results: campaigns })),
  http.post(`*${PATH}`, async ({ request }) => {
    const body = (await request.json()) as { title?: string; eventIds?: string[] };
    const title = (body.title ?? "").trim();
    const eventIds = [...new Set(body.eventIds ?? [])];
    if (!title || eventIds.length === 0) {
      return error(400, "VALIDATION_ERROR", "Проверьте заполнение формы.", {
        ...(!title ? { title: ["Укажите название распределения."] } : {}),
        ...(eventIds.length === 0
          ? { eventIds: ["Выберите хотя бы одно мероприятие."] }
          : {}),
      });
    }
    const events = readEventsStore().filter((event) => eventIds.includes(event.id));
    if (events.length !== eventIds.length) {
      return error(404, "ENTITY_NOT_FOUND", "Мероприятие не найдено.");
    }
    const id = `campaign-${Date.now()}`;
    const campaign: ForceCampaign = {
      id,
      code: `РМ-${new Date().getFullYear()}-${campaigns.length + 1}`,
      title,
      status: "DRAFT",
      events: events.map(eventRow),
      pool: poolOf(events),
      assignments: [],
      warnings: events
        .filter((event) => !event.eventTime)
        .map((event) => ({
          eventId: event.id,
          message: `У ${event.code} не указано время — точное перекрытие назначений проверить нельзя.`,
        })),
    };
    campaigns = [campaign, ...campaigns];
    return HttpResponse.json(campaign, { status: 201 });
  }),
  http.get(`*${PATH}:campaignId/`, ({ params }) => {
    const campaign = findCampaign(String(params.campaignId));
    return campaign
      ? HttpResponse.json(campaign)
      : error(404, "ENTITY_NOT_FOUND", "Распределение сил не найдено.");
  }),
  http.post(`*${PATH}:campaignId/assignments/`, async ({ params, request }) => {
    const campaign = findCampaign(String(params.campaignId));
    if (!campaign) return error(404, "ENTITY_NOT_FOUND", "Распределение сил не найдено.");
    if (campaign.status === "HANDED_OVER") {
      return error(422, "FORCE_CAMPAIGN_HANDED_OVER", "Распределение уже передано в расстановку.");
    }
    const body = (await request.json()) as {
      employeeId?: string;
      eventId?: string;
      visitObjectId?: string;
      demandRowId?: string;
      overrideConflict?: boolean;
      overrideReason?: string;
    };
    const person = campaign.pool.find((row) => row.employeeId === body.employeeId);
    const event = campaign.events.find((row) => row.eventId === body.eventId);
    const visit = event?.visitObjects.find((row) => row.visitObjectId === body.visitObjectId);
    const demand = event?.demandRows.find((row) => row.id === body.demandRowId);
    if (!person || !event || !visit || !demand || demand.visitObjectId !== visit.visitObjectId) {
      return error(400, "VALIDATION_ERROR", "Проверьте назначение.");
    }
    const overlap = campaign.assignments.some((row) => {
      if (row.employeeId !== person.employeeId) return false;
      const existing = campaign.events.find((item) => item.eventId === row.eventId);
      if (!existing) return false;
      const leftEnd = existing.businessDateEnd ?? existing.businessDate;
      const rightEnd = event.businessDateEnd ?? event.businessDate;
      return existing.businessDate <= rightEnd && event.businessDate <= leftEnd;
    });
    if (overlap && !body.overrideConflict) {
      return error(422, "FORCE_CAMPAIGN_TIME_CONFLICT", "Сотрудник уже назначен на пересекающееся мероприятие.");
    }
    if (overlap && !(body.overrideReason ?? "").trim()) {
      return error(400, "VALIDATION_ERROR", "Для назначения с конфликтом укажите причину.", {
        overrideReason: ["Для назначения с конфликтом укажите причину."],
      });
    }
    campaign.assignments.push({
      id: `assignment-${Date.now()}`,
      employeeId: person.employeeId,
      employeeName: person.employeeName,
      eventId: event.eventId,
      visitObjectId: visit.visitObjectId,
      demandRowId: demand.id,
      kindCode: demand.kindCode ?? "PHYSICAL_SQUAD",
      overrideReason: (body.overrideReason ?? "").trim(),
    });
    campaign.status = "DISTRIBUTING";
    return HttpResponse.json(campaign, { status: 201 });
  }),
  http.post(`*${PATH}:campaignId/hand-over/`, async ({ params, request }) => {
    const campaign = findCampaign(String(params.campaignId));
    if (!campaign) return error(404, "ENTITY_NOT_FOUND", "Распределение сил не найдено.");
    const body = (await request.json()) as { comment?: string };
    const assigned = new Set(campaign.assignments.map((row) => row.employeeId));
    if (campaign.pool.some((row) => !assigned.has(row.employeeId)) && !(body.comment ?? "").trim()) {
      return error(400, "VALIDATION_ERROR", "При неполном распределении укажите причину передачи.", {
        comment: ["При неполном распределении укажите причину передачи."],
      });
    }
    campaign.status = "HANDED_OVER";
    return HttpResponse.json(campaign);
  }),
];
