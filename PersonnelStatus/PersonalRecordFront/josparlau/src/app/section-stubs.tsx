// Заглушки разделов пилота (Д6): живут в app/ — фича-папка появляется вместе
// с реальным экраном своей стори (E9/E10), переезд заглушки = часть той стори.
// Card-язык (EXPERIENCE L46): H1 раздела + подпись токен-классами; реальных
// экранов здесь НЕТ (границы 8.7). app→shared легально (ARCH-FE-013).
import { Card, CardDescription, CardHeader } from '../shared/ui/Card'

function SectionStub({ title }: { title: string }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-none tracking-tight">
          {title}
        </h1>
        <CardDescription>Экран появится в E9–E10</CardDescription>
      </CardHeader>
    </Card>
  )
}

export function DashboardStub() {
  return <SectionStub title="Дашборд «Расход»" />
}

// EmployeesStub переехал в features/personnel (Этап 4, Smart Josparlau §20):
// «переезд заглушки = часть той стори» — см. шапку файла.
// OrganizationStub переехал в features/traffic-light (стори 10.4): «переезд
// заглушки = часть той стори» — см. шапку файла.
// ReportsStub переехал в features/expense (стори 10.5), там же H1 «Отчёты».
// AuditStub переехал в features/audit (Этап 6, Smart Josparlau §29): «переезд
// заглушки = часть той стори» — см. шапку файла.
