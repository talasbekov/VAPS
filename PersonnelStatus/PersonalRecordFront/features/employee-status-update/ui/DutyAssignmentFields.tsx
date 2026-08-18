"use client";

// Блок наряда — часть модалки статусов, появляется только у «На дежурстве».
// Отдельный файл, а не ветка внутри модалки: у блока своя зависимость полей
// (вид дежурства → чем уточняется объект), и держать её рядом с датами значит
// смешивать два разных набора правил.
//
// Черновик наряда — вложенный объект формы (`duty`), поэтому имена полей здесь
// с точкой: `duty.objectId`. Они же — id в DOM, и по ним форма ведёт фокус к
// первой ошибке. Раньше ошибки наряда уезжали в общую сводку списком строк —
// «Выберите объект» не показывал, какое из четырёх полей блока пустое.

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/shared/lib/form";
import { useSecurityObjects } from "@/hooks/use-security-objects";
import { DUTY_GROUPS, DUTY_KINDS } from "@/entities/duty-assignment";
import {
  EMPTY_DUTY_DRAFT,
  type DutyDraft,
} from "../model/edit-status-schema";

export { EMPTY_DUTY_DRAFT };
export type { DutyDraft };

interface DutyAssignmentFieldsProps {
  value: DutyDraft;
  onChange: (next: DutyDraft) => void;
  /** Ошибки вложенного объекта `duty` из формы: `Field` берёт из них `message`. */
  errors?: { [K in keyof DutyDraft]?: unknown };
}

export function DutyAssignmentFields({
  value,
  onChange,
  errors,
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
        <Field
          name="duty.dutyKind"
          label="Тип дежурства"
          required
          error={errors?.dutyKind}
        >
          {(field) => (
            <Select
              value={value.dutyKind}
              onValueChange={(next) =>
                // Смена вида пересобирает зависимое поле: значение прежнего вида
                // здесь бессмысленно, и оставленный «пост» у группового дежурства
                // уехал бы в наряд молча.
                onChange({
                  ...value,
                  dutyKind: next as DutyDraft["dutyKind"],
                  postId: "",
                  postName: "",
                  groupId: "",
                  groupName: "",
                })
              }
            >
              <SelectTrigger {...field}>
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
          )}
        </Field>

        <Field
          name="duty.objectId"
          label="Объект"
          required
          error={errors?.objectId}
        >
          {(field) => (
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
              <SelectTrigger {...field}>
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
          )}
        </Field>
      </div>

      {value.dutyKind === "POST" && (
        <Field name="duty.postId" label="Пост" required error={errors?.postId}>
          {(field) => (
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
              <SelectTrigger {...field}>
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
          )}
        </Field>
      )}

      {value.dutyKind === "GROUP" && (
        <Field
          name="duty.groupId"
          label="Группа"
          required
          error={errors?.groupId}
        >
          {(field) => (
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
              <SelectTrigger {...field}>
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
          )}
        </Field>
      )}
    </div>
  );
}
