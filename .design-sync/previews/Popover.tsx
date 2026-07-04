import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Checkbox,
  Label,
} from "my-v0-project";
import { ChevronDown } from "lucide-react";

export const Open = () => (
  <div className="flex justify-center pt-2" style={{ minHeight: 320 }}>
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="outline">
          Подразделение <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="space-y-3">
          <p className="text-sm font-medium">Фильтр по подразделению</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="pop-uk" defaultChecked />
              <Label htmlFor="pop-uk">Управление кадров</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pop-ub" defaultChecked />
              <Label htmlFor="pop-ub">Управление безопасности</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pop-fin" />
              <Label htmlFor="pop-fin">Финансовый отдел</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm">
              Сбросить
            </Button>
            <Button size="sm">Применить</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
);
