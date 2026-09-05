"use client";

// Мутации этапов карточки ОМ. Все идут через use-ops-mutation (каналы
// 400/409/5xx), после успеха кладут свежий ОМ в кэш детали и инвалидируют
// список. Один фабричный хелпер — девять операций не должны девять раз
// повторять onSuccess.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import type { UseOpsMutationResult } from "@/hooks/use-ops-mutation";
import type { OpsApiFailure } from "@/lib/ops-errors";
import {
  opsPersonnelPagePath,
  OPS_PERSONNEL_ME_PATH,
  securityEventAcknowledgePath,
  securityEventAcknowledgementRemindAllPath,
  securityEventAcknowledgementRemindPath,
  securityEventAcknowledgementCompletePath,
  securityEventAcknowledgementNotifyPath,
  securityEventApprovalApprovePath,
  securityEventApprovalRoutePath,
  securityEventApproverPath,
  securityEventApproverDecidePath,
  securityEventApproverMovePath,
  securityEventApprovalSendPath,
  securityEventApprovalWithdrawPath,
  securityEventRemarkResolvePath,
  securityEventApprovalReturnPath,
  securityEventBulletinCompletePath,
  securityEventBulletinPath,
  securityEventClosePath,
  securityEventForceAllocationPath,
  securityEventForcesSplitPath,
  securityEventForcesNotifyPath,
  securityEventForcesMembersPath,
  securityEventForcesMemberPath,
  securityEventForcesSubmitPath,
  securityEventForcesAcceptPath,
  securityEventForcesReturnPath,
  securityEventForcesWithdrawPath,
  securityEventJournalPath,
  securityEventPlacementAssignPath,
  securityEventPlacementMovePath,
  securityEventPlacementCompletePath,
  securityEventPlacementPostPath,
  securityEventPlacementSeniorPath,
  securityEventPlacementUnassignPath,
  securityEventReconCompletePath,
  securityEventReconImportPath,
  securityEventReconPath,
  securityEventReplaceAssignmentPath,
  securityEventStagePath,
  CloseVisitObjectRequest,
  visitObjectClosePath,
  visitObjectEvaluationsAllPath,
  visitObjectEvaluationsPath,
} from "@/entities/security-event";
import type {
  AcknowledgementNotifyReport,
  CompleteAcknowledgementRequest,
  AddJournalEntryRequest,
  AssignPlacementRequest,
  MovePlacementRequest,
  CloseSecurityEventRequest,
  PersonnelPageResponse,
  OverrideStageRequest,
  PersonnelSummarySnapshot,
  ReplaceAssignmentRequest,
  AddApproverRequest,
  VisitObjectAddressed,
  CompletePlacementRequest,
  DecideApproverRequest,
  MoveApproverRequest,
  ResolveRemarkRequest,
  ReturnPlacementRequest,
  SecurityEvent,
  AddAllocationMemberRequest,
  ReturnAllocationRequest,
  SetEvaluationRequest,
  SplitForceDemandRequest,
  UpdateBulletinRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
  VisitEvaluationSummary,
} from "@/entities/security-event";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";

interface StageMutationOptions {
  onFormError?: (details: Record<string, unknown>) => void;
  /** Ответ мутации — форме этапа. Нужен там, где сервер меняет данные, которые
   * форма держит у себя (импорт постов), а пересборки формы больше нет. */
  onEvent?: (event: SecurityEvent) => void;
}

function useEventMutation<TVariables extends Record<string, unknown>>(
  id: string,
  mutationFn: (variables: TVariables) => Promise<SecurityEvent>,
  options?: StageMutationOptions
): UseOpsMutationResult<SecurityEvent, TVariables> {
  const queryClient = useQueryClient();
  return useOpsMutation<SecurityEvent, TVariables>({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(["ops-security-events", "detail", id], data);
      invalidateSecurityEvents(queryClient);
      options?.onEvent?.(data);
    },
    onFormError: options?.onFormError,
  });
}

/**
 * СТРАНИЦА кадрового списка с поиском на сервере («Реестр ОМ-35.3»).
 *
 * ЕДИНСТВЕННЫЙ способ прочитать кадры: хук «весь снимок целиком»
 * (`usePersonnelRoster`) снят вместе с безстраничной веткой ручки (Plane
 * №61). Пока он был, четыре экрана тянули всю кадровую базу одним ответом и
 * фильтровали её на клиенте — «поиск», который отвечает «никого не нашлось»,
 * имея в виду «нет в загруженном».
 *
 * `placeholderData` держит предыдущую страницу на экране, пока грузится
 * следующая: без него список мигает в пустоту на каждом нажатии «Дальше», и
 * человек теряет место в перечне.
 */
export function usePersonnelPage(params: {
  search: string;
  page: number;
  pageSize?: number;
  enabled?: boolean;
  /** Подразделение-владелец: пусто — вся служба (прежнее поведение). */
  divisionId?: string;
  /** Дата, на которую спрашивается статус кандидата; пусто — не спрашивать. */
  businessDate?: string;
  /** Полоса рейтинга: отбор идёт НА СЕРВЕРЕ и по всей базе (Plane №67).
   * Пусто — не отбирать. */
  ratingBand?: string;
  /** Порядок: `rating` — ранжирование по баллу по всей выборке. Пусто —
   * порядок по умолчанию (фамилия). */
  ordering?: "rating";
}) {
  const pageSize = params.pageSize ?? 20;
  const divisionId = params.divisionId ?? "";
  const businessDate = params.businessDate ?? "";
  const ratingBand = params.ratingBand ?? "";
  const ordering = params.ordering;
  return useQuery<PersonnelPageResponse, OpsApiFailure>({
    // Подразделение — ЧАСТЬ ключа: без него страница чужого управления
    // отдалась бы из кэша как своя.
    queryKey: [
      "ops-personnel",
      "page",
      params.search,
      params.page,
      pageSize,
      divisionId,
      // Дата — ЧАСТЬ ключа: страница, спрошенная на другой день, несёт другие
      // статусы, и отдать её из кэша значило бы показать чужой день.
      businessDate,
      // Полоса и порядок — тоже ЧАСТЬ ключа: они меняют СОСТАВ страницы, и
      // без них отбор «9,0+» отдался бы из кэша страницей без отбора.
      ratingBand,
      ordering ?? "",
    ],
    queryFn: () =>
      opsApiClient.get<PersonnelPageResponse>(
        opsPersonnelPagePath({
          search: params.search,
          page: params.page,
          pageSize,
          divisionId,
          businessDate,
          ratingBand,
          ordering,
        })
      ),
    enabled: params.enabled !== false,
    placeholderData: (previous) => previous,
  });
}

// ── Бюллетень ────────────────────────────────────────────────────────────

export function useUpdateBulletin(id: string, options?: StageMutationOptions) {
  return useEventMutation<UpdateBulletinRequest>(
    id,
    (body) => opsApiClient.patch<SecurityEvent>(securityEventBulletinPath(id), body),
    options
  );
}

export function useCompleteBulletin(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventBulletinCompletePath(id))
  );
}

// ── Рекогносцировка ──────────────────────────────────────────────────────

export function useUpdateRecon(id: string, options?: StageMutationOptions) {
  return useEventMutation<UpdateReconRequest>(
    id,
    (body) => opsApiClient.patch<SecurityEvent>(securityEventReconPath(id), body),
    options
  );
}

/** Импорт постов из паспорта ОБЪЕКТА ПОСЕЩЕНИЯ (Plane №408, `[РЕК-05]`).
 *
 *  `visitObjectId` не назван и объект у мероприятия один — сервер берёт его.
 *  Объектов несколько — сервер отвечает `VISIT_OBJECT_REQUIRED` и просит
 *  выбрать: угадывать адресата постов нельзя, приписанные чужому объекту
 *  посты потом не различить. */
export function useImportReconPosts(
  id: string,
  options?: StageMutationOptions
) {
  return useEventMutation<{ visitObjectId?: string }>(
    id,
    (variables) =>
      opsApiClient.post<SecurityEvent>(
        securityEventReconImportPath(id),
        variables ?? {}
      ),
    options
  );
}

export function useCompleteRecon(id: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(securityEventReconCompletePath(id))
  );
}

// ── Потребность и силы ───────────────────────────────────────────────────

// `useApproveDemand` СНЯТ вместе с ручкой `demand/approve` (Plane №149):
// стадию «Потребность» проходит сервер, формы у неё на экране нет с №110.

/** Раскладка потребности по департаментам — весь список одним запросом.
 *
 * Своя мутация, а не повтор `useUpdateForceAllocation`: тот правит ЧИСЛО у
 * одной строки утверждённой потребности, эта — адресную раскладку штаба.
 */
export function useSplitForceDemand(id: string, options?: StageMutationOptions) {
  return useEventMutation<SplitForceDemandRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventForcesSplitPath(id), body),
    options
  );
}

/** «Оповестить управления» у заявки департаменту (Plane №73, шаг СС-2). */
export function useNotifyDirectorates(id: string, allocationId: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesNotifyPath(id, allocationId)
    )
  );
}

/** Управление выделяет человека (Plane №73, шаг СС-3). */
export function useAddAllocationMember(id: string, allocationId: string) {
  return useEventMutation<AddAllocationMemberRequest>(id, (body) =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesMembersPath(id, allocationId),
      body
    )
  );
}

/** Снять выделенного: сервер отменит его статус привлечения. */
export function useRemoveAllocationMember(id: string, allocationId: string) {
  return useEventMutation<{ employeeId: string }>(id, ({ employeeId }) =>
    opsApiClient.del<SecurityEvent>(
      securityEventForcesMemberPath(id, allocationId, employeeId)
    )
  );
}

/** Отправить окончательный список штабу / отозвать его (Plane №73, СС-4). */
export function useSubmitAllocation(id: string, allocationId: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesSubmitPath(id, allocationId)
    )
  );
}

export function useWithdrawAllocation(id: string, allocationId: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesWithdrawPath(id, allocationId)
    )
  );
}

/** Решение штаба по присланному списку (Plane №73, шаг СС-5). */
export function useAcceptAllocation(id: string, allocationId: string) {
  return useEventMutation<Record<string, never>>(id, () =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesAcceptPath(id, allocationId)
    )
  );
}

export function useReturnAllocation(id: string, allocationId: string) {
  return useEventMutation<ReturnAllocationRequest>(id, (body) =>
    opsApiClient.post<SecurityEvent>(
      securityEventForcesReturnPath(id, allocationId),
      body
    )
  );
}

export function useUpdateForceAllocation(id: string, requestId: string) {
  return useEventMutation<UpdateForceAllocationRequest>(id, (body) =>
    opsApiClient.patch<SecurityEvent>(
      securityEventForceAllocationPath(id, requestId),
      body
    )
  );
}

// `useCompleteForces` СНЯТ вместе с ручкой `forces/complete` (Plane №149).

// ── Расстановка и согласование ───────────────────────────────────────────

export function useAssignPlacement(id: string) {
  return useEventMutation<AssignPlacementRequest>(id, (body) =>
    opsApiClient.post<SecurityEvent>(securityEventPlacementAssignPath(id), body)
  );
}

export function useUnassignPlacement(id: string) {
  return useEventMutation<{ assignmentId: string }>(id, ({ assignmentId }) =>
    opsApiClient.del<SecurityEvent>(
      securityEventPlacementUnassignPath(id, assignmentId)
    )
  );
}

/**
 * Перенести человека на другой пост ОДНИМ запросом (Plane №762).
 *
 * Заменяет пару «снять + назначить», между которыми сотрудник не был назначен
 * никуда. Отказ теперь не меняет на сервере ничего — отменять нечего, и
 * клиентский возврат из №744 вместе с этим снят: он стал бы вторым ответом на
 * тот же вопрос.
 */
export function useMovePlacement(id: string) {
  return useEventMutation<MovePlacementRequest & { assignmentId: string }>(
    id,
    ({ assignmentId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventPlacementMovePath(id, assignmentId),
        body
      )
  );
}

/** Снять ПУСТОЙ пост с расчёта: недобор людей — работа расстановки (№259). */
export function useRemovePlacementPost(id: string) {
  return useEventMutation<{ postId: string }>(id, ({ postId }) =>
    opsApiClient.del<SecurityEvent>(
      securityEventPlacementPostPath(id, postId)
    )
  );
}

/** Старший ПОСТА: назначить (`senior: true`) или снять (`[РАС-03]`, №445).
 *
 * Имя хука и поле `isSectorSenior` остались от прежнего правила «один на
 * сектор» — переименование это отдельный шаг после переезда читателей
 * (карточка, мок, пробы). Подпись же обязана говорить правду сегодня
 * (Plane №780). */
export function useSetSectorSenior(id: string) {
  return useEventMutation<{ assignmentId: string; senior: boolean }>(
    id,
    ({ assignmentId, senior }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventPlacementSeniorPath(id, assignmentId),
        { senior }
      )
  );
}

export function useCompletePlacement(id: string) {
  return useEventMutation<CompletePlacementRequest>(id, (body) =>
    opsApiClient.post<SecurityEvent>(securityEventPlacementCompletePath(id), body)
  );
}

export function useApprovePlacement(id: string) {
  return useEventMutation<VisitObjectAddressed>(id, (body) =>
    opsApiClient.post<SecurityEvent>(securityEventApprovalApprovePath(id), body)
  );
}

export function useReturnPlacement(id: string, options?: StageMutationOptions) {
  return useEventMutation<ReturnPlacementRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventApprovalReturnPath(id), body),
    options
  );
}

// ── Ознакомление ─────────────────────────────────────────────────────────

export function useAcknowledgePlacement(id: string) {
  return useEventMutation<{ assignmentId: string }>(id, ({ assignmentId }) =>
    opsApiClient.post<SecurityEvent>(securityEventAcknowledgePath(id, assignmentId))
  );
}

/** Рассылка уведомлений о заступлении (Plane №243).
 *
 * Обычная мутация, а не `useEventMutation`: ручка отвечает ОТЧЁТОМ, а не
 * мероприятием, и класть его в кэш карточки было бы ложью — карточка от
 * рассылки не меняется.
 */
export function useNotifyAcknowledgement(id: string) {
  return useOpsMutation<AcknowledgementNotifyReport, Record<string, never>>({
    mutationFn: () =>
      opsApiClient.post<AcknowledgementNotifyReport>(
        securityEventAcknowledgementNotifyPath(id)
      ),
  });
}

export function useCompleteAcknowledgement(id: string, options?: StageMutationOptions) {
  return useEventMutation<CompleteAcknowledgementRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventAcknowledgementCompletePath(id), body),
    options
  );
}

/** «Напомнить» одному / всем, кто не подтвердил (Plane №432). Ответ — отчёт,
 * а не мероприятие; карточка перечитывается ради `remindedAt`. */
export function useRemindAssignment(id: string) {
  const queryClient = useQueryClient();
  return useOpsMutation<AcknowledgementNotifyReport, { assignmentId: string }>({
    mutationFn: ({ assignmentId }) =>
      opsApiClient.post<AcknowledgementNotifyReport>(
        securityEventAcknowledgementRemindPath(id, assignmentId)
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}

export function useRemindAllPending(id: string) {
  const queryClient = useQueryClient();
  return useOpsMutation<AcknowledgementNotifyReport, Record<string, never>>({
    mutationFn: () =>
      opsApiClient.post<AcknowledgementNotifyReport>(
        securityEventAcknowledgementRemindAllPath(id)
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
    },
  });
}

// ── Проведение и закрытие ────────────────────────────────────────────────

export function useAddJournalEntry(id: string, options?: StageMutationOptions) {
  return useEventMutation<AddJournalEntryRequest>(
    id,
    (body) => opsApiClient.post<SecurityEvent>(securityEventJournalPath(id), body),
    options
  );
}

export function useReplaceAssignment(id: string, options?: StageMutationOptions) {
  return useEventMutation<ReplaceAssignmentRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(
        securityEventReplaceAssignmentPath(id),
        body
      ),
    options
  );
}

/**
 * Перевод ОМ на выбранный этап в обход условий — только у права
 * `event.stage_override` (у остальных сервер ответит 403). Идёт тем же
 * каналом, что и остальные мутации этапа: ответ — ЦЕЛОЕ мероприятие, оно
 * ложится в кэш детали, и карточка перерисовывается от серверного факта, а
 * не от догадки клиента о новой стадии.
 */
export function useOverrideStage(id: string, options?: StageMutationOptions) {
  return useEventMutation<OverrideStageRequest>(
    id,
    (body) => opsApiClient.post<SecurityEvent>(securityEventStagePath(id), body),
    options
  );
}

/** Закрыть объект посещения (`[ЗАК-05]`, Plane №404). */
export function useCloseVisitObject(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ visitObjectId: string } & CloseVisitObjectRequest>(
    id,
    ({ visitObjectId, ...body }) =>
      opsApiClient.post<SecurityEvent>(visitObjectClosePath(id, visitObjectId), body),
    options
  );
}

// ── Оценки этапа «Проведение» (Plane №433) ──────────────────────────────
export function visitEvaluationsKey(id: string, visitObjectId: string) {
  return ["ops-visit-evaluations", id, visitObjectId] as const;
}

/**
 * Сводка оценок объекта. `allowed` — есть ли право читать её (Plane №644).
 *
 * Ручка закрыта тем же правом, что и постановка оценки, поэтому читателю без
 * него она отвечает 403. Запрос, который заведомо отобьётся, не отправляется
 * вовсе: React Query перезапрашивает при возврате фокуса в окно, и открытая
 * вкладка стучалась бы в закрытую дверь снова и снова, а экран печатал бы
 * «не загрузились — обновите страницу» — совет, который не может помочь.
 */
export function useVisitEvaluations(
  id: string,
  visitObjectId: string | null,
  allowed = true
) {
  return useQuery({
    queryKey: visitEvaluationsKey(id, visitObjectId ?? ""),
    queryFn: () =>
      opsApiClient.get<VisitEvaluationSummary>(
        visitObjectEvaluationsPath(id, visitObjectId ?? "")
      ),
    enabled: visitObjectId !== null && allowed,
  });
}

function useEvaluationMutation<TBody>(
  id: string,
  visitObjectId: string,
  request: (body: TBody) => Promise<VisitEvaluationSummary>
) {
  const queryClient = useQueryClient();
  return useMutation<VisitEvaluationSummary, OpsApiFailure, TBody>({
    mutationFn: request,
    onSuccess: (summary) => {
      queryClient.setQueryData(visitEvaluationsKey(id, visitObjectId), summary);
    },
  });
}

export function useSetEvaluation(id: string, visitObjectId: string) {
  return useEvaluationMutation<SetEvaluationRequest>(id, visitObjectId, (body) =>
    opsApiClient.post<VisitEvaluationSummary>(visitObjectEvaluationsPath(id, visitObjectId), body)
  );
}

export function useScoreAll(id: string, visitObjectId: string) {
  return useEvaluationMutation<{ score?: number }>(id, visitObjectId, (body) =>
    opsApiClient.post<VisitEvaluationSummary>(
      visitObjectEvaluationsAllPath(id, visitObjectId),
      body
    )
  );
}

export function useCloseSecurityEvent(id: string, options?: StageMutationOptions) {
  return useEventMutation<CloseSecurityEventRequest>(
    id,
    (body) => opsApiClient.post<SecurityEvent>(securityEventClosePath(id), body),
    options
  );
}

/**
 * Своя кадровая запись. Ошибку не ретраим: 404 «не привязан» — это ответ, а
 * не сбой, и повторять его бессмысленно.
 */
export function usePersonnelMe(options: { enabled?: boolean } = {}) {
  return useQuery<PersonnelSummarySnapshot, OpsApiFailure>({
    queryKey: ["ops-personnel", "me"],
    queryFn: () =>
      opsApiClient.get<PersonnelSummarySnapshot>(OPS_PERSONNEL_ME_PATH),
    enabled: options.enabled ?? true,
    retry: false,
  });
}

/** Адрес объекта посещения в строке запроса — для ручек без тела (DELETE). */
function withVisitObject(path: string, visitObjectId?: string): string {
  if (!visitObjectId) return path;
  return `${path}?visitObjectId=${encodeURIComponent(visitObjectId)}`;
}

/** Маршрут согласования: добавление, снятие и решение по строке. */
export function useAddApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<AddApproverRequest>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventApprovalRoutePath(id), body),
    options
  );
}

export function useRemoveApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ approverId: string } & VisitObjectAddressed>(
    id,
    ({ approverId, visitObjectId }) =>
      // Адрес объекта уходит СТРОКОЙ ЗАПРОСА, а не телом: снятие
      // согласующего — DELETE, а тело у DELETE доносят не все клиенты и не
      // всякий прокси. Сервер читает оба места (Plane №411).
      opsApiClient.del<SecurityEvent>(
        withVisitObject(securityEventApproverPath(id, approverId), visitObjectId)
      ),
    options
  );
}

/** Отправить расстановку согласующим: до отправки маршрут — список людей, а
 * не процесс. Отправка фиксирует на сервере снимок состава. */
export function useSendForApproval(id: string, options?: StageMutationOptions) {
  return useEventMutation<VisitObjectAddressed>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(securityEventApprovalSendPath(id), body),
    options
  );
}

export function useWithdrawApproval(id: string, options?: StageMutationOptions) {
  return useEventMutation<VisitObjectAddressed>(
    id,
    (body) =>
      opsApiClient.post<SecurityEvent>(
        securityEventApprovalWithdrawPath(id),
        body
      ),
    options
  );
}

export function useMoveApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ approverId: string } & MoveApproverRequest>(
    id,
    ({ approverId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventApproverMovePath(id, approverId),
        body
      ),
    options
  );
}

export function useResolveRemark(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ remarkId: string } & ResolveRemarkRequest>(
    id,
    ({ remarkId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventRemarkResolvePath(id, remarkId),
        body
      ),
    options
  );
}

export function useDecideApprover(id: string, options?: StageMutationOptions) {
  return useEventMutation<{ approverId: string } & DecideApproverRequest>(
    id,
    ({ approverId, ...body }) =>
      opsApiClient.post<SecurityEvent>(
        securityEventApproverDecidePath(id, approverId),
        body
      ),
    options
  );
}
