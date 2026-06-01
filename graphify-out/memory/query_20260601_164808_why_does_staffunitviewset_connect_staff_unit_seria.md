---
type: "query"
date: "2026-06-01T16:48:08.837929+00:00"
question: "Why does StaffUnitViewSet connect Staff Unit Serializers to Dictionaries, Employee Permissions and other communities — what makes it the codebase's central bridge?"
contributor: "graphify"
source_nodes: ["StaffUnitViewSet", "StaffUnit", "PositionSerializer", "EmployeeSerializer", "EmployeeStatus", "RoleBasedPermission", "CanManageStaffingTable"]
---

# Q: Why does StaffUnitViewSet connect Staff Unit Serializers to Dictionaries, Employee Permissions and other communities — what makes it the codebase's central bridge?

## Answer

Expanded from original query via vocab: [staff, unit, staffing, table, vacancy, vacancies, dictionaries, rank, position, permission, scope, employee]. StaffUnitViewSet (staff_unit/views.py:128) is the central bridge (betweenness 0.088, ~33 edges across 6 communities) because StaffUnit is the join entity pairing Division + Position (dictionary) with an Employee occupant and EmployeeStatus. It uses PositionSerializer (Dictionaries c8), EmployeeSerializer (Employees c12), EmployeeStatus (Statuses c30/31), and six RBAC permission classes (CanViewStaffingTable/CanManageStaffingTable/CanView-Create-EditVacancy + RoleBasedPermission). It also absorbed directorate management and personnel-number generation, inflating connectivity. Most cross-community edges are INFERRED 'uses'; structural backbone is EXTRACTED. Refactor candidate: move _directorate_* and _generate_personnel_number into a service layer (cf StatusApplicationService).

## Source Nodes

- StaffUnitViewSet
- StaffUnit
- PositionSerializer
- EmployeeSerializer
- EmployeeStatus
- RoleBasedPermission
- CanManageStaffingTable