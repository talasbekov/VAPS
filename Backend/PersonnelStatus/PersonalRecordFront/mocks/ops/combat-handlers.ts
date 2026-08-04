// Мок-слой «Боевых групп на Трассе» (§24.5-24.10): реестры видов/Трасс/
// кандидатов, смены с процессом §24.1 (потребность → подача → рассмотрение →
// ознакомление → заступление → сдача смены → факт) и заменой до заступления.
// Валидации портированы из repository SPA дословно, включая §24.17
// DOUBLE_ASSIGNMENT (сотрудник не может быть ПРИНЯТ в две группы на одну дату).
import { http, HttpResponse } from "msw";
import {
  COMBAT_ACKNOWLEDGE_PATH_PATTERN,
  COMBAT_CHECKIN_PATH_PATTERN,
  COMBAT_COMPLETE_PATH_PATTERN,
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_HANDOVER_PATH_PATTERN,
  COMBAT_REPLACE_PATH_PATTERN,
  COMBAT_REVIEW_PATH_PATTERN,
  COMBAT_ROSTER_CANDIDATES_PATH,
  COMBAT_ROUTES_PATH,
  COMBAT_SUBMIT_PATH_PATTERN,
} from "@/entities/combat-duty";
import type {
  AcknowledgeCombatDutyRequest,
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  CompleteCombatDutyRequest,
  CreateCombatDutyShiftRequest,
  DutyReplacementRecord,
  DutyRoute,
  RequestCombatDutyReplacementRequest,
  ReviewCombatGroupRequest,
  SubmitCombatDutyHandoverRequest,
  SubmitCombatGroupRequest,
} from "@/entities/combat-duty";

const STORE_KEY = "ops-mock-combat";

interface CombatState {
  shifts: CombatDutyShift[];
  seq: number;
}

// §24.3: два минимальных вида дежурства боевой группы — реестр, не хардкод
// страницы.
const COMBAT_DUTY_TYPES: readonly CombatDutyTypeDefinition[] = [
  {
    dutyTypeCode: "COMBAT_GROUP_SINGLE_ROUTE",
    safeLabel: "Дежурство боевой группы на одной Трассе",
    supportsMultipleRoutes: false,
  },
  {
    dutyTypeCode: "COMBAT_GROUP_MULTI_ROUTE",
    safeLabel: "Дежурство боевой группы на нескольких Трассах",
    supportsMultipleRoutes: true,
  },
];

// §24.9-24.10: реестр Трасс — свой, стабильные routeId.
const ROUTES: readonly DutyRoute[] = [
  { routeId: "route-1", safeLabel: "Трасса №1 (Аэропорт — Резиденция)" },
  { routeId: "route-2", safeLabel: "Трасса №2 (Резиденция — Дворец Независимости)" },
  { routeId: "route-3", safeLabel: "Трасса №3 (Вокзал — Гостиница)" },
];

// Кандидаты в состав — независимый снапшот фичи.
const ROSTER_CANDIDATES: readonly CombatRosterCandidate[] = [
  { employeeName: "Байжанов С.", unitName: "1-е боевое управление" },
  { employeeName: "Дюсенов М.", unitName: "1-е боевое управление" },
  { employeeName: "Кенжебаев А.", unitName: "1-е боевое управление" },
  { employeeName: "Рахимов Т.", unitName: "2-е боевое управление" },
  { employeeName: "Сарсенов Б.", unitName: "2-е боевое управление" },
  { employeeName: "Тастанова Г.", unitName: "2-е боевое управление" },
];

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Сид: три смены сегодняшнего дня, покрывающие все входные состояния процесса
 * — «Требует подачи», SUBMITTED (очередь рассмотрения) и ACCEPTED с открытым
 * execution (демонстрирует ознакомление/заступление/факт без ручной подачи).
 * Составы НЕ пересекаются — иначе DOUBLE_ASSIGNMENT заблокировал бы живую
 * подачу на ту же дату.
 */
function buildSeed(): CombatState {
  const now = nowIso();
  const businessDate = todayIso();
  return {
    shifts: [
      {
        id: "combat-shift-1",
        businessDate,
        dutyTypeCode: "COMBAT_GROUP_SINGLE_ROUTE",
        routeSet: {
          routeSetId: "route-set-1",
          safeLabel: "Трасса №1",
          coverageMode: "RESERVE",
          routeIds: ["route-1"],
        },
        submission: null,
        updatedAt: now,
        requiredEmployees: 2,
      },
      {
        id: "combat-shift-2",
        businessDate,
        dutyTypeCode: "COMBAT_GROUP_MULTI_ROUTE",
        routeSet: {
          routeSetId: "route-set-2",
          safeLabel: "Трассы №2-3",
          coverageMode: "PARALLEL",
          routeIds: ["route-2", "route-3"],
        },
        submission: {
          submittedByUnitName: "2-е боевое управление",
          groupLeaderEmployeeName: "Рахимов Т.",
          memberEmployeeNames: ["Сарсенов Б."],
          reserveEmployeeNames: [],
          stateCode: "SUBMITTED",
          returnReason: null,
          submittedAt: now,
          updatedAt: now,
          execution: null,
          replacements: [],
        },
        updatedAt: now,
        requiredEmployees: 2,
      },
      {
        id: "combat-shift-3",
        businessDate,
        dutyTypeCode: "COMBAT_GROUP_SINGLE_ROUTE",
        routeSet: {
          routeSetId: "route-set-3",
          safeLabel: "Трасса №2 (принятый состав)",
          coverageMode: "RESERVE",
          routeIds: ["route-2"],
        },
        submission: {
          submittedByUnitName: "1-е боевое управление",
          groupLeaderEmployeeName: "Кенжебаев А.",
          memberEmployeeNames: ["Тастанова Г."],
          reserveEmployeeNames: [],
          stateCode: "ACCEPTED",
          returnReason: null,
          submittedAt: now,
          updatedAt: now,
          execution: {
            stateCode: "PENDING_ACKNOWLEDGEMENT",
            acknowledgedMemberNames: [],
            actualStart: null,
            actualEnd: null,
            actualMemberNames: null,
            handover: null,
          },
          replacements: [],
        },
        updatedAt: now,
        requiredEmployees: 2,
      },
    ],
    seq: 0,
  };
}

let state: CombatState | null = null;

function getState(): CombatState {
  if (state === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      state = raw === null ? buildSeed() : (JSON.parse(raw) as CombatState);
    } catch {
      state = buildSeed();
    }
  }
  return state;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // квота/приватный режим
  }
}

function errorEnvelope(errorCode: string, message: string, status: number) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details: {},
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

function notFound(entityId: string) {
  return errorEnvelope("ENTITY_NOT_FOUND", "Смена не найдена.", 404);
}

function save(updated: CombatDutyShift): CombatDutyShift {
  const s = getState();
  s.shifts = s.shifts.map((shift) => (shift.id === updated.id ? updated : shift));
  persist();
  return updated;
}

export const combatHandlers = [
  http.get(`*${COMBAT_DUTY_TYPES_PATH}`, () =>
    HttpResponse.json({ results: COMBAT_DUTY_TYPES.map((t) => ({ ...t })) })
  ),

  http.get(`*${COMBAT_ROUTES_PATH}`, () =>
    HttpResponse.json({ results: ROUTES.map((r) => ({ ...r })) })
  ),

  // Просмотр кандидатов — часть подачи (§24.6); демо-персона право держит.
  http.get(`*${COMBAT_ROSTER_CANDIDATES_PATH}`, () =>
    HttpResponse.json({ results: ROSTER_CANDIDATES.map((c) => ({ ...c })) })
  ),

  http.get(`*${COMBAT_DUTY_SHIFTS_PATH}`, () => {
    const s = getState();
    const sorted = [...s.shifts].sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id)
    );
    return HttpResponse.json({ results: sorted });
  }),

  // §24.1 «формирование потребности» — новая смена, submission: null.
  http.post(`*${COMBAT_DUTY_SHIFTS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateCombatDutyShiftRequest;
    const s = getState();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) {
      return errorEnvelope(
        "INVALID_BUSINESS_DATE",
        "Укажите дату в формате ГГГГ-ММ-ДД.",
        422
      );
    }
    if (body.routeIds.length === 0) {
      return errorEnvelope("EMPTY_ROUTE_SET", "Укажите хотя бы одну Трассу.", 422);
    }
    if (body.requiredEmployees < 1) {
      return errorEnvelope(
        "INVALID_REQUIREMENT",
        "Требуемая численность должна быть не менее 1.",
        422
      );
    }
    const dutyType = COMBAT_DUTY_TYPES.find(
      (t) => t.dutyTypeCode === body.dutyTypeCode
    );
    if (dutyType === undefined) {
      return errorEnvelope("UNKNOWN_DUTY_TYPE", "Неизвестный вид дежурства.", 422);
    }
    if (!dutyType.supportsMultipleRoutes && body.routeIds.length > 1) {
      return errorEnvelope(
        "TOO_MANY_ROUTES",
        "Этот вид дежурства не поддерживает несколько Трасс.",
        422
      );
    }
    const unknownRoute = body.routeIds.find(
      (routeId) => !ROUTES.some((r) => r.routeId === routeId)
    );
    if (unknownRoute !== undefined) {
      return errorEnvelope("UNKNOWN_ROUTE", "Неизвестная Трасса.", 422);
    }
    s.seq += 1;
    const routeLabels = body.routeIds.map(
      (routeId) => ROUTES.find((r) => r.routeId === routeId)?.safeLabel ?? routeId
    );
    const created: CombatDutyShift = {
      id: `combat-shift-new-${s.seq}-${Date.now()}`,
      businessDate: body.businessDate,
      dutyTypeCode: body.dutyTypeCode,
      routeSet: {
        routeSetId: `route-set-new-${s.seq}`,
        safeLabel: routeLabels.join(", "),
        coverageMode: body.coverageMode,
        routeIds: body.routeIds,
      },
      submission: null,
      updatedAt: nowIso(),
      requiredEmployees: body.requiredEmployees,
    };
    s.shifts = [...s.shifts, created];
    persist();
    return HttpResponse.json(created, { status: 201 });
  }),

  // Подача состава (§24.6). Повторная подача — только из RETURNED.
  http.post(`*${COMBAT_SUBMIT_PATH_PATTERN}`, async ({ params, request }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const body = (await request.json()) as SubmitCombatGroupRequest;
    const s = getState();
    if (
      body.groupLeaderEmployeeName.trim() === "" ||
      body.memberEmployeeNames.length === 0
    ) {
      return errorEnvelope(
        "EMPTY_GROUP",
        "Укажите старшего группы и не менее одного участника.",
        422
      );
    }
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    if (existing.submission !== null && existing.submission.stateCode !== "RETURNED") {
      return errorEnvelope(
        "ALREADY_SUBMITTED",
        "Состав уже подан и ожидает либо прошёл рассмотрение — повторная подача недоступна.",
        422
      );
    }
    // §24.17 hard-rule: сотрудник не может быть ПРИНЯТ одновременно в две
    // боевые группы на одну и ту же смену.
    const proposedNames = new Set([
      body.groupLeaderEmployeeName,
      ...body.memberEmployeeNames,
      ...body.reserveEmployeeNames,
    ]);
    const conflict = s.shifts.find((shift) => {
      if (shift.id === id || shift.businessDate !== existing.businessDate)
        return false;
      if (shift.submission === null || shift.submission.stateCode !== "ACCEPTED")
        return false;
      const acceptedNames = [
        shift.submission.groupLeaderEmployeeName,
        ...shift.submission.memberEmployeeNames,
      ];
      return acceptedNames.some((name) => proposedNames.has(name));
    });
    if (conflict !== undefined) {
      return errorEnvelope(
        "DOUBLE_ASSIGNMENT",
        "Один или несколько сотрудников уже приняты в другую боевую группу на эту дату.",
        422
      );
    }
    const now = nowIso();
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        submittedByUnitName: "2-е боевое управление",
        groupLeaderEmployeeName: body.groupLeaderEmployeeName,
        memberEmployeeNames: body.memberEmployeeNames,
        reserveEmployeeNames: body.reserveEmployeeNames,
        stateCode: "SUBMITTED",
        returnReason: null,
        submittedAt: now,
        updatedAt: now,
        execution: null,
        replacements: [],
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),

  // Рассмотрение: принять / вернуть с обязательной причиной.
  http.post(`*${COMBAT_REVIEW_PATH_PATTERN}`, async ({ params, request }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const body = (await request.json()) as ReviewCombatGroupRequest;
    const s = getState();
    if (body.decision === "RETURN" && (body.returnReason ?? "").trim() === "") {
      return errorEnvelope("REASON_REQUIRED", "Причина возврата обязательна.", 422);
    }
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    if (existing.submission === null || existing.submission.stateCode !== "SUBMITTED") {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Рассмотреть можно только поданный и ещё не рассмотренный состав.",
        422
      );
    }
    const now = nowIso();
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        ...existing.submission,
        stateCode: body.decision === "ACCEPT" ? "ACCEPTED" : "RETURNED",
        returnReason: body.decision === "RETURN" ? body.returnReason : null,
        // Принятие открывает пост-lifecycle ознакомления; возврат execution
        // не трогает.
        execution:
          body.decision === "ACCEPT"
            ? {
                stateCode: "PENDING_ACKNOWLEDGEMENT",
                acknowledgedMemberNames: [],
                actualStart: null,
                actualEnd: null,
                actualMemberNames: null,
                handover: null,
              }
            : existing.submission.execution,
        updatedAt: now,
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),

  // §24.19: индивидуальное ознакомление (старший+состав, БЕЗ резерва).
  http.post(`*${COMBAT_ACKNOWLEDGE_PATH_PATTERN}`, async ({ params, request }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const body = (await request.json()) as AcknowledgeCombatDutyRequest;
    const s = getState();
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    const submission = existing.submission;
    if (
      submission === null ||
      submission.stateCode !== "ACCEPTED" ||
      submission.execution === null
    ) {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Ознакомиться можно только с принятым составом.",
        422
      );
    }
    if (submission.execution.stateCode !== "PENDING_ACKNOWLEDGEMENT") {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Ознакомление уже завершено для всего состава.",
        422
      );
    }
    const requiredNames = [
      submission.groupLeaderEmployeeName,
      ...submission.memberEmployeeNames,
    ];
    if (!requiredNames.includes(body.employeeName)) {
      return errorEnvelope(
        "NOT_IN_ROSTER",
        "Ознакомиться может только старший или участник основного состава.",
        422
      );
    }
    if (submission.execution.acknowledgedMemberNames.includes(body.employeeName)) {
      return errorEnvelope(
        "ALREADY_ACKNOWLEDGED",
        "Этот сотрудник уже подтвердил ознакомление.",
        422
      );
    }
    const acknowledgedMemberNames = [
      ...submission.execution.acknowledgedMemberNames,
      body.employeeName,
    ];
    const allAcknowledged = requiredNames.every((name) =>
      acknowledgedMemberNames.includes(name)
    );
    const now = nowIso();
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        ...submission,
        execution: {
          ...submission.execution,
          acknowledgedMemberNames,
          stateCode: allAcknowledged ? "READY" : "PENDING_ACKNOWLEDGEMENT",
        },
        updatedAt: now,
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),

  // §24.20: заступление — только после ознакомления всего состава.
  http.post(`*${COMBAT_CHECKIN_PATH_PATTERN}`, ({ params }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const s = getState();
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    const submission = existing.submission;
    if (
      submission === null ||
      submission.stateCode !== "ACCEPTED" ||
      submission.execution === null ||
      submission.execution.stateCode !== "READY"
    ) {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Заступить можно только после ознакомления всего состава.",
        422
      );
    }
    const now = nowIso();
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        ...submission,
        execution: { ...submission.execution, stateCode: "ACTIVE", actualStart: now },
        updatedAt: now,
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),

  // §24.22 (сокращённо): checkpoint сдачи смены — только из ACTIVE; повторная
  // подача перезаписывает предыдущую (сдающий может поправить до завершения).
  http.post(`*${COMBAT_HANDOVER_PATH_PATTERN}`, async ({ params, request }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const body = (await request.json()) as SubmitCombatDutyHandoverRequest;
    const s = getState();
    if (body.confirmedByEmployeeName.trim() === "") {
      return errorEnvelope("CONFIRMER_REQUIRED", "Укажите, кто сдаёт смену.", 422);
    }
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    const submission = existing.submission;
    if (
      submission === null ||
      submission.stateCode !== "ACCEPTED" ||
      submission.execution === null ||
      submission.execution.stateCode !== "ACTIVE"
    ) {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Сдать смену можно только во время несения службы.",
        422
      );
    }
    const requiredNames = [
      submission.groupLeaderEmployeeName,
      ...submission.memberEmployeeNames,
    ];
    if (!requiredNames.includes(body.confirmedByEmployeeName)) {
      return errorEnvelope(
        "NOT_IN_ROSTER",
        "Сдать смену может только старший или участник основного состава.",
        422
      );
    }
    const now = nowIso();
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        ...submission,
        execution: {
          ...submission.execution,
          handover: {
            unresolvedIncidents: body.unresolvedIncidents,
            remarks: body.remarks,
            confirmedByEmployeeName: body.confirmedByEmployeeName,
            confirmedAt: now,
          },
        },
        updatedAt: now,
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),

  // §24.23: завершение — только из ACTIVE и только ПОСЛЕ сдачи смены;
  // фактический состав задаётся отдельно.
  http.post(`*${COMBAT_COMPLETE_PATH_PATTERN}`, async ({ params, request }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const body = (await request.json()) as CompleteCombatDutyRequest;
    const s = getState();
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    const submission = existing.submission;
    if (
      submission === null ||
      submission.stateCode !== "ACCEPTED" ||
      submission.execution === null ||
      submission.execution.stateCode !== "ACTIVE"
    ) {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Завершить можно только начатое дежурство.",
        422
      );
    }
    // §24.22: сдача смены — обязательный checkpoint ДО завершения.
    if (submission.execution.handover === null) {
      return errorEnvelope(
        "MISSING_HANDOVER",
        "Перед завершением нужно оформить сдачу смены.",
        422
      );
    }
    const now = nowIso();
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        ...submission,
        execution: {
          ...submission.execution,
          stateCode: "COMPLETED",
          actualEnd: now,
          actualMemberNames: body.actualMemberNames,
        },
        updatedAt: now,
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),

  // §24.21: атомарная замена участника — только ДО заступления
  // (PENDING_ACKNOWLEDGEMENT/READY); заменённый выбывает из ознакомившихся.
  http.post(`*${COMBAT_REPLACE_PATH_PATTERN}`, async ({ params, request }) => {
    const id = decodeURIComponent(params.shiftId as string);
    const body = (await request.json()) as RequestCombatDutyReplacementRequest;
    const s = getState();
    if (body.reasonCode.trim() === "") {
      return errorEnvelope("REASON_REQUIRED", "Причина замены обязательна.", 422);
    }
    const existing = s.shifts.find((shift) => shift.id === id);
    if (existing === undefined) return notFound(id);
    const submission = existing.submission;
    if (
      submission === null ||
      submission.stateCode !== "ACCEPTED" ||
      submission.execution === null ||
      (submission.execution.stateCode !== "PENDING_ACKNOWLEDGEMENT" &&
        submission.execution.stateCode !== "READY")
    ) {
      return errorEnvelope(
        "INVALID_STATE_TRANSITION",
        "Замена возможна только до заступления принятого состава.",
        422
      );
    }
    const { outgoingEmployeeName, incomingEmployeeName } = body;
    const currentRoster = [
      submission.groupLeaderEmployeeName,
      ...submission.memberEmployeeNames,
    ];
    if (!currentRoster.includes(outgoingEmployeeName)) {
      return errorEnvelope(
        "NOT_IN_ROSTER",
        "Заменяемый сотрудник не состоит в основном составе.",
        422
      );
    }
    if (currentRoster.includes(incomingEmployeeName)) {
      return errorEnvelope(
        "ALREADY_IN_ROSTER",
        "Указанный сотрудник уже состоит в основном составе.",
        422
      );
    }
    // §24.17: заменяющий не может быть уже принят в другую группу на эту дату.
    const conflict = s.shifts.find((shift) => {
      if (shift.id === id || shift.businessDate !== existing.businessDate)
        return false;
      if (shift.submission === null || shift.submission.stateCode !== "ACCEPTED")
        return false;
      const acceptedNames = [
        shift.submission.groupLeaderEmployeeName,
        ...shift.submission.memberEmployeeNames,
      ];
      return acceptedNames.includes(incomingEmployeeName);
    });
    if (conflict !== undefined) {
      return errorEnvelope(
        "DOUBLE_ASSIGNMENT",
        "Заменяющий сотрудник уже принят в другую боевую группу на эту дату.",
        422
      );
    }
    const groupLeaderEmployeeName =
      submission.groupLeaderEmployeeName === outgoingEmployeeName
        ? incomingEmployeeName
        : submission.groupLeaderEmployeeName;
    const memberEmployeeNames = submission.memberEmployeeNames.map((name) =>
      name === outgoingEmployeeName ? incomingEmployeeName : name
    );
    const requiredNames = [groupLeaderEmployeeName, ...memberEmployeeNames];
    // Заменённый выбывает из ознакомившихся — новый человек подтверждает сам
    // (§24.19 остаётся в силе).
    const acknowledgedMemberNames =
      submission.execution.acknowledgedMemberNames.filter(
        (name) => name !== outgoingEmployeeName
      );
    const allAcknowledged = requiredNames.every((name) =>
      acknowledgedMemberNames.includes(name)
    );
    const now = nowIso();
    const replacementRecord: DutyReplacementRecord = {
      replacementId: `${id}-replacement-${submission.replacements.length + 1}`,
      outgoingEmployeeName,
      incomingEmployeeName,
      reasonCode: body.reasonCode,
      safeComment: body.safeComment,
      appliedAt: now,
    };
    const updated: CombatDutyShift = {
      ...existing,
      submission: {
        ...submission,
        groupLeaderEmployeeName,
        memberEmployeeNames,
        execution: {
          ...submission.execution,
          acknowledgedMemberNames,
          stateCode: allAcknowledged ? "READY" : "PENDING_ACKNOWLEDGEMENT",
        },
        replacements: [...submission.replacements, replacementRecord],
        updatedAt: now,
      },
      updatedAt: now,
    };
    return HttpResponse.json(save(updated));
  }),
];
