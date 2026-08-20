# Дизайн: живой бэк для «Реестр ГВО» и «Охраняемые лица»

Дата: 2026-08-20. Утверждён вариант A: «бэк = контракт мока, сборка сводки остаётся на клиенте».

## Цель

Снять два модуля раздела «Охранные мероприятия» с мока MSW: хранение ручных правок сводок ГВО и каталог охраняемых лиц переезжают на Django-бэк (`Personnel-Records`, :8100). Клиентская сборка сводки из бюллетеня (`entities/gvo-summary`) не меняется.

## Контекст (факты из кода, проверены 20.08.2026)

- Мок ГВО (`mocks/ops/gvo-handlers.ts`) хранит только **патчи** ручных правок по коду ОМ; база сводки выводится на клиенте из бюллетеня мероприятия. Ручки: `GET /api/ops/gvo-summaries/`, `PATCH /api/ops/gvo-summaries/{omCode}/`, `POST /api/ops/gvo-summaries/{omCode}/reset/`. Персист — sessionStorage.
- Мок лиц (`mocks/ops/protected-persons-handlers.ts`): плоский каталог `{id, name, callsign, category: OURS|FOREIGN, bio}`, только `GET /api/ops/protected-persons/`.
- Страницы ГВО/лиц гейтятся существующими правами `event.view` / `event.manage` (плоские коды без префикса `ops.` — так работает вся живая система прав, см. `hooks/use-ops-permissions.ts`). Мнимый долг «префикс ops.*» в живом коде уже разрешён: **новые коды прав не заводим**.
- Мероприятие: `OpsSecurityEvent` (`apps/operations/models_event.py`), `code` unique, CheckConstraint на непустоту.
- Live-переключатели доменов: `lib/ops-env.ts` → `isDomainLive("<domain>")`.
- `lib/api-gaps.ts`: `GVO_NO_BACKEND`, `PROTECTED_PERSONS_NO_BACKEND` — снять.

## Решения по контрактным долгам (фиксируются в Personnel-Records/Decisions.md)

1. **Права:** канон — плоские коды сидов без префикса; ГВО/лица используют существующие `event.view` (чтение) и `event.manage` (правка/сброс патча). Новых кодов нет.
2. **ID:** канон — бэк отдаёт int `id`; клиент приводит на границе api-клиента (`String(id)`), типы entities не меняются (`id: string`).

## Бэкенд

### Модели — `apps/operations/models_gvo.py`

- `OpsProtectedPerson(TimeStampedModel)`: `name` CharField(200), `callsign` CharField(100, blank=True), `category` CharField(choices=OURS/FOREIGN, без дефолта) + `CheckConstraint(category in (...))` (практика проекта для choice без дефолта), `bio` TextField(blank=True), `is_active` BooleanField(default=True) для мягкого скрытия. Ordering пиним литерально (`["name", "id"]`). Правка — только Django Admin (Admin = справочники).
- `OpsGvoSummaryPatch(TimeStampedModel)`: `event` OneToOneField(OpsSecurityEvent, on_delete=CASCADE, related_name="gvo_patch"), `patch` JSONField (форма = `GvoSummaryPatch` фронта: country, persons[], arrival{}, … — валидируется по списку разрешённых ключей `gvoSectionPatchKeys`, лишние ключи → 400), `updated_by` FK(User, SET_NULL, null=True). Аудит правок — существующий механизм аудита operations (запись в журнал на PATCH/reset).

### API — `apps/operations/api/` (по образцу соседних vьюх раздела)

| Метод | Путь | Право | Ответ |
| --- | --- | --- | --- |
| GET | `/api/ops/gvo-summaries/` | `event.view` | `{results: [{omCode, patch, updatedAt}]}` — форма `ListGvoSummaryPatchesResponse` фронта |
| PATCH | `/api/ops/gvo-summaries/{omCode}/` | `event.manage` | 200 обновлённый патч; 404 если нет ОМ с таким code; 400 на неизвестные ключи |
| POST | `/api/ops/gvo-summaries/{omCode}/reset/` | `event.manage` | 200, патч удалён (сводка возвращается к базе из бюллетеня) |
| GET | `/api/ops/protected-persons/` | `event.view` | `{results: [...]}` — форма `ListProtectedPersonsResponse`, только `is_active=True` |

PATCH мержит по ключам верхнего уровня (semantics мока: присланный ключ замещает секцию целиком; отсутствующий — не трогается). Спектакльная схема: не забыть форму list-экшена на классе (грабля `many=False`).

### Сиды

`seed_operations.py` не меняется (права существующие). Новый management-сид `seed_gvo_demo` НЕ делаем: демо-патч «Черногория» остаётся особенностью мока. Каталог лиц сеется отдельной командой `seed_protected_persons` (5 записей из мока дословно) — для стенда и live-e2e.

## Фронтенд

- `lib/ops-env.ts`: домены `gvo`, `protected-persons` → `isOpsGvoLive()`, `isOpsProtectedPersonsLive()`.
- `mocks/ops/gvo-handlers.ts`, `protected-persons-handlers.ts`: регистрируются только когда домен НЕ live (сейчас — безусловно); паттерны и содержимое не трогаем (нужны тестам).
- `lib/api-gaps.ts`: убрать `GVO_NO_BACKEND`, `PROTECTED_PERSONS_NO_BACKEND` (и их использования) — баннеры «бэка нет» исчезают.
- Хуки `use-gvo-summaries` / api-клиент лиц: без изменений формы; на границе — приведение `String(id)` для persons.
- Карточка/страница ГВО уже читает merged-сводку — прочерки уходят сами там, где патч заведён.

## Тесты

- Бэк (pytest, посев bulk_create без factory_boy):
  - list/patch/reset happy-path + 404 по несуществующему `omCode` + 400 по неизвестному ключу патча.
  - Права: персона с `event.view` но БЕЗ `event.manage` получает 403 на PATCH/reset (право без персоны-без-него — вакуум); аноним — 403 на всё.
  - CheckConstraint category: красная проба мутацией **миграции** (снятие в модели не ловится — практика проекта).
  - Лок/аудит: запись в журнал аудита на PATCH — ассерт по новому pk записи, не по счётчику.
- Фронт:
  - e2e на моке — существующие сценарии ГВО/лиц остаются зелёными (домены не live в тестовом окружении).
  - live-smoke на стенде: сид `seed_protected_persons` + патч через API (перехватом, не мутацией стенда из UI), три персоны: полные права / только `event.view` / без прав + аноним.
  - Прогоны грепать на `failed|✘`, не tail.

## Вне рамки

Законы об ОМ (следующая спека, тот же паттерн); светофор «сдано, но разошлось»; амендмент-флоу; любые правки 4 модулей портала; CRUD лиц с фронта; серверная сборка сводки ГВО.

## Порядок исполнения (для плана)

1. Модель + миграция + constraint-проба (persons) → 2. Модель + миграция (gvo patch) → 3. API persons + права-тесты → 4. API gvo list/patch/reset + права-тесты → 5. Сид persons → 6. Фронт: домены live + снятие NO_BACKEND + String(id) → 7. e2e mock зелёные → 8. live-smoke → 9. Доки: Decisions (два решения), Карта-модулей/модульные доки (mock→live), Changelog, api-gaps не трогаем (заморожен).
