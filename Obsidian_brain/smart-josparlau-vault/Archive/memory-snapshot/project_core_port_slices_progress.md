---
name: project-core-port-slices-progress
description: Переезд core из Backend/VAPS в Personnel-Records — где остановились и как устроен адаптер
metadata: 
  node_type: memory
  type: project
  originSessionId: be7b91bc-b843-47a0-85ad-a0e84beeb1e2
---

Переезд `/api/core/*` из донора `Backend/VAPS` в целевой
`Backend/PersonnelStatus/Personnel-Records`. Ветка `claude/smart-josparlau-e55`.

**Главное правило: переносится КОНТРАКТ, а не модель.** `apps/core` донора —
7000 строк, 17 миграций и собственные Division/Employee/**User**; копия
поставила бы второй Division рядом с `divisions.Division` и второй User рядом
со стоковым `auth.User`. Конвенция записана в шапке
`apps/operations/selectors.py` («переезд женит новый RBAC со старым деревом»).
Новый контракт садится на старые модели адаптером в
`organization_management/apps/core/api/`.

Сделано:
- **срез 153** (`95459b33`) — `/api/core/divisions/`. `type_code` ←
  `division_type`; `organization` ← MPTT `get_root()`, НЕ parent (у донора
  организация — отдельная сущность, здесь корень дерева).
- **срез 154a** (`4d8a2932`) — поле `code` у `Position` и `Rank` (их не было
  вовсе). Суррогаты `POS-<id>`/`RANK-<id>`, unique + CHECK на непустоту.
- **срез 154b** (`67993f0c`) — `/api/core/employees/`. `position_code` и
  `division` — ЧЕРЕЗ `StaffUnit` (в старой схеме их нет в Employee);
  отсутствующие поля (`external_id`, `phone`, `height_cm`,
  `is_attached_force`, `data_source`) отдаются null — решение Bratan.
  **Экран «Расход дня» обеспечен всеми четырьмя запросами.**

- **срезы 155/156** (`df95a858`, `1aa5fcfc`) — `/api/core/positions/` и
  `/api/core/ranks/`. Полей `sort_order`, `is_active`, `category` в старых
  справочниках нет → null; `rank_index` ← `level` (тот же прецедент, что в
  `EmployeeSerializer`).

- **срезы 157/158/159** (`0fc50618`, `d17d3b7f`, `88e9d17b`) —
  `/api/core/staffing-slots/`, `/api/core/vacancies/`,
  `/api/documents/attachments/`.

**ПЕРЕЕЗД ЗАВЕРШЁН**: всё, что есть в доноре, есть в целевом бэке. Карта
пробелов — `docs/api-gaps.md` (в git через `add -f`, весь `docs/*` игнорится).
Дальше остаются только 37 путей `/api/ops/*`, которых нет НИ В ОДНОМ бэке —
это новая разработка, а не переезд.

Открытый вопрос (не блокирует): у донора `code` — первичный ключ справочника,
поэтому его detail-адрес `/positions/<code>/`, а у нас pk целочисленный и
роутер собрал `/positions/<id>/`. SPA зовёт только СПИСОК, потребителя у
detail нет — `lookup_field="code"` решено не вводить.

**Ловушки, найденные по дороге:**
- Срез 154b заявлял «Экран „Расход дня“ обеспечен всеми четырьмя запросами»,
  но `EmployeeViewSet` **игнорировал `?division_id=`** и отдавал весь личный
  состав (тест был только на форму строки, не на фильтр; малый стенд прятал).
  Починено `034b2b74` (фильтр через `staff_unit__division_id`, 400 на мусоре,
  5 тестов + красная проба). Мораль: формулировка «экран обеспечен» ≠ фильтры
  реализованы — сверять с query-параметрами, которые реально шлёт SPA.
- Отсутствующие в старой схеме поля контракта отдаём **null**, не похожее
  поле: подмена читается клиентом как настоящие данные.
- `StaffUnit` НЕ несёт `requirements`/`responsibilities` — они у соседнего
  класса в том же файле.
- Гвард N+1 писать как СРАВНЕНИЕ двух замеров (мало/много строк), а не как
  магическое число запросов.
- Новый `__init__.py` в `apps/<app>/tests/` взводит мину namespace-пакетов
  (см. [[feedback-namespace-pkg-breaks-pytest-collection]]) — давать
  `__init__.py` самому приложению.
- Гейт: `PR_TEST_DB_NAME=test_pr_busy_almeida ./.venv/bin/python -m pytest -q`
  из Personnel-Records. На срезе 159 — 2410 passed. НЕ гонять с `--reuse-db`: даёт ложные падения из-за отставшей схемы после миграции 154a.

См. [[project-two-backends-spa-targets-new]] — почему это вообще понадобилось.

**Решения срезов 157-159, которые стоит помнить:**
- `/api/core/vacancies/` — это НЕ старая модель `Vacancy` (та = объявление о
  наборе). У донора адрес отдаёт СВОБОДНЫЕ СЛОТЫ в форме StaffingSlot;
  свободен слот без сотрудника.
- `slot_number` ← `StaffUnit.index` (его `verbose_name` буквально «Номер
  слота») — перевод того же рода, что `rank_index` ← `level`.
- `is_active`/`valid_from`/`valid_to` → null: у `StaffUnit` нет ни признака
  действующего слота, ни временных границ. По той же причине у vacancies НЕ
  заведён параметр `date` — принять дату значило бы выдать сегодняшний штат за
  штат на любую дату.
- Список вложений СУЖЕН по области выпуска-владельца: без этого держатель
  `document.view` читал бы имена файлов любого управления.
- У донора списочного GET на `/api/documents/attachments/` НЕТ (только POST и
  `{id}/download/`) — список заведён заново, загрузка не переезжала.
- Открытый вопрос: право на vacancies у нас `orgstructure.view`, у донора
  `personnel.view`.
