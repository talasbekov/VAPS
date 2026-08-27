// Домен «Транспорт ГОН» — реестр бронированных машин Гаража особого
// назначения (Plane №215). Справочник ТОЛЬКО ДЛЯ ЧТЕНИЯ: правка идёт в
// Django Admin, как у охраняемых лиц и нормативной базы. Вторая дверь в те же
// строки дала бы две правды о том, кто их менял.

export interface Vehicle {
  id: string;
  /** Марка целиком, как её пишет автохозяйство: «Mercedes-Benz S680 Maybach 4 М (брон.)». */
  brand: string;
  /** Классификация по кузову: «седан (223)». */
  bodyClass: string;
  /** Год выпуска; null — в реестре не указан (в образце год есть не у всех). */
  productionYear: number | null;
  /** Государственный регистрационный номерной знак. */
  plate: string;
  /** Класс брони: «VR7». Пусто — небронированная машина. */
  armorClass: string;
  /** Дислокация: «Астана», «Алматы». */
  deployment: string;
  note: string;
  /** false — машина снята с эксплуатации; в кортеж её не поставить. */
  isActive: boolean;
}

/** Машина, ВЫДЕЛЕННАЯ на мероприятие. */
export interface EventVehicle {
  id: string;
  /** null — машину удалили из реестра; подпись при этом остаётся. */
  vehicleId: string | null;
  /** Снимок подписи на момент выделения: «марка (ГРНЗ)». */
  label: string;
  /** Позывной в кортеже: «S1», «VIP». Принадлежит мероприятию, а не машине. */
  callsign: string;
  /** Зачем выделена: кортеж, сопровождение, резерв. */
  purpose: string;
  /** Живые сведения машины; null — ссылки на реестр больше нет. */
  plate: string | null;
  armorClass: string | null;
  position: number;
}

// ── Контракты API ───────────────────────────────────────────────────────

export const VEHICLES_PATH = "/api/ops/vehicles/";
export const VEHICLE_ARMOR_CLASSES_PATH = "/api/ops/vehicles/armor-classes/";

export interface ListVehiclesResponse {
  results: Vehicle[];
}

export interface ListArmorClassesResponse {
  /** Классы брони, КОТОРЫЕ ЕСТЬ В ПАРКЕ: сервер считает их по данным, а не
   *  отдаёт перечисление — жёсткий список разошёлся бы с парком в первый завоз. */
  results: string[];
}

export interface VehicleFilters {
  armorClass?: string;
  deployment?: string;
  search?: string;
  includeRetired?: boolean;
}

/** Параметры отбора → строка запроса. Пустые значения не отправляются:
 *  `?armorClass=` сервер прочитал бы как отбор по пустому классу. */
export function vehiclesQuery(filters: VehicleFilters): string {
  const params = new URLSearchParams();
  if (filters.armorClass) params.set("armorClass", filters.armorClass);
  if (filters.deployment) params.set("deployment", filters.deployment);
  if (filters.search) params.set("search", filters.search);
  if (filters.includeRetired) params.set("includeRetired", "1");
  const qs = params.toString();
  return qs === "" ? VEHICLES_PATH : `${VEHICLES_PATH}?${qs}`;
}
