"use client";

/**
 * Справочник типов статусов сотрудников (Plane №344).
 *
 * ЗАЧЕМ ЭКРАН. Заказчик завёл тип статуса в админке и не нашёл его на экране
 * «Система → Справочники»: реестр перечислял только generic-справочники
 * (`OpsDictionaryEntry`), а типы статусов живут своей таблицей
 * `ops_status_types` со своими полями. №342 починил ИСТОЧНИК каталога для окон
 * и подписей; посмотреть сам справочник по-прежнему было негде.
 *
 * ТОЛЬКО ЧТЕНИЕ, и это не полумера. Каталог правится сидом
 * (`manage.py seed_status_types`) и админкой Django: у типа есть поля, которые
 * меняют ПОВЕДЕНИЕ системы — жёсткая блокировка (конфликт статусов отвечает
 * 422 вместо 409), колонка суточного расхода, счёт в списке и в штате. Форма
 * заведения такого типа — отдельная работа со своими проверками, а не кнопка
 * «Добавить» рядом с таблицей. Экран честно говорит, где тип заводится.
 *
 * НЕАКТИВНЫЕ ПОКАЗЫВАЮТСЯ. Деактивация — не удаление: старые строки статусов
 * продолжают ссылаться на выключенный тип, и администратор открывает
 * справочник как раз затем, чтобы увидеть, что тип выключен, а не исчез.
 */
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadFailure } from "@/components/load-failure";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";

/** Признак типа: галочка ЛИБО прочерк, но не пустая ячейка — пустота в
 *  таблице свойств читается как «данных нет», а не как «нет». */
function Flag({ on, title }: { on: boolean; title: string }) {
  return (
    <span title={title} className={on ? "" : "text-muted-foreground"}>
      {on ? "да" : "—"}
    </span>
  );
}

export default function StatusTypesDictionaryPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  // Реестр справочников открыт по `dictionary.view`, сам каталог читается
  // и по нему, и по `status.view` (сервер принимает оба, Plane №344).
  const canView =
    hasPermission("dictionary.view") || hasPermission("status.view");
  const { all, isLoading, isError, isFetching, refetch } = useOpsStatusTypes(
    !permissionsLoading && canView
  );

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="справочника типов статусов" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Система · Справочники"
          title="Типы статусов сотрудников"
          description="Каталог статусов раздела ОМ: приоритет, колонка суточного расхода и правила конфликтов"
          actions={
            <Link
              href="/security-ops/dictionaries"
              className="text-sm text-primary-ink"
            >
              ← Все справочники
            </Link>
          }
        />

        {isLoading && (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка справочника…
            </CardContent>
          </Card>
        )}

        {isError && (
          <Card>
            <CardContent className="p-4">
              <LoadFailure
                what="справочник типов статусов"
                onRetry={refetch}
                isRetrying={isFetching}
                className="items-center text-center"
              />
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && (
          <>
            <Card>
              {/* Таблица шире телефона — прокручивается САМА, а не тянет за
                  собой страницу. */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Тип</TableHead>
                      <TableHead className="text-right">Приоритет</TableHead>
                      <TableHead>Колонка расхода</TableHead>
                      <TableHead>Жёсткая блокировка</TableHead>
                      <TableHead>В списке</TableHead>
                      <TableHead>В штате</TableHead>
                      <TableHead>Предельный срок</TableHead>
                      <TableHead>Кадровый код</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {all.map((type) => (
                      <TableRow key={type.code}>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            {type.code}
                          </span>
                          <span className="flex items-center gap-2 font-semibold">
                            {type.name}
                            {/* Отмечается ОТКЛОНЕНИЕ, а не норма: своя колонка
                                под «Активен» у восемнадцати строк из
                                девятнадцати занимала ширину, из-за которой
                                таблица не помещалась и обрезала сама себя. */}
                            {!type.is_active && (
                              <Badge variant="secondary">Выключен</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {type.priority}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {type.report_column_code}
                        </TableCell>
                        <TableCell>
                          <Flag
                            on={type.is_hard_block}
                            title="Конфликт с этим статусом не обходится согласованием"
                          />
                        </TableCell>
                        <TableCell>
                          <Flag on={type.counts_in_list} title="Считается в списке подразделения" />
                        </TableCell>
                        <TableCell>
                          <Flag on={type.counts_in_staff} title="Считается в штате" />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {/* Ноль дней и «без ограничения» — разные вещи, и
                              пустая ячейка их бы сравняла. */}
                          {type.max_duration_days === null
                            ? "без ограничения"
                            : `${type.max_duration_days} дн.`}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {type.legacy_code ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>

            {/* Экран без кнопок обязан сказать, ГДЕ правят: иначе он читается
                как незаконченный. */}
            <p className="text-sm text-muted-foreground">
              Справочник только для чтения. Типы заводятся и правятся в админке
              и командой <code className="font-mono">seed_status_types</code>:
              у типа есть свойства, меняющие поведение системы — жёсткая
              блокировка, колонка суточного расхода, счёт в списке и в штате.
              Выключенный тип не удалён: строки статусов продолжают на него
              ссылаться и сохраняют подпись.
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
