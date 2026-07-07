import { Alert, AlertTitle, AlertDescription } from "my-v0-project";
import { Info, AlertCircle } from "lucide-react";

export const Default = () => (
  <Alert>
    <Info />
    <AlertTitle>Данные обновлены</AlertTitle>
    <AlertDescription>
      Статусы сотрудников синхронизированы с табелем на 09:00. Следующее
      обновление — через 15 минут.
    </AlertDescription>
  </Alert>
);

export const Destructive = () => (
  <Alert variant="destructive">
    <AlertCircle />
    <AlertTitle>Не удалось сохранить изменения</AlertTitle>
    <AlertDescription>
      Статус «Командировка» требует указания приказа. Заполните номер и дату
      приказа и повторите попытку.
    </AlertDescription>
  </Alert>
);
