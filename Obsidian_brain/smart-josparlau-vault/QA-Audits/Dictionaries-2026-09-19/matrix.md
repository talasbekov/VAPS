# Матрица справочников — 19.09.2026

Исполнитель: Кодекс Астра 6.
Plane №1141/1278/1286–1289. База 1c3c8050, ветка codex/dictionaries-audit-20260919.

Инвентаризация пройдена по всем 106 моделям проектных Django apps, а не только по меню: 98 зарегистрированы в Admin. Семь исключений — архивные справочники, ещё одно — старый SecondmentRequest (операционная запись, не справочник). Полный машинный перечень: [[model-inventory.json]].

## Действующие справочные модели

| Справочник | Модель | Django Admin | Браузер: список / карточка / форма | Изменение данных |
|---|---|---|---|---|
| Должности | `dictionaries.Position` | [открыть](http://localhost:8110/admin/dictionaries/position/) | открыты | create/edit/reload: id24 |
| Звания | `dictionaries.Rank` | [открыть](http://localhost:8110/admin/dictionaries/rank/) | открыты | create/edit/reload: id20 |
| Типы статусов (ОМ) | `operations.StatusType` | [открыть](http://localhost:8110/admin/operations/statustype/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/statustype/QA1909_5FSTATUS/change/) |
| Виды дежурств | `operations.OpsDutyType` | [открыть](http://localhost:8110/admin/operations/opsdutytype/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsdutytype/3/change/) |
| Виды дежурств боевых групп | `operations.OpsCombatDutyType` | [открыть](http://localhost:8110/admin/operations/opscombatdutytype/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opscombatdutytype/3/change/) |
| Трассы | `operations.OpsCombatRoute` | [открыть](http://localhost:8110/admin/operations/opscombatroute/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opscombatroute/4/change/) |
| Значения справочников ОМ | `operations.OpsDictionaryEntry` | [открыть](http://localhost:8110/admin/operations/opsdictionaryentry/) | открыты | 9 каталогов create/edit/reload PASS, ошибочные связи отклонены; [доказательства](admin-generic-results.json) |
| Группы рейтинга | `operations.OpsRatingGroup` | [открыть](http://localhost:8110/admin/operations/opsratinggroup/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsratinggroup/4/change/) |
| Показатели аналитики службы | `operations.OpsAnalyticsMetricDefinition` | [открыть](http://localhost:8110/admin/operations/opsanalyticsmetricdefinition/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsanalyticsmetricdefinition/8/change/) |
| Пресеты периодов аналитики | `operations.OpsAnalyticsPeriodPreset` | [открыть](http://localhost:8110/admin/operations/opsanalyticsperiodpreset/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsanalyticsperiodpreset/5/change/) |
| Детекторы внимания | `operations.OpsAttentionDetector` | [открыть](http://localhost:8110/admin/operations/opsattentiondetector/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsattentiondetector/6/change/) |
| Типы служебных отчётов | `operations.OpsServiceReportType` | [открыть](http://localhost:8110/admin/operations/opsservicereporttype/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsservicereporttype/2/change/) |
| Охраняемые лица | `operations.OpsProtectedPerson` | [открыть](http://localhost:8110/admin/operations/opsprotectedperson/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsprotectedperson/24/change/) |
| Страны | `operations.OpsCountry` | [открыть](http://localhost:8110/admin/operations/opscountry/) | открыты | create/edit/reload: id15, неактивна; удаление защищено городом |
| Города | `operations.OpsCity` | [открыть](http://localhost:8110/admin/operations/opscity/) | открыты | create/edit/reload: id43, неактивен; страна выбрана через autocomplete |
| Законы об ОМ | `operations.OpsLegalDocument` | [открыть](http://localhost:8110/admin/operations/opslegaldocument/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opslegaldocument/9/change/) |
| Транспорт ГОН | `operations.OpsVehicle` | [открыть](http://localhost:8110/admin/operations/opsvehicle/) | открыты | create/edit/reload PASS на изолированной копии :8112; [карточка](http://localhost:8112/admin/operations/opsvehicle/17/change/) |

Дополнительно к категории «Справочники»: OpsFeedbackRegistry (обратная связь), Division/StaffUnit (структура и штат), Role/Permission/RolePermission (система доступа). Это действующие зарегистрированные модели; их карточки проверяются отдельно. Изменение реальных ролей и назначений не выполняется.

## Девять каталогов внутри OpsDictionaryEntry

| Код | Смысл | Потребитель / правило |
|---|---|---|
| JOURNAL_ENTRY_TYPES | Типы записей журнала штаба | журнал проведения ОМ; удаление учитывает записи |
| RETURN_REASONS | Причины возврата | возврат хранит свободный текст; полная связь не отслеживается, удаление запрещено |
| POST_REQUIREMENTS | Требования к постам | выбранная группа должна существовать и быть активна |
| POST_REQUIREMENT_GROUPS | Группы требований | родитель POST_REQUIREMENTS; используемый не удаляется |
| PLACEMENT_ROLES | Роли наряда | строковые ссылки расстановки; код неизменяем |
| PLACEMENT_SECTIONS | Секции бланка | строковые ссылки расстановки; код неизменяем |
| SEASONAL_CORRECTIONS | Сезонные поправки | нормативы; удаление запрещено при неизвестных связях |
| EVENT_PARTICIPATION_KINDS | Виды участия | участия, потребности ОМ, снимки расхода; владелец обязателен для спецгруппы |
| EVENT_GROUP_ROLES | Роли внутри группы | ссылка на вид участия; проверки связи и стабильный код |

Единый редактор Admin, отдельные экраны `/security-ops/dictionaries/<CODE>/`; API `/api/ops/dictionaries/<CODE>/entries/`. STATUS_TYPES — отдельная таблица operations.StatusType и собственный read-only экран, не generic-строки.

## Архивные справочники

Решение 27.08 сохранено до ответа на уточнение: архивные API не открываются, текущая работа не возвращает их в действующие формы.

| Модель | Причина |
|---|---|
| `dictionaries.StatusType` | Двойник: справочник типов статусов живёт в разделе ОМ (`operations.StatusType`, `/api/operations/status-types/`), его и читает клиент. Эта модель не читается ничем — даже эндпоинт `/api/dictionaries/status_types/` отдаёт перечисление из кода, а не её строки. |
| `dictionaries.DismissalReason` | Требуется каноном UC-DICT-005, читателей нет; архивирован решением заказчика 27.08.2026. |
| `dictionaries.TransferReason` | Требуется каноном UC-DICT-005, читателей нет; архивирован решением заказчика 27.08.2026. |
| `dictionaries.VacancyReason` | Требуется каноном UC-DICT-005, читателей нет; архивирован решением заказчика 27.08.2026. |
| `dictionaries.EducationType` | Ни канона, ни читателей: поля образования у сотрудника нет вовсе. |
| `dictionaries.DocumentType` | Ни канона, ни читателей: `statuses.StatusDocument` хранит название документа строкой и на эту модель не ссылается. |
| `dictionaries.SystemSetting` | Требуется каноном UC-DICT-006, читателей нет; архивирован решением заказчика 27.08.2026. |

## Системные перечисления

В `model-inventory.json` отдельно сохранены все поля с `choices`: жизненные циклы, типы подразделений, категории ОЛ, виды документов и служебные состояния. Это правила кода, а не самостоятельные редактируемые справочники; они проверяются в соответствующих формах. Вычисляемые представления и журналы сохраняют свои ограничения.

## Доказательства и границы

[[browser-lists.json]], [[browser-forms.json]], [[position-create-edit-reload.txt]], [[rank-create-edit-reload.txt]], [[country-create-edit-reload.txt]], [[city-create-edit-reload.txt]], [[country-protect-delete.txt]]. Снимок [[position-browser.png]]. Часть формы `Add` в первой попытке выбрана из бокового меню: эта ошибка локатора исправлена и доказательства заменены. Секретные поля не снимались; аккаунты не создавались.

## Свежая проверка 19.09.2026

Исполнитель: Кодекс Астра 6. Код: `7ca7315a` (8 отдельных локальных коммитов от1c3c8050). Frontend gate: exit0, Django check: 0 issues. Первый полный backend: 5806passed/7failed/9warnings, exit1,710.88s. Все7отказов — старые фикстуры чтения без domain grant; после их исправления целиком statuses+secondments и новые dictionary/Admin tests: **150passed/34.18s**, exit0. Предыдущая целевая регрессия:91passed. Это последовательные результаты, а не выдуманный единый зелёный полный прогон.

Видимый Chrome: все17справочных моделей категории прошли create/edit/reload (4простых — на рабочем8110, остальные — на отдельной копии8112). Внутри OpsDictionaryEntry проверены все9каталогов; записи неактивны. Сервер отклонил отсутствующую группу и отсутствующего владельца; сохранение корректных связей, неизменяемые коды и ограничения удаления подтверждены UI. Неправильный target_type дежурства и пустой report_column_code статуса дали ожидаемые ошибки формы; с корректными данными сохранение прошло.

OpsFeedbackRegistry — singleton: изменение версии и reload прошли на копии, исходная версия восстановлена; второй экземпляр не создавался. Division, StaffUnit, Role, Permission, RolePermission — списки, действующие карточки и add-формы открыты; реальные роли/учётки/назначения не менялись. CRUD и права этих модулей покрыты backend-регрессией; это не заявляется как ручное изменение всех моделей.

Поиск QA1909:9строк; фильтры RETURN_REASONS+неактивные:1строка. Удаление через UI не подтверждалось, проверены доступность/защита и серверные regression tests. Учебная страна защищена городом. Семь архивных моделей не возвращались в API/Admin по действующему решению27.08.

Доказательства: [[admin-generic-results.json]], [[browser-extra-results.json]], [[supplemental-results.json]], [[admin-search-filter.txt]], [[feedback-edit-reload.txt]], [[feedback-restored.txt]], [[working-stand-fixed-admin.png]]. Во время первых проходов некоторые snapshots попали в промежуточную навигацию; подтверждения повторены с ожиданием заголовков и итоговые файлы исправлены.

Полный production smoke запущен с SMOKE_LIVE=1, SMOKE_APP/BASE_URL3112, API8112, PR_DB_NAME=sj_qa1909_smoke, SMOKE_PRESERVE_DATA=1. Результат ещё ожидается. Копия базы и отдельные media/private_storage изолированы от основного стенда.


2026-09-19 — Plane №1141/1278. Исполнитель: Кодекс Астра 6. Штатно установлен Chromium Headless Shell141/build1194, exit0. Повтор всех639smoke запущен, лог smoke-runtime-ready.log; первый инфраструктурный отказ не смешивается с новым прогоном. На основном портале3110 в видимом Chrome открыты все12каталогов (9generic+типы статусов+должности+звания); данные загрузились, новые учебные должность и звание из Admin видны в портале. Типы статусов:21строка, read-only. Доказательства portal-results.json, portal-1…12.txt и portal-rank-admin-value.png.


## Окончательный результат

Исполнитель: Кодекс Астра 6. Полный smoke завершён: 537 passed / 79 failed / 23 skipped, exit 1. После исправления окружения пробы и собственной учебной записи точечный повтор дал 12 passed; общий гейт остаётся красным. Полный разбор, ограничения и ссылки: [[Итог]]. Учебная QA1909_STATUS после аудита использует report_column_code=OTHER; предложение №1290 фиксирует противоречие смоука разрешённым пользовательским колонкам.
