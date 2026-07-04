import { Input, Label } from "my-v0-project";

export const WithLabel = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-fio">ФИО сотрудника</Label>
    <Input id="input-fio" placeholder="Ахметов Данияр Серикович" />
  </div>
);

export const Filled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-tab">Табельный номер</Label>
    <Input id="input-tab" defaultValue="04-1287" />
  </div>
);

export const Invalid = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-order">Номер приказа</Label>
    <Input id="input-order" aria-invalid defaultValue="б/н" />
    <p className="text-xs text-muted-foreground">
      Укажите номер приказа в формате 123-л/с
    </p>
  </div>
);

export const Disabled = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="input-dep">Подразделение</Label>
    <Input
      id="input-dep"
      disabled
      defaultValue="Управление кадров"
    />
    <p className="text-xs text-muted-foreground">
      Заполняется автоматически из штатного расписания
    </p>
  </div>
);

export const Types = () => (
  <div className="flex w-full max-w-sm flex-col gap-3">
    <div className="flex w-full flex-col gap-2">
      <Label htmlFor="input-date">Дата выхода из отпуска</Label>
      <Input id="input-date" type="date" defaultValue="2026-07-21" />
    </div>
    <div className="flex w-full flex-col gap-2">
      <Label htmlFor="input-search">Поиск по личным делам</Label>
      <Input
        id="input-search"
        type="search"
        placeholder="Фамилия или табельный номер"
      />
    </div>
  </div>
);
