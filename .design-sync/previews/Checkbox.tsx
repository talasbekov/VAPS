import { Checkbox, Label } from "my-v0-project";

export const WithLabel = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="cb-notify" />
    <Label htmlFor="cb-notify">Уведомить руководителя подразделения</Label>
  </div>
);

export const Checked = () => (
  <div className="flex items-center gap-2">
    <Checkbox id="cb-order" defaultChecked />
    <Label htmlFor="cb-order">Приказ подписан и зарегистрирован</Label>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Checkbox id="cb-dis-off" disabled />
      <Label htmlFor="cb-dis-off">Продлить командировку</Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-dis-on" disabled defaultChecked />
      <Label htmlFor="cb-dis-on">Табель за июнь закрыт</Label>
    </div>
  </div>
);

export const StatusFilter = () => (
  <div className="flex flex-col gap-3">
    <p className="text-sm font-medium">Показать статусы</p>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-st-present" defaultChecked />
      <Label htmlFor="cb-st-present" className="font-normal">
        На месте
      </Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-st-vacation" defaultChecked />
      <Label htmlFor="cb-st-vacation" className="font-normal">
        Отпуск
      </Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-st-trip" />
      <Label htmlFor="cb-st-trip" className="font-normal">
        Командировка
      </Label>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox id="cb-st-sick" />
      <Label htmlFor="cb-st-sick" className="font-normal">
        Больничный
      </Label>
    </div>
  </div>
);
