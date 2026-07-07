import { Button } from "my-v0-project";
import { Plus, Download, Trash2, Settings } from "lucide-react";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>Сохранить</Button>
    <Button variant="secondary">Отмена</Button>
    <Button variant="outline">Экспорт</Button>
    <Button variant="ghost">Подробнее</Button>
    <Button variant="link">История изменений</Button>
    <Button variant="destructive">Удалить</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Мелкая</Button>
    <Button size="default">Обычная</Button>
    <Button size="lg">Крупная</Button>
    <Button size="icon" aria-label="Настройки">
      <Settings />
    </Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>
      <Plus /> Добавить сотрудника
    </Button>
    <Button variant="outline">
      <Download /> Выгрузить отчёт
    </Button>
    <Button variant="destructive">
      <Trash2 /> Удалить запись
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>Сохранить</Button>
    <Button variant="outline" disabled>
      Экспорт
    </Button>
  </div>
);
