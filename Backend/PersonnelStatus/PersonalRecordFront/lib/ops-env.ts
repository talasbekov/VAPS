// Источник данных раздела ОМ (/security-ops/*): mock (по умолчанию — реального
// бэкенда ОМ пока нет) или api. Переключение: NEXT_PUBLIC_OPS_DATA_SOURCE=api.
export function isOpsMockMode(): boolean {
  return process.env.NEXT_PUBLIC_OPS_DATA_SOURCE !== "api";
}
