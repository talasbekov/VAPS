import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
  Badge,
} from "my-v0-project";

export const EmployeeCard = () => (
  <Card className="w-full max-w-sm">
    <CardHeader>
      <CardTitle>Ахметов Данияр Серикович</CardTitle>
      <CardDescription>Главный специалист · Управление кадров</CardDescription>
      <CardAction>
        <Badge className="bg-green-100 text-green-800">На месте</Badge>
      </CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">
        Табельный номер 04-1287. В подразделении с марта 2019 года. Допуск к
        работе со сведениями ограниченного распространения оформлен.
      </p>
    </CardContent>
    <CardFooter className="gap-2">
      <Button size="sm">Профиль</Button>
      <Button size="sm" variant="outline">
        Изменить статус
      </Button>
    </CardFooter>
  </Card>
);

export const PlainContent = () => (
  <Card className="w-full max-w-sm">
    <CardHeader>
      <CardTitle>Сводка за 3 июля</CardTitle>
      <CardDescription>Департамент по работе с персоналом</CardDescription>
    </CardHeader>
    <CardContent className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Списочная численность</span>
        <span className="font-medium">412</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">На месте</span>
        <span className="font-medium">371</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">В отпуске</span>
        <span className="font-medium">28</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">На больничном</span>
        <span className="font-medium">13</span>
      </div>
    </CardContent>
  </Card>
);
