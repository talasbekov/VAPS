import { Label, Textarea } from "my-v0-project";

export const WithLabel = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="ta-reason">Основание изменения статуса</Label>
    <Textarea
      id="ta-reason"
      placeholder="Например: приказ о направлении в командировку, рапорт, листок нетрудоспособности"
    />
  </div>
);

export const Filled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="ta-note">Примечание к приказу</Label>
    <Textarea
      id="ta-note"
      rows={4}
      defaultValue="Направить Ахметова Д. С. в служебную командировку в г. Астана с 7 по 11 июля 2026 года. Основание: приказ № 214-л/с от 03.07.2026."
    />
  </div>
);

export const Invalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="ta-invalid">Причина отсутствия</Label>
    <Textarea id="ta-invalid" aria-invalid defaultValue="—" />
    <p className="text-xs text-muted-foreground">
      Поле обязательно при статусе «Больничный»
    </p>
  </div>
);

export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="ta-disabled">Комментарий кадровой службы</Label>
    <Textarea
      id="ta-disabled"
      disabled
      defaultValue="Личное дело передано в архив 12.05.2026, редактирование недоступно."
    />
  </div>
);
