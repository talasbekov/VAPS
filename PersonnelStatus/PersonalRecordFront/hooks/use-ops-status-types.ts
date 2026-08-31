"use client";

/**
 * Справочник типов статусов раздела ОМ (`/api/operations/status-types/`) —
 * ОДИН источник на весь фронт (Plane №342).
 *
 * ЗАЧЕМ ХУК ПОЯВИЛСЯ. Каталог типов живёт на сервере таблицей
 * `ops_status_types` и правится в админке. Фронт при этом читал не её, а свою
 * копию-константу `STATUS_TYPE_OPTIONS` в `entities/daily-grid` — 18 строк,
 * подписанных «зеркало seed-каталога бэка». Заказчик завёл в админке 19-й тип
 * («Участие в ОМ», код `IN_EVENT`) и не увидел его на фронте НИГДЕ: ни в
 * окне простановки статуса, ни в подписях — потому что копия о нём не знала и
 * узнать не могла. Копия справочника — это и есть дефект: она расходится с
 * оригиналом при первой же правке, молча и в обе стороны (новый тип не
 * показывается, удалённый показывается).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ЗАПРОС В КАЖДОМ ЭКРАНЕ. Экранов, которым нужен
 * каталог, теперь пятеро, и объявлять запрос в каждом значило бы разводить ту
 * же копию, только в кэше. КЛЮЧ (`ops-status-types`) и `staleTime` здесь
 * ровно те же, что у `use-ops-section-statuses` и `use-forces-gathering`, —
 * это не совпадение, а условие: справочник один, и запрос за ним должен быть
 * один. Те два хука на этот файл НЕ переведены намеренно: им нужны ВСЕ типы с
 * полями (`report_column_code` и прочее), в том числе неактивные, а здесь
 * `types` — только активные, для выбора. Свести их одним заходом значило бы
 * менять поведение экранов, которые заказчик не чинил.
 *
 * НЕАКТИВНЫЕ ТИПЫ ручка отдаёт вместе с активными (`is_active` — поле
 * ответа), и отбор делает клиент: деактивация в справочнике — не удаление,
 * старые строки статусов на неактивный тип продолжают ссылаться, и ПОДПИСЬ им
 * нужна. Поэтому `types` (для выбора) отфильтрован, а `labelOf` знает все.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient, type OpsStatusType } from "@/lib/api";

export interface OpsStatusTypesResult {
  /** Активные типы в порядке справочника (сервер сортирует по приоритету). */
  types: OpsStatusType[];
  /** Подпись кода. НЕЗНАКОМЫЙ КОД ПЕЧАТАЕТСЯ САМ СОБОЙ, а не исчезает под
   *  пустой строкой: код на экране — повод спросить, пустота — нет. */
  labelOf: (code: string) => string;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
}

export function useOpsStatusTypes(enabled = true): OpsStatusTypesResult {
  const query = useQuery<OpsStatusType[]>({
    queryKey: ["ops-status-types"],
    queryFn: () => apiClient.getOpsStatusTypes(),
    // Справочник меняется в админке, а не по ходу дня.
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const all = query.data;

  // Ссылки СТАБИЛЬНЫ между рендерами, пока не изменился ответ: `labelOf` и
  // `types` уходят в зависимости `useMemo` у читателей (календарь и
  // статистика профиля), и новая функция на каждый рендер пересчитывала бы
  // их вхолостую.
  const nameOfCode = useMemo(
    () => new Map((all ?? []).map((type) => [type.code, type.name])),
    [all]
  );
  const types = useMemo(
    () => (all ?? []).filter((type) => type.is_active),
    [all]
  );
  const labelOf = useCallback(
    (code: string) => nameOfCode.get(code) ?? code,
    [nameOfCode]
  );

  return {
    types,
    labelOf,
    isLoading: query.isPending && enabled,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}
