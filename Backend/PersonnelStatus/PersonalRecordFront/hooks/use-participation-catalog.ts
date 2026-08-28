"use client";

// Виды участия в ОМ и роли внутри группы — справочники Ш-2 (Plane №274).
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import {
  dictionaryEntriesPath,
  type ListDictionaryEntriesResponse,
} from "@/entities/dictionary";

export interface ParticipationKind {
  code: string;
  label: string;
  /** Роли внутри вида. Пусто у физического наряда — их там нет вовсе. */
  roles: { code: string; label: string }[];
}

/**
 * Виды участия со СВОИМИ ролями внутри.
 *
 * Склейка делается здесь, а не на экране: правило «роль принадлежит своей
 * группе» одно, и два места, где оно повторяется, разошлись бы на первой же
 * правке. Экран получает готовое дерево и выбирает из него.
 */
export function useParticipationCatalog(enabled = true) {
  return useQuery<ParticipationKind[]>({
    queryKey: ["ops-participation-catalog"],
    enabled,
    // Справочник меняет администратор, а не ход дня.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [kinds, roles] = await Promise.all([
        opsApiClient.get<ListDictionaryEntriesResponse>(
          dictionaryEntriesPath("EVENT_PARTICIPATION_KINDS")
        ),
        opsApiClient.get<ListDictionaryEntriesResponse>(
          dictionaryEntriesPath("EVENT_GROUP_ROLES")
        ),
      ]);
      const active = <T extends { isActive: boolean }>(rows: T[]) =>
        rows.filter((row) => row.isActive);
      return active(kinds.results).map((kind) => ({
        code: kind.code,
        label: kind.label,
        roles: active(roles.results)
          .filter((role) => role.groupCode === kind.code)
          .map((role) => ({ code: role.code, label: role.label })),
      }));
    },
  });
}
