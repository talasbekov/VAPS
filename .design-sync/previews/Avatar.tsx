import { Avatar, AvatarImage, AvatarFallback } from "my-v0-project";

const photo =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%232563eb'/%3E%3Ccircle cx='20' cy='15' r='7' fill='white'/%3E%3Cellipse cx='20' cy='36' rx='13' ry='10' fill='white'/%3E%3C/svg%3E";

export const Fallbacks = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Avatar>
      <AvatarFallback>АД</AvatarFallback>
    </Avatar>
    <Avatar className="h-10 w-10">
      <AvatarFallback className="bg-blue-100 text-blue-800">ИА</AvatarFallback>
    </Avatar>
    <Avatar className="h-12 w-12">
      <AvatarFallback className="bg-green-100 text-green-800">
        СП
      </AvatarFallback>
    </Avatar>
  </div>
);

export const WithImage = () => (
  <div className="flex items-center gap-3">
    <Avatar className="h-12 w-12">
      <AvatarImage src={photo} alt="Ахметов Данияр" />
      <AvatarFallback>АД</AvatarFallback>
    </Avatar>
    <div className="min-w-0">
      <p className="text-sm font-medium leading-none">
        Ахметов Данияр Серикович
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Главный специалист · Управление кадров
      </p>
    </div>
  </div>
);

export const Group = () => (
  <div className="flex items-center">
    <Avatar className="h-10 w-10 border-2 border-white">
      <AvatarFallback className="bg-blue-100 text-blue-800">АД</AvatarFallback>
    </Avatar>
    <Avatar className="h-10 w-10 border-2 border-white" style={{ marginLeft: -10 }}>
      <AvatarFallback className="bg-green-100 text-green-800">
        ИА
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-10 w-10 border-2 border-white" style={{ marginLeft: -10 }}>
      <AvatarFallback className="bg-yellow-100 text-yellow-800">
        СП
      </AvatarFallback>
    </Avatar>
    <Avatar className="h-10 w-10 border-2 border-white" style={{ marginLeft: -10 }}>
      <AvatarFallback className="bg-muted text-muted-foreground">
        +9
      </AvatarFallback>
    </Avatar>
    <span className="text-sm text-muted-foreground" style={{ marginLeft: 12 }}>
      Дежурная смена — 12 человек
    </span>
  </div>
);
