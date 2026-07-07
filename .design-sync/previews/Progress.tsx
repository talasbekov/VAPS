import { Progress } from "my-v0-project";

export const Values = () => (
  <div className="w-full max-w-md space-y-4">
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Не начато</span>
        <span className="font-medium">0%</span>
      </div>
      <Progress value={0} />
    </div>
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">В работе</span>
        <span className="font-medium">45%</span>
      </div>
      <Progress value={45} />
    </div>
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Завершено</span>
        <span className="font-medium">100%</span>
      </div>
      <Progress value={100} />
    </div>
  </div>
);

export const StaffingLevels = () => (
  <div className="w-full max-w-md space-y-3">
    <p className="text-sm font-medium">Укомплектованность подразделений</p>
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>Управление кадров</span>
        <span className="text-muted-foreground">117 из 128</span>
      </div>
      <Progress value={91} />
    </div>
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>Отдел учёта</span>
        <span className="text-muted-foreground">88 из 96</span>
      </div>
      <Progress value={92} />
    </div>
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>Канцелярия</span>
        <span className="text-muted-foreground">65 из 76</span>
      </div>
      <Progress value={86} />
    </div>
  </div>
);
