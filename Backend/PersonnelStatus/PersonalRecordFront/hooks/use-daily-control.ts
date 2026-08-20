"use client";

/**
 * Источники экрана «Расход и светофор» (/security-ops/traffic): сдача дня,
 * блокировка расхода на завтра, точечный светофор узла и реестр выпусков.
 *
 * Дерево светофора и живой расход живут в use-strength-report.ts — здесь
 * только то, чего у экранов-предшественников не было. Все чтения идут под
 * `status.view` (выпуски — под `document.view`), поэтому каждый хук принимает
 * `enabled`: без права запрос не уходит, иначе экран показал бы отказ 403 как
 * «ошибку загрузки».
 *
 * Даты НЕ считаются на клиенте: «сегодня» и «завтра» ставит сервер по часам
 * раздела и возвращает эхом (`business_date`), а клиентское «завтра» в
 * минусовых зонах уезжало бы на день. Экран сначала спрашивает опорную ручку
 * без даты, потом остальные — с датой из эха.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, type TrafficLightTree } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";

/** Строка сдачи из списка — без снимка (снимок отдаёт только retrieve). */
export interface OpsDailySubmission {
  id: number;
  division_id: number;
  business_date: string;
  version: number;
  is_current: boolean;
  event: string;
  submitted_by: number | null;
  submitted_at: string;
  late: boolean;
}

/** Конверт DRF LimitOffsetPagination. */
interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface TomorrowBlockLaggard {
  division_id: number;
  name: string;
}

/** Состояние блокировки расхода на дату (по умолчанию — на завтра сервера). */
export interface TomorrowBlockState {
  business_date: string;
  blocked: boolean;
  overridden: boolean;
  laggards: TomorrowBlockLaggard[];
}

export type TrafficLightColor =
  | "GREEN"
  | "YELLOW"
  | "RED"
  | "NEUTRAL"
  | "UNKNOWN";

/** Точечный светофор узла: свой уровень, БЕЗ свода потомков, с расхождением. */
export interface TrafficLightDivision {
  division_id: number;
  business_date: string;
  status: TrafficLightColor;
  late: boolean;
  drift: {
    added: number[];
    removed: number[];
    changed: { employee_id: number; from: string; to: string }[];
  } | null;
}

/** Выпуск официального документа: номер, день, состояние, метаданные файла. */
export interface OpsIssuedDocument {
  id: number;
  doc_type: string;
  number: number;
  year: number;
  business_date: string;
  division_id: number;
  submission_id: number;
  submission_version: number;
  status: string;
  reason: string | null;
  supersedes: number | null;
  supersedes_number: number | null;
  attachment_id: number;
  original_name: string;
  content_type: string;
  size: number;
  sha256: string;
  created_by: number | null;
  created_at: string;
}

/**
 * Дерево светофора НА ДАТУ. Сосед `useTrafficLightTree` из
 * use-strength-report.ts намеренно ходит только за «сегодня» — здесь дата
 * приходит из серверного эха (или пикера), поэтому свой ключ кэша.
 * `businessDate === null` — запрос без даты, день ставит сервер.
 */
export function useTrafficTreeFor(
  businessDate: string | null,
  enabled: boolean
) {
  return useQuery<TrafficLightTree>({
    queryKey: ["traffic-light", "tree", businessDate ?? "server-today"],
    queryFn: () =>
      apiClient.getTrafficLightTree(
        businessDate === null ? {} : { businessDate }
      ),
    enabled,
  });
}

/**
 * Блокировка расхода. Без даты сервер отвечает про ЗАВТРА по своим часам —
 * ровно тот день, который блокировка и закрывает; `business_date` в ответе
 * и есть источник «серверного завтра» для остальных запросов экрана.
 */
export function useTomorrowBlock(enabled: boolean) {
  return useQuery<TomorrowBlockState, OpsApiFailure>({
    queryKey: ["tomorrow-block", "tomorrow"],
    queryFn: () =>
      opsApiClient.get<TomorrowBlockState>("/api/operations/tomorrow-block/"),
    enabled,
  });
}

/**
 * Сдачи подразделения за день, с историей версий: свежая версия первой —
 * порядок задаёт сервер, клиент его не пересортировывает.
 */
export function useDailySubmissions(
  params: { divisionId: number | null; businessDate: string | null },
  enabled: boolean
) {
  const { divisionId, businessDate } = params;
  return useQuery<Paginated<OpsDailySubmission>, OpsApiFailure>({
    queryKey: [
      "daily-submissions",
      divisionId ?? "none",
      businessDate ?? "none",
    ],
    queryFn: () => {
      const query = new URLSearchParams();
      query.set("division_id", String(divisionId));
      if (businessDate !== null) query.set("business_date", businessDate);
      query.set("history", "true");
      return opsApiClient.get<Paginated<OpsDailySubmission>>(
        `/api/operations/daily-submissions/?${query.toString()}`
      );
    },
    enabled: enabled && divisionId !== null,
  });
}

/** Точечный светофор выбранного узла — цвет своего уровня и drift. */
export function useDivisionTrafficLight(
  params: { divisionId: number | null; businessDate: string | null },
  enabled: boolean
) {
  const { divisionId, businessDate } = params;
  return useQuery<TrafficLightDivision, OpsApiFailure>({
    queryKey: [
      "traffic-light",
      "division",
      divisionId ?? "none",
      businessDate ?? "today",
    ],
    queryFn: () => {
      const query = new URLSearchParams();
      if (businessDate !== null) query.set("business_date", businessDate);
      const encoded = query.toString();
      const suffix = encoded === "" ? "" : `?${encoded}`;
      return opsApiClient.get<TrafficLightDivision>(
        `/api/operations/traffic-light/${divisionId}/${suffix}`
      );
    },
    enabled: enabled && divisionId !== null,
  });
}

/**
 * Выпуски документов подразделения за день, вместе с отозванными
 * (`history=true`): история «взамен исходящего №…» — смысл блока версий.
 */
export function useIssuedDocuments(
  params: { divisionId: number | null; businessDate: string | null },
  enabled: boolean
) {
  const { divisionId, businessDate } = params;
  return useQuery<Paginated<OpsIssuedDocument>, OpsApiFailure>({
    queryKey: ["ops-documents", divisionId ?? "none", businessDate ?? "none"],
    queryFn: () => {
      const query = new URLSearchParams();
      query.set("division_id", String(divisionId));
      if (businessDate !== null) {
        query.set("date_from", businessDate);
        query.set("date_to", businessDate);
      }
      query.set("history", "true");
      return opsApiClient.get<Paginated<OpsIssuedDocument>>(
        `/api/operations/documents/?${query.toString()}`
      );
    },
    enabled: enabled && divisionId !== null,
  });
}

/**
 * Законный обход блокировки: причина обязательна, подпись ставит сервер из
 * аутентификации. После успеха перечитывается состояние блокировки — экран
 * не рисует «снято» из собственной памяти.
 */
export function useOverrideTomorrowBlock() {
  const queryClient = useQueryClient();
  return useMutation<
    { id: number; business_date: string },
    OpsApiFailure,
    { businessDate: string; reason: string }
  >({
    mutationFn: (input) =>
      opsApiClient.post<{ id: number; business_date: string }>(
        "/api/operations/tomorrow-block/override/",
        { business_date: input.businessDate, reason: input.reason }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tomorrow-block"] });
    },
  });
}
