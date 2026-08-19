---
name: project-duty-assignment-link
description: "Связка «статус На дежурстве → наряд → дежурные силы объекта» во фронте PersonalRecordFront; наряд хранится клиентски, «План дежурств» удалён"
metadata: 
  node_type: memory
  type: project
  originSessionId: ba6988f1-2326-4a03-ab84-323031645e67
---

13.08.2026, коммит `cba88eba` (ветка main воркtree wizardly-chaplygin-f750e9).

Сделано во фронте `Backend/PersonnelStatus/PersonalRecordFront`:
- удалён модуль «План дежурств» (`/security-ops/duties`, `[id]`, `hooks/use-duty-plan.ts`, `features/duty-plan-lifecycle`). ВЫЖИЛИ и зависят от общих данных: «Боевые группы» (`/security-ops/duties/combat`), «Календарь смен», аналитика и отчёты службы — поэтому `entities/duty-shift` и `mocks/ops/duties-handlers.ts` НЕ удалять;
- модалка `EditStatusDialog` = «Статусы сотрудника», вход кликом по ячейке статуса в `components/status-table.tsx` и `entities/employee/ui/EmployeeTable.tsx`;
- раздел «Дежурные силы» в карточке объекта — `features/object-duty-forces`.

Ключевое: **наряд хранится клиентски** — `entities/duty-assignment` (localStorage `vaps.duty-assignments.v1` + `useSyncExternalStore`). Причина: у `statuses.EmployeeStatus` на бэкенде НЕТ полей наряда (тип дежурства / объект / пост / группа), а бэкенд в задачу не входил. Формат записи повторяет серверный ответ — подмена на HTTP это замена `model/store.ts`.

Ловушки, найденные при работе:
- ключ сотрудника в модалке — `${staffUnitId}-${employeeId}`; на `/employees` в `Employee` пришлось добавить `staffUnitId`, иначе ключ не собрать (там id был голый);
- `/api/staff_unit/staff-units/directorate/` НЕ отдаёт `rank` у сотрудника (только id/ФИО/current_status), карточки сотрудника на этом бэке нет → звание в наряде пустое;
- реестр видов дежурств бэкенда (`/api/ops/duty-types/`) делит дежурства по ЦЕЛИ (OWN_OBJECT/PROTECTED_OBJECT), а не постовое/групповое — ось «постовое/групповое» и список групп заданы во фронте (`DUTY_KINDS`, `DUTY_GROUPS`);
- посты берутся из паспорта объекта: `SecurityObject.sectors[].posts`;
- «Конференция» ЗАВЕДЕНА отдельным коммитом `bf536353`: `conference` в `statuses.EmployeeStatus.StatusType` + миграция `statuses/0002`, пара в `LEGACY_CODE_BY_CODE`, колонка расхода TRAINING в `reports/utils.py`. Канонический каталог ОМ (`seed_status_types`) держал CONFERENCE ещё раньше — не хватало только пары в старом словаре.

Инвариант «единственный источник» держится тем, что ЛЮБОЙ статус кроме `on_duty` снимает наряд. Покрыты модалка и массовое обновление; `PlannedStatusesDialog` (правка запланированных статусов) наряд НЕ трогает — осознанный пробел.

Связано: [[project_ops_live_mode_default]], [[project_two_backends_spa_targets_new]], [[reference_vaps_docs_ledger_location]].
