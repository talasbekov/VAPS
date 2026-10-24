# 23. Правила исполнения для Fable/Claude/Codex

## 1. Перед каждой story

1. Прочитать `00_INDEX`, решение/правило/use case/screen spec/epic.
2. Проверить актуальный Git HEAD и clean status.
3. Найти текущую реализацию и тесты; не считать prototype доказательством отсутствия кода.
4. Записать assumptions и conflicts.
5. Определить owner дефекта: UI, API, data, permission, provider или requirement.
6. Сформулировать exact outcome и out-of-scope.
7. Не кодировать, если блокирующее решение имеет `REQUIRES_*` и отсутствует approved default.

## 2. Во время реализации

- минимальное изменение, сохраняющее working state;
- одна business truth, никаких копий enum/price/topic;
- новый API сначала contract/authorization/errors/idempotency;
- mutation pending/unknown/retry states обязательны;
- notification/analytics/audit после commit;
- не запускать mass formatting/fix вне scope;
- не менять stack ради удобства story;
- не удалять старый path до перехода всех consumers;
- visual изменения через tokens и screen ID;
- новые функции не маскировать demo data.

## 3. Обязательный Execution Log

```text
Story:
HEAD before / after:
Assumptions:
Files changed:
Contract/data changes:
Tests run and exact result:
Manual/device/browser checks:
Screens/evidence:
Known limitations:
Traceability/decision/changelog updates:
Rollback:
```

## 4. Проверка story

- build/analyze/lint соответствующей поверхности;
- domain/unit/contract/API tests;
- соседний critical flow;
- role/ownership/403;
- RU/KK;
- loading/empty/error/offline/unknown-result;
- accessibility;
- visual screenshot/diff;
- analytics/privacy;
- device/manual gate, если feature platform-dependent;
- clean git diff без unrelated changes.

## 5. Запреты для ИИ

- «улучшить всё»;
- переписать с нуля без ADR;
- подменить неработающий API mock-данными в production route;
- придумать цену, SLA, permission или status;
- закрыть story только unit test;
- объявить device check выполненным без запуска;
- скрыть ошибку catch-all пустым экраном;
- добавить абстракцию на одно использование;
- менять дизайн на generic dashboard;
- создавать новый parallel planning vault.

## 6. Правило frontend first без отрыва от backend

Уклон на frontend означает:

1. сначала screen/use case/state contract и visual target;
2. затем проверить живой API;
3. если gap — минимальный backend vertical slice;
4. сгенерировать client contract;
5. реализовать screen со всеми states;
6. visual + role click-map;
7. только затем следующая story.

Это **не** означает сначала нарисовать 106 экранов на mocks, а потом пытаться подключить backend.

## 7. Stop conditions

Остановить затронутую story и создать decision/gap, когда:

- два канонических источника конфликтуют;
- изменение денег/безопасности/privacy не утверждено;
- доступных данных недостаточно для честного UI;
- API требует destructive migration без rollback;
- feature создаёт новый юридический vertical;
- acceptance невозможно доказать в окружении.

Остальные независимые stories могут продолжаться.

## 8. Definition of Done

- бизнес outcome воспроизводится;
- acceptance criteria выполнены;
- API/roles/states согласованы;
- tests/evidence приложены;
- visual parity или approved deviation;
- no sensitive data leak;
- docs/traceability/changelog обновлены;
- known limitation явно остаётся open;
- rollback понятен;
- P0/P1 regressions отсутствуют.
