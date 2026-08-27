"use client";

// Транспорт ГОН: реестр бронированных машин Гаража особого назначения
// (Plane №215). Колонки — из образца «04 Список броней в ГОН»: марка, кузов,
// год выпуска, ГРНЗ, класс брони, дислокация, примечание.
//
// Справочник ТОЛЬКО ДЛЯ ЧТЕНИЯ. Кнопок заведения и правки здесь нет и не
// будет: строки реестра правятся в Django Admin, как у охраняемых лиц. Об
// этом сказано словами внизу экрана — молчаливое отсутствие кнопки читалось
// бы как недоделка.
//
// Отбор живёт в АДРЕСЕ и считается СЕРВЕРОМ: обновление страницы не сбрасывает
// выборку, ссылкой можно поделиться, а парк из сотен строк не гоняется в
// браузер ради десяти машин класса VR7.
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { useVehicleArmorClasses, useVehicles } from "@/hooks/use-vehicles";
import type { Vehicle } from "@/entities/vehicle";

/** Колонки таблицы — подписи дословно из образца заказчика. */
const COLUMNS = [
  "Марка автомобиля",
  "Классификация по кузову",
  "Год выпуска",
  "ГРНЗ",
  "Класс брони",
  "Дислокация",
  "Примечание",
] as const;

function VehiclesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Право то же, что у соседних справочников раздела: выделенная машина видна
  // там же, где мероприятие, и отдельный код закрыл бы реестр от его читателей.
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const armorClass = searchParams.get("armorClass") ?? "";
  const search = searchParams.get("search") ?? "";
  const includeRetired = searchParams.get("includeRetired") === "1";

  const canView = hasPermission("event.view");
  const query = useVehicles(
    { armorClass, search, includeRetired },
    { enabled: canView }
  );
  const classesQuery = useVehicleArmorClasses({ enabled: canView });

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  // Запрос уходит на СЕРВЕР, поэтому буква за буквой он слал бы запрос на
  // каждое нажатие клавиши.
  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, (value) =>
    updateParam("search", value)
  );

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="реестра транспорта ГОН" />;
  }

  const vehicles = query.data?.results ?? [];
  const armorClasses = classesQuery.data?.results ?? [];
  const filtered = armorClass !== "" || search !== "";

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Транспорт ГОН"
          description="Бронированные транспортные средства Гаража особого назначения, задействованные на обслуживании охраняемых лиц"
        />

        <div className="space-y-[10px]">
          <Input
            className="h-[38px] text-[13px]"
            placeholder="Поиск по марке или государственному номеру…"
            aria-label="Поиск по реестру транспорта"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* Значения отбора приходят С СЕРВЕРА и считаются по парку: класс
                брони — свободная строка, и зашитый список разошёлся бы с
                парком при первом же завозе машин. */}
            {["", ...armorClasses].map((value) => (
              <Button
                key={value === "" ? "ALL" : value}
                type="button"
                size="sm"
                aria-pressed={armorClass === value}
                variant={armorClass === value ? "default" : "outline"}
                className="h-8 rounded-full px-[13px] text-[12.5px] font-semibold"
                onClick={() => updateParam("armorClass", value)}
              >
                {value === "" ? "Все классы брони" : value}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              aria-pressed={includeRetired}
              variant={includeRetired ? "default" : "outline"}
              className="ml-auto h-8 rounded-full px-[13px] text-[12.5px] font-semibold"
              onClick={() =>
                updateParam("includeRetired", includeRetired ? "" : "1")
              }
            >
              Показывать снятые
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-muted-foreground">
              Загрузка реестра транспорта…
            </CardContent>
          </Card>
        ) : query.isError ? (
          <Card>
            <CardContent className="p-9 text-center text-sm text-destructive-ink">
              Не удалось загрузить реестр транспорта.
            </CardContent>
          </Card>
        ) : vehicles.length === 0 ? (
          <Card>
            <CardContent className="p-9 text-center text-[13px] text-muted-foreground">
              {/* Пустой отбор и пустой реестр — РАЗНЫЕ причины, и лечатся они
                  разным: первое сбросом отбора, второе заведением машин. */}
              {filtered
                ? "По этому отбору машин нет — измените класс брони или строку поиска."
                : "Реестр транспорта пуст: машины заводятся в Django Admin."}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {/* Таблица шире экрана прокручивается ВНУТРИ себя: иначе
                  горизонтальную полосу получает вся страница. */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
                  <caption className="sr-only">
                    Реестр бронированных транспортных средств ГОН
                  </caption>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      {COLUMNS.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="whitespace-nowrap px-3 py-[10px] text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((vehicle) => (
                      <VehicleRow key={vehicle.id} vehicle={vehicle} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-[11.5px] text-muted-foreground">
          Реестр читается системой и правится в Django Admin: машины заводит,
          переносит и снимает с эксплуатации администратор.
        </p>
      </div>
    </DashboardLayout>
  );
}

function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  return (
    <tr className={vehicle.isActive ? "border-b" : "border-b opacity-60"}>
      <td className="px-3 py-[10px] font-semibold">
        {vehicle.brand}
        {vehicle.isActive ? null : (
          // Снятая машина названа СЛОВОМ, а не одной бледностью: цвет не
          // читается вспомогательными технологиями и теряется на печати.
          <span className="ml-2 inline-flex whitespace-nowrap rounded-full bg-muted px-[9px] py-0.5 text-[10.5px] font-bold text-muted-foreground">
            снята с эксплуатации
          </span>
        )}
      </td>
      <td className="px-3 py-[10px] text-muted-foreground">
        {vehicle.bodyClass || "—"}
      </td>
      <td className="px-3 py-[10px] tabular-nums">
        {/* «—», а не пусто: год есть не у каждой строки образца, и пустая
            ячейка читалась бы как сбой загрузки. */}
        {vehicle.productionYear ?? "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-[10px] font-semibold tabular-nums">
        {vehicle.plate}
      </td>
      <td className="px-3 py-[10px]">
        {vehicle.armorClass === "" ? (
          <span className="text-muted-foreground">без брони</span>
        ) : (
          <span className="inline-flex whitespace-nowrap rounded-full bg-blue-100 px-[9px] py-0.5 text-[10.5px] font-bold text-blue-800">
            {vehicle.armorClass}
          </span>
        )}
      </td>
      <td className="px-3 py-[10px]">{vehicle.deployment || "—"}</td>
      <td className="px-3 py-[10px] text-muted-foreground">
        {vehicle.note || "—"}
      </td>
    </tr>
  );
}

export default function VehiclesPage() {
  // Граница `Suspense` вокруг тела экрана: `useSearchParams` без неё ломает
  // прод-сборку страницы, и видно это ТОЛЬКО прод-сборкой (Plane №112).
  return (
    <Suspense fallback={null}>
      <VehiclesScreen />
    </Suspense>
  );
}
