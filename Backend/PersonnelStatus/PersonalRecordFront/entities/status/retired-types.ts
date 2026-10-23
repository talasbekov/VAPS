const RETIRED_SECONDMENT_CODES = new Set([
  "ATTACHED", "DETACHED", "SECONDED_FROM", "SECONDED_TO",
]);

/** Historical types stay readable, but cannot be selected for a new status. */
export function isSelectableStatusType(type: { code: string; legacy_code?: string | null }): boolean {
  return ![type.code, type.legacy_code].some(code =>
    code != null && RETIRED_SECONDMENT_CODES.has(code.trim().toUpperCase()),
  );
}
