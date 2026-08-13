"use client";

// Блок наряда — часть модалки статусов, появляется только у «На дежурстве».
// Отдельный файл, а не ветка внутри модалки: у блока своя зависимость полей
// (вид дежурства → чем уточняется объект), и держать её рядом с датами значит
// смешивать два разных набора правил.

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSecurityObjects } from "@/hooks/use-security-objects";
import {
  DUTY_GROUPS,
  DUTY_KINDS,
  type DutyKindCode,
} from "@/entities/duty-assignment";

/**
 * Черновик наряда в форме: пустая строка — «не выбрано».
 *
 * Имена объекта/поста/группы едут в черновике вместе с идентификаторами.
 * Так реестр объектов читает ровно один компонент — этот, и только когда
 * блок наряда показан: страница статусов не должна дёргать /api/ops/objects/
 * ради закрытой модалки.
 */
export interface DutyDraft {
  dutyKind: DutyKindCode | "";
  objectId: string;
  objectName: string;
  postId: string;
  postName: string;
  groupId: string;
  groupName: string;
}

export const EMPTY_DUTY_DRAFT: DutyDraft = {
  dutyKind: "",
  objectId: "",
  objectName: "",
  postId: "",
  postName: "",
  groupId: "",
  groupName: "",
};

interface DutyAssignmentFieldsProps {
  value: DutyDraft;
  onChange: (next: DutyDraft) => void;
}

export function DutyAssignmentFields({
  value,
  onChange,
}: DutyAssignmentFieldsProps) {
  const { data, isLoading, isError } = useSecurityObjects();
  const objects = useMemo(() => data?.results ?? [], [data]);

  const selectedObject = useMemo(
    () => objects.find((item) => item.id === value.objectId) ?? null,
    [objects, value.objectId]
  );

  // Посты объекта живут в паспорте, по секторам. Имя сектора остаётся в
  // подписи: два поста с одинаковым названием в разных секторах — обычное дело.
  const posts = useMemo(
    () =>
      (selectedObject?.sectors ?? []).flatMap((sector) =>
        sector.posts.map((post) => ({
          id: post.id,
          name: post.name,
          label: `${post.name} (${sector.name})`,
        }))
      ),
    [selectedObject]
  );

  // Зависимое поле заблокировано, пока объект не выбран: пост без объекта
  // указывать не на что, а группа без объекта — наряд в никуда.
  const dependentDisabled = value.objectId === "";

  return (
    <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
      <div className="text-sm font-semibold text-blue-900">
        Наряд на дежурство
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Тип дежурства *</Label>
          <Select
            value={value.dutyKind}
            onValueChange={(next) =>
              // Смена вида пересобирает зависимое поле: значение прежнего вида
              // здесь бессмысленно, и оставленный «пост» у группового дежурства
              // уехал бы в наряд молча.
              onChange({
                ...value,
                dutyKind: next as DutyKindCode,
                postId: "",
                postName: "",
                groupId: "",
                groupName: "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите тип дежурства" />
            </SelectTrigger>
            <SelectContent>
              {DUTY_KINDS.map((kind) => (
                <SelectItem key={kind.code} value={kind.code}>
                  {kind.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Объект *</Label>
          <Select
            value={value.objectId}
            onValueChange={(next) =>
              // Пост принадлежит объекту — при смене объекта он сбрасывается.
              onChange({
                ...value,
                objectId: next,
                objectName:
                  objects.find((item) => item.id === next)?.name ?? "",
                postId: "",
                postName: "",
              })
            }
            disabled={isLoading || isError || objects.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  isLoading
                    ? "Загрузка объектов…"
                    : isError
                    ? "Объекты недоступны"
                    : "Выберите объект"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {objects.map((object) => (
                <SelectItem key={object.id} value={object.id}>
                  {object.name} ({object.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.dutyKind === "POST" && (
        <div className="space-y-2">
          <Label>Пост *</Label>
          <Select
            value={value.postId}
            onValueChange={(next) =>
              onChange({
                ...value,
                postId: next,
                postName: posts.find((item) => item.id === next)?.name ?? "",
              })
            }
            disabled={dependentDisabled || posts.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  dependentDisabled
                    ? "Сначала выберите объект"
                    : posts.length === 0
                    ? "У объекта нет постов в паспорте"
                    : "Выберите пост"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {posts.map((post) => (
                <SelectItem key={post.id} value={post.id}>
                  {post.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {value.dutyKind === "GROUP" && (
        <div className="space-y-2">
          <Label>Группа *</Label>
          <Select
            value={value.groupId}
            onValueChange={(next) =>
              onChange({
                ...value,
                groupId: next,
                groupName:
                  DUTY_GROUPS.find((item) => item.id === next)?.name ?? "",
              })
            }
            disabled={dependentDisabled}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  dependentDisabled
                    ? "Сначала выберите объект"
                    : "Выберите группу"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {DUTY_GROUPS.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

/** Что мешает сохранить наряд. Пустой список — можно сохранять. */
export function validateDutyDraft(draft: DutyDraft): string[] {
  const errors: string[] = [];
  if (!draft.dutyKind) errors.push("Выберите тип дежурства");
  if (!draft.objectId) errors.push("Выберите объект");
  if (draft.dutyKind === "POST" && !draft.postId) errors.push("Выберите пост");
  if (draft.dutyKind === "GROUP" && !draft.groupId)
    errors.push("Выберите группу");
  return errors;
}
