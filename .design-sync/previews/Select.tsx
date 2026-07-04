import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "my-v0-project";

export const Placeholder = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="sel-status">Статус сотрудника</Label>
    <Select>
      <SelectTrigger id="sel-status" className="w-full">
        <SelectValue placeholder="Выберите статус" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="present">На месте</SelectItem>
        <SelectItem value="vacation">Отпуск</SelectItem>
        <SelectItem value="trip">Командировка</SelectItem>
        <SelectItem value="sick">Больничный</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export const Selected = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="sel-selected">Новый статус</Label>
    <Select defaultValue="vacation">
      <SelectTrigger id="sel-selected" className="w-full">
        <SelectValue placeholder="Выберите статус" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Статусы присутствия</SelectLabel>
          <SelectItem value="present">На месте</SelectItem>
          <SelectItem value="vacation">Отпуск</SelectItem>
          <SelectItem value="trip">Командировка</SelectItem>
          <SelectItem value="sick">Больничный</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="sel-disabled">Подразделение</Label>
    <Select defaultValue="hr" disabled>
      <SelectTrigger id="sel-disabled" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="hr">Управление кадров</SelectItem>
        <SelectItem value="it">Управление информатизации</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">
      Изменение подразделения — только через приказ о переводе
    </p>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Select defaultValue="214">
      <SelectTrigger className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="214">Приказ № 214-л/с от 03.07.2026</SelectItem>
        <SelectItem value="198">Приказ № 198-л/с от 25.06.2026</SelectItem>
      </SelectContent>
    </Select>
    <Select defaultValue="2026">
      <SelectTrigger size="sm" className="w-fit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="2026">2026 год</SelectItem>
        <SelectItem value="2025">2025 год</SelectItem>
      </SelectContent>
    </Select>
  </div>
);
