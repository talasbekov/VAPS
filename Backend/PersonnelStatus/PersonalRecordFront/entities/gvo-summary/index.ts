export * from "./model/types";
// Вывод базы сводки (deriveGvoSummary, mergeGvoSummary, gvoVisitDays) отсюда
// СНЯТ (Plane №166): сводку собирает сервер. Мок держит свою копию правила в
// `mocks/ops/gvo-derive.ts` — общей она больше не будет.
export {
  gvoSenior,
  gvoStaffCount,
  gvoCountryAbbr,
  canManageGvoSummary,
} from "./model/derive";
export {
  gvoSectionSpec,
  gvoFormFromSummary,
  gvoPatchFromForm,
  gvoSectionPatchKeys,
  isPersonSection,
  isGroupSection,
  sectionIndex,
  // Обязательные поля визита — ЗЕРКАЛО серверного списка, нужное моку
  // (Plane №691). Живой экран считает их на сервере и берёт готовыми.
  REQUIRED_VISIT_FIELDS,
  missingRequiredFields,
} from "./model/sections";
export type {
  GvoFieldSpec,
  GvoSectionForm,
  GvoSectionSpec,
} from "./model/sections";
