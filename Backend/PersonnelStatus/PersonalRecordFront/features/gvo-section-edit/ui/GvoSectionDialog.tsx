"use client";

// Правка одного раздела сводной карточки ГВО. Окно всегда несёт РОВНО свой
// раздел: сводка большая, и общая форма на всю карточку сделала бы каждую
// правку конфликтом за весь документ.
//
// Форма на react-hook-form. Правил валидации у раздела нет — набор полей
// приходит из спеки, и схема собирается по ней же. Выигрыш здесь не в
// правилах, а в механизме: поля перестали быть управляемыми, и каждое нажатие
// клавиши больше не пересобирает объект формы целиком.
//
// 🔴 `required` у полей НЕ ставим: `Field` дописал бы к подписи звёздочку, а
// подписи этого окна пинит проба `e2e/gvo-sections.spec.ts` по доступному
// имени («Название группы»).
import { useMemo } from "react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, useZodForm } from "@/shared/lib/form";
import { useToast } from "@/shared/hooks/use-toast";
import {
  gvoFormFromSummary,
  gvoPatchFromForm,
  gvoSectionSpec,
  isGroupSection,
  isPersonSection,
  sectionIndex,
} from "@/entities/gvo-summary";
import type {
  GvoSection,
  GvoSectionForm,
  GvoSummary,
} from "@/entities/gvo-summary";
import { useResetGvoSection, useSaveGvoSection } from "@/hooks/use-gvo-summaries";

export interface GvoSectionDialogProps {
  omCode: string;
  omTitle: string;
  section: GvoSection;
  /** Сводка ДО правки: из неё берётся текст формы и полные списки для патча. */
  summary: GvoSummary;
  onClose: () => void;
}

export function GvoSectionDialog(props: GvoSectionDialogProps) {
  // Ключ по разделу: смена раздела — новая форма, а не дописывание в старую.
  return <OpenDialog key={props.section} {...props} />;
}

function OpenDialog({
  omCode,
  omTitle,
  section,
  summary,
  onClose,
}: GvoSectionDialogProps) {
  const { toast } = useToast();
  const spec = gvoSectionSpec(section);

  // Схема по спеке раздела: полей у разных разделов разное число, и
  // перечислять их вторым списком значило бы завести копию спеки.
  const schema = useMemo(
    () =>
      z.object(
        Object.fromEntries(
          spec.fields.map((field) => [field.key, z.string()])
        ) as Record<string, z.ZodString>
      ),
    [spec]
  );

  // Засев из сводки — один раз: RHF читает `defaultValues` на первом рендере,
  // а пересобирать текст всей карточки на каждый рендер незачем.
  const defaults = useMemo(
    () => gvoFormFromSummary(section, summary),
    [section, summary]
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useZodForm<GvoSectionForm>(schema, defaults);

  const save = useSaveGvoSection({
    onSaved: () => {
      toast({ description: "Сводные данные обновлены" });
      onClose();
    },
  });
  const reset = useResetGvoSection({
    onReset: () => {
      toast({ description: "Раздел возвращён к исходным данным" });
      onClose();
    },
  });
  const removed = useSaveGvoSection({
    onSaved: () => {
      toast({
        description: isGroupSection(section)
          ? "Группа ГВО удалена"
          : "Охраняемое лицо удалено",
      });
      onClose();
    },
  });

  const pending = save.isPending || reset.isPending || removed.isPending;
  const failure = save.error ?? reset.error ?? removed.error;
  // Удалять можно только существующий элемент списка: у «Новой группы» и
  // «Нового лица» удалять нечего.
  const index = sectionIndex(section);
  const canDelete = index !== null && (isPersonSection(section) || isGroupSection(section));

  function submit(values: GvoSectionForm): void {
    save.mutate({
      omCode,
      section,
      values: gvoPatchFromForm(section, values, summary),
    });
  }

  function remove(): void {
    if (index === null) return;
    const values = isGroupSection(section)
      ? { groups: summary.groups.filter((_, i) => i !== index) }
      : { persons: summary.persons.filter((_, i) => i !== index) };
    removed.mutate({ omCode, section, values });
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <p className="text-[11.5px] text-muted-foreground">
            {omCode} · {omTitle}
          </p>
        </DialogHeader>

        <form
          className="flex flex-col gap-[13px]"
          noValidate
          onSubmit={(e) => void handleSubmit(submit)(e)}
        >
          {spec.fields.map((field) => (
            <Field
              key={field.key}
              name={field.key}
              label={field.label}
              error={errors[field.key]}
              hint={field.hint === "" ? undefined : field.hint}
              className="space-y-1"
              labelClassName="text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]"
            >
              {(control) =>
                field.multiline ? (
                  <Textarea
                    {...control}
                    rows={field.rows}
                    className="resize-y text-[12.5px] leading-relaxed"
                    {...register(field.key)}
                  />
                ) : (
                  <Input
                    {...control}
                    className="h-[38px] text-[13px]"
                    placeholder={field.placeholder}
                    {...register(field.key)}
                  />
                )
              }
            </Field>
          ))}

          {failure !== null && (
            <p className="text-sm text-destructive-ink" role="alert">
              Не удалось сохранить раздел. Попробуйте ещё раз.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-[15px]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => reset.mutate({ omCode, section })}
            >
              Вернуть исходные
            </Button>
            {canDelete && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                className="border-red-200 text-red-700 hover:bg-red-50"
                onClick={remove}
              >
                {isGroupSection(section) ? "Удалить группу" : "Удалить лицо"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending}>
                {save.isPending ? "Сохранение…" : "Сохранить"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
