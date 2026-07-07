import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
} from "my-v0-project";

export const Open = () => (
  <Dialog open>
    <DialogContent showCloseButton>
      <DialogHeader>
        <DialogTitle>Изменение статуса сотрудника</DialogTitle>
        <DialogDescription>
          Ахметов Асан Болатович — Управление кадров. Текущий статус: «На
          службе».
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="dlg-status">Новый статус</Label>
          <Select>
            <SelectTrigger id="dlg-status" className="w-full">
              <SelectValue placeholder="Командировка" />
            </SelectTrigger>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dlg-order">Номер приказа</Label>
          <Input id="dlg-order" defaultValue="215-к от 03.07.2026" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline">Отмена</Button>
        <Button>Сохранить</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
