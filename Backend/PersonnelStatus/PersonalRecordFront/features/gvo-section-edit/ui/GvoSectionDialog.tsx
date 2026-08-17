"use client";

// Правка одного раздела сводной карточки ГВО. Окно всегда несёт РОВНО свой
// раздел: сводка большая, и общая форма на всю карточку сделала бы каждую
// правку конфликтом за весь документ.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [form, setForm] = useState<GvoSectionForm>(() =>
    gvoFormFromSummary(section, summary)
  );

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

  function submit(): void {
    save.mutate({
      omCode,
      section,
      values: gvoPatchFromForm(section, form, summary),
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
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {spec.fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <Label
                htmlFor={`gvo-${field.key}`}
                className="text-[11.5px] font-bold text-[hsl(215.4_16.3%_36.9%)]"
              >
                {field.label}
              </Label>
              {field.multiline ? (
                <Textarea
                  id={`gvo-${field.key}`}
                  rows={field.rows}
                  className="resize-y text-[12.5px] leading-relaxed"
                  value={form[field.key] ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, [field.key]: e.target.value })
                  }
                />
              ) : (
                <Input
                  id={`gvo-${field.key}`}
                  className="h-[38px] text-[13px]"
                  placeholder={field.placeholder}
                  value={form[field.key] ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, [field.key]: e.target.value })
                  }
                />
              )}
              {field.hint !== "" && (
                <p className="text-[11px] text-muted-foreground">{field.hint}</p>
              )}
            </div>
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
