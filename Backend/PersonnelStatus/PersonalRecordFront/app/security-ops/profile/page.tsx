"use client";

// Мой профиль: тело — виджет `ProfileBody` (Plane №449), здесь только ответ
// на вопрос «а который сотрудник я». Отвечает на него СЕРВЕР
// (`/api/operations/my-employee/`): связь учётной записи с кадровой живёт
// только у него. Подбирать себя на клиенте по совпадению фамилии нельзя —
// однофамилец выдал бы чужую службу за свою.
//
// Связи МОЖЕТ НЕ БЫТЬ, и это штатный исход: поле заполняется вручную, сид его
// не делает. Тогда экран показывает причину словами сервера, а не пустые
// плитки: нули здесь читались бы как «ничего не было».
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useMyEmployee } from "@/hooks/use-my-employee";
import { ProfileBody } from "@/widgets/my-profile";

export default function MyProfilePage() {
  const me = useMyEmployee();
  const employee = me.data?.employee ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Личный кабинет"
          title="Мой профиль"
          description="Личные данные, назначения, календарь и история службы"
        />

        {me.isPending && (
          <p className="text-sm text-muted-foreground">Загрузка профиля…</p>
        )}

        {me.isError && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Не удалось прочитать кадровую запись. Профиль показан не будет —
              подставлять сюда чужие данные нельзя.
            </CardContent>
          </Card>
        )}

        {me.data !== undefined && employee === null && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Кадровая запись не найдена</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{me.data.unlinked_reason}</p>
              <p>
                Связь заводит кадровая служба в карточке сотрудника — после
                этого профиль откроется сам.
              </p>
            </CardContent>
          </Card>
        )}

        {employee !== null && <ProfileBody employee={employee} />}

      </div>
    </DashboardLayout>
  );
}

