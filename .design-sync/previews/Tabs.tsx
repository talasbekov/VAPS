import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Badge,
} from "my-v0-project";

export const StatusTabs = () => (
  <Tabs defaultValue="all" className="w-full max-w-md">
    <TabsList>
      <TabsTrigger value="all">Все</TabsTrigger>
      <TabsTrigger value="present">На месте</TabsTrigger>
      <TabsTrigger value="absent">Отсутствуют</TabsTrigger>
    </TabsList>
    <TabsContent value="all">
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>Ахметов Данияр Серикович</span>
          <Badge className="bg-green-100 text-green-800">На месте</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Ибраева Алия Маратовна</span>
          <Badge className="bg-blue-100 text-blue-800">В отпуске</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span>Сергеев Павел Андреевич</span>
          <Badge className="bg-yellow-100 text-yellow-800">На больничном</Badge>
        </div>
      </div>
    </TabsContent>
    <TabsContent value="present">
      <p className="text-sm text-muted-foreground">
        371 сотрудник на месте.
      </p>
    </TabsContent>
    <TabsContent value="absent">
      <p className="text-sm text-muted-foreground">
        41 сотрудник отсутствует: отпуск, больничный, командировка.
      </p>
    </TabsContent>
  </Tabs>
);

export const WithCounts = () => (
  <Tabs defaultValue="vacation" className="w-full max-w-md">
    <TabsList>
      <TabsTrigger value="vacation">
        Отпуск <Badge variant="secondary" className="px-1.5">28</Badge>
      </TabsTrigger>
      <TabsTrigger value="sick">
        Больничный <Badge variant="secondary" className="px-1.5">13</Badge>
      </TabsTrigger>
      <TabsTrigger value="trip">
        Командировки <Badge variant="secondary" className="px-1.5">7</Badge>
      </TabsTrigger>
    </TabsList>
    <TabsContent value="vacation">
      <p className="text-sm text-muted-foreground">
        Очередные отпуска по графику на июль. Ближайшее возвращение — Ибраева
        Алия, 14 июля.
      </p>
    </TabsContent>
    <TabsContent value="sick">
      <p className="text-sm text-muted-foreground">
        Листы нетрудоспособности, открытые на текущую дату.
      </p>
    </TabsContent>
    <TabsContent value="trip">
      <p className="text-sm text-muted-foreground">
        Служебные командировки, утверждённые приказом.
      </p>
    </TabsContent>
  </Tabs>
);
