import { Checkbox, Input, Label } from "my-v0-project";

export const Basic = () => (
  <div className="flex flex-col gap-3">
    <Label>Дата зачисления в штат</Label>
    <Label>Категория допуска</Label>
  </div>
);

export const WithInput = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Label htmlFor="lbl-input-post">Должность</Label>
    <Input id="lbl-input-post" placeholder="Главный специалист" />
  </div>
);

export const WithCheckbox = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="lbl-cb-archive" defaultChecked />
    <Label htmlFor="lbl-cb-archive">
      Включить уволенных сотрудников в отчёт
    </Label>
  </div>
);

export const DisabledPeer = () => (
  <div className="flex w-full max-w-sm flex-col gap-2">
    <Input
      id="lbl-input-disabled"
      className="peer"
      disabled
      defaultValue="12-0453"
    />
    <Label htmlFor="lbl-input-disabled">
      Табельный номер (назначается системой)
    </Label>
  </div>
);
