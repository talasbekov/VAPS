export const COMBAT_PATH = '/api/ops/combat-duty-board/';
export interface CombatAssignment {
  kind: 'GROUP'; group_id: string; group_name: string; shift_id: string; business_date: string;
  division_id?: string;
  location: CombatLocation; location_label: string; object_id: string | null; post_id: string | null;
  event_id: string | null; event_name: string | null; automatic: boolean;
}
export interface CombatLocation { kind: 'OBJECT' | 'ROUTE' | 'POST' | 'POINT' | 'RESERVE'; label?: string; objectId?: string; postId?: string | null; routeIds?: string[]; latitude?: number; longitude?: number }
export interface CombatMember { employeeId: string; employeeName: string; isLeader: boolean; isDriver: boolean; isReserve: boolean; acknowledged?: boolean }
export interface CombatEquipment { category: 'PASSENGER' | 'ARMORED' | 'OTHER'; label: string; quantity: number }
export interface CombatShift {
  id: string; businessDate: string; groupId: string; groupName: string; divisionId: string; divisionName: string;
  maxMembers: number; dutyTypeId: string; dutyTypeName: string; shiftKind: string; restDayAfter: boolean;
  stateCode: 'SUBMITTED' | 'ACCEPTED' | 'RETURNED' | 'CANCELLED'; executionState: string | null;
  location: CombatLocation; event: { id: string; title: string } | null; callsign: string; equipment: CombatEquipment[];
  isReserve: boolean; returnReason: string | null; cancellationReason: string; members: CombatMember[];
  acknowledgedCount: number; assignment: CombatAssignment;
  warnings?: { employeeId: string; employeeName: string; reason: string }[];
  execution: { handover?: unknown; actualStart?: string; actualEnd?: string } | null;
}
export interface CombatSummary { totalGroups: number; formedGroups: number; people: number; vehicles: number; awaitingReview: number; activeGroups: number; reserveGroups: number }
export interface CombatBoard { businessDate: string; summary: CombatSummary; shifts: CombatShift[] }
export interface CombatCatalogRow { id: string; divisionId: string; isActive: boolean; name: string; maxMembers?: number; code?: string; shiftKind?: string; restDayAfter?: boolean; supportsMultipleRoutes?: boolean; objectId?: string; posts?: { id: string; name: string; sectorName: string }[] }
export interface CombatChoices {
  groups: CombatCatalogRow[]; types: CombatCatalogRow[]; routes: CombatCatalogRow[]; places: CombatCatalogRow[];
  divisions: { id: string; name: string; parentId: string | null }[]; events: { id: string; title: string }[];
  objectChoices: { id: string; name: string }[]; permissions: { roster: boolean; manageCatalogs: boolean; review: boolean; rosterDivisionIds: string[] | null; manageCatalogsDivisionIds: string[] | null; reviewDivisionIds: string[] | null };
}
export interface CombatCandidate { employeeId: string; employeeName: string; divisionId: string; unitName: string; inService: boolean; blockReason: string; eventWarning: boolean }
export interface CombatFormData { businessDate: string; groupId: string; dutyTypeId: string; members: CombatMember[]; location: CombatLocation; eventId: string | null; callsign: string; equipment: CombatEquipment[]; isReserve: boolean; amendmentReason: string }
export const combatState = (shift: CombatShift) => ({ SUBMITTED: 'На рассмотрении', RETURNED: 'Возвращена', CANCELLED: 'Отменена', ACCEPTED: 'Принята', PENDING_ACKNOWLEDGEMENT: 'Ожидает ознакомления', READY: 'Готова к заступлению', ACTIVE: 'Дежурит', COMPLETED: 'Завершена' }[shift.stateCode === 'ACCEPTED' ? shift.executionState ?? 'ACCEPTED' : shift.stateCode] ?? shift.stateCode);
