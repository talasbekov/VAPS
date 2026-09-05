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
import { useMemo, useState } from "react";
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
  /** Поля с флагом «уточняется» у визита (`[ГВО-06]`, Plane №435). */
  unspecified?: string[];
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
  unspecified = [],
  onClose,
}: GvoSectionDialogProps) {
  const { toast } = useToast();
  const spec = gvoSectionSpec(section);
  // Флаги «уточняется» — по ключам полей (`[ГВО-06]`): пустое поле остаётся
  // пустым, слово печатает документ только по флагу. Список хранится целиком
  // у визита; окно правит свои ключи и возвращает весь.
  const [flags, setFlags] = useState<Set<string>>(() => new Set(unspecified));
  const toggleFlag = (key: string, on: boolean) =>
    setFlags((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

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
      unspecified: [...flags].sort(),
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
                ) : !field.flaggable ? (
                  // Поле без флага — только ввод (Plane №518). Галочка стоит
                  // ровно там, где флаг кто-то читает; см. `flaggable` в спеке
                  // раздела.
                  <Input
                    {...control}
                    className="h-[38px] text-[13px]"
                    placeholder={field.placeholder}
                    {...register(field.key)}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      {...control}
                      className="h-[38px] text-[13px]"
                      placeholder={field.placeholder}
                      {...register(field.key)}
                    />
                    <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        // 🔴 ФЛАГ ХРАНИТСЯ ПО ПУТИ, А НЕ ПО ИМЕНИ ПОЛЯ ФОРМЫ
                        // (Plane №517). `key` — имя поля В ФОРМЕ РАЗДЕЛА, и оно
                        // не единственное на весь документ: «Прибытие» и
                        // «Убытие» оба зовут своё поле `time`, `resp` есть и у
                        // «Состава ГВО», и у «Ответственного». Отсюда две беды
                        // сразу.
                        //
                        // Первая — та, что видел человек: поставил «уточняется»
                        // на «Время прибытия», открыл «Убытие» — галочка уже
                        // стоит; снял её там — снял и у прибытия.
                        //
                        // Вторая тише и хуже: флаги читает СЕРВЕР как ПУТИ
                        // (`documents_summary.document_values`, `missing_
                        // required`), а сюда уходило короткое имя. Значит у
                        // всех полей, чей путь длиннее имени (`arrival.*`,
                        // `departure.*`, `stay.place`, `responsible`), флаг не
                        // совпадал НИ С ЧЕМ: слово «уточняется» в документ не
                        // попадало вовсе, и обязательное поле не переставало
                        // считаться незаполненным. Галочка стояла, а не делала
                        // ничего.
                        checked={flags.has(field.path)}
                        onChange={(e) => toggleFlag(field.path, e.target.checked)}
                        aria-label={`Уточняется: ${field.label}`}
                      />
                      уточняется
                    </label>
                  </div>
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
