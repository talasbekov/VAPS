import { Badge } from "my-v0-project";
import { CircleCheck, Clock3, TriangleAlert, Plane } from "lucide-react";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Badge>Основной</Badge>
    <Badge variant="secondary">Вторичный</Badge>
    <Badge variant="destructive">Нарушение</Badge>
    <Badge variant="outline">Контурный</Badge>
  </div>
);

export const StatusPalette = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Badge className="bg-green-100 text-green-800">На месте</Badge>
    <Badge className="bg-blue-100 text-blue-800">В отпуске</Badge>
    <Badge className="bg-yellow-100 text-yellow-800">На больничном</Badge>
    <Badge className="bg-purple-100 text-purple-800">Командировка</Badge>
    <Badge className="bg-red-100 text-red-800">Отсутствует</Badge>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Badge className="bg-green-100 text-green-800">
      <CircleCheck /> Допуск оформлен
    </Badge>
    <Badge className="bg-yellow-100 text-yellow-800">
      <Clock3 /> Ожидает согласования
    </Badge>
    <Badge className="bg-purple-100 text-purple-800">
      <Plane /> Командировка до 12.07
    </Badge>
    <Badge variant="destructive">
      <TriangleAlert /> Просрочен пропуск
    </Badge>
  </div>
);
