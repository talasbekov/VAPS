import { Separator } from "my-v0-project";

export const Horizontal = () => (
  <div className="w-full max-w-md">
    <div className="space-y-1">
      <h4 className="text-sm font-medium leading-none">Личное дело № 04-1287</h4>
      <p className="text-sm text-muted-foreground">
        Ахметов Данияр Серикович, Управление кадров
      </p>
    </div>
    <Separator className="mt-3 mb-2" />
    <p className="text-sm text-muted-foreground">
      Последнее изменение: 28 июня, перевод на должность главного специалиста.
    </p>
  </div>
);

export const Vertical = () => (
  <div className="flex h-5 items-center gap-3 text-sm">
    <span className="font-medium">Профиль</span>
    <Separator orientation="vertical" />
    <span className="text-muted-foreground">Документы</span>
    <Separator orientation="vertical" />
    <span className="text-muted-foreground">Отпуска</span>
    <Separator orientation="vertical" />
    <span className="text-muted-foreground">Награды</span>
  </div>
);
