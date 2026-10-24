# №1141 / №1169 — независимое spec-review обязательной группы роли

Дата: 10.09.2026. Plane №1169.
Исполнитель: Кодекс Астра 6.

Проверен текущий незакоммиченный diff относительно `510c680a54d487260cb291ac4a8f82c99cdda720` в worktree `/home/erda/.codex/worktrees/36b5/Smart Josparlau`. Scope: `Backend/PersonnelStatus/PersonalRecordFront/app/security-ops/dictionaries/[code]/page.tsx`, `hooks/use-dictionaries.ts` и `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/ops/dictionaries.py`. Уже рассмотренные изменения подтверждения удаления №1166 в той же странице не являются изменениями №1169. Прочитан [[1141-1169-Исправление]]; сопоставлены текущий код, исходная версия сервиса из git show HEAD, API POST/PATCH, DTO и useParticipationCatalog. Применён superpowers:requesting-code-review.

## Verdict

**PASS по статическому соответствию требованиям №1169. Конкретных блокеров спецификации в проверенном diff не найдено.** Проверка не подтверждает runtime-поведение.

## Сопоставление требований

| Требование | Проверенное доказательство |
| --- | --- |
| Обязательная группа EVENT_GROUP_ROLES при create/update | `dictionaries.py::_validated_group` 397–419 нормализует код роли через strip/upper, отклоняет отсутствие/пустоту/пробелы. Оба сервиса вызывают helper до проверки field_errors и до записи: create 440, update 500. Ошибка под ключом groupCode приводит к DomainError VALIDATION_ERROR 400. |
| Только активная EVENT_PARTICIPATION_KINDS, кроме PHYSICAL_SQUAD | GROUP_PARENT содержит ровно связь EVENT_GROUP_ROLES → EVENT_PARTICIPATION_KINDS. Helper 404–408 запрещает PHYSICAL_SQUAD после нормализации, 412–416 требует существование строки с совпадающим dictionary_code/code и is_active=True. Код из другого справочника или неактивный код не удовлетворяет фильтру. |
| Поле доступно и для старого null | Create/edit определяют hasGroup по типу справочника; прежняя edit-проверка entry.groupCode!==null снята. Инициализация groupCode=entry.groupCode??"" даёт пустое поле у старой записи. Edit отправляет groupCode при hasGroup независимо от прежнего значения. Save/Добавить отключены для пустой/пробельной группы роли, рядом есть обязательность и пояснение ограничения. |
| Сохранение POST_REQUIREMENTS | Сверено с git show HEAD: родитель остаётся POST_REQUIREMENT_GROUPS; groupCode необязателен; пустое значение записывается как None; непустое проверяется на существование активной группы. Новая strip/upper-нормализация и запрет PHYSICAL_SQUAD выполняются только для EVENT_GROUP_ROLES. В UI группа POST_REQUIREMENTS остаётся необязательной; edit теперь позволяет заполнить её и у старого null. |
| Поле достигает сервера и сохраняется | API create_entry передаёт data.get("groupCode") сервису; PATCH формирует тот же group_code. create записывает результат helper в OpsDictionaryEntry.objects.create, update записывает entry.group_code до entry.save. После изменения кода роли не теряется условие wants_group. |
| Инвалидируется ops-participation-catalog | `useInvalidateDictionaries` добавляет invalidateQueries с точным ключом ["ops-participation-catalog"]. Этот callback подключён к onSuccess всех четырёх mutation hooks (create/update/set-active/delete). `useParticipationCatalog` использует тот же ключ и связывает активные роли с группами по role.groupCode===kind.code. |

PATCH роли без groupCode теперь отклоняется, в том числе если старая группа заполнена: API передаёт None, helper считает группу обязательной. Это согласуется с заявленным требованием обязательного поля при update; новая UI-форма всегда отправляет groupCode. Для POST_REQUIREMENTS семантика отсутствующего поля остаётся прежней. Изменение не мигрирует старые данные автоматически: оно предоставляет редактирование null и требует валидную группу при сохранении.

## Проверки и ограничения

Выполнены только чтение файлов, git diff/show/rev-parse/numstat и сопоставление веток. Видимый diff сервиса: 30 добавленных / 22 удалённых строки; hook: 1 добавленная строка. Прочитаны обе серверные точки вызова helper до записи и реальные ключи кэша. Код не менялся. Тесты, сборки, серверы, браузер и API-запросы этим reviewer не запускались; данные не создавались и не удалялись. Живую приёмку проводит основная сессия в пределах разрешений заказчика.

Связанные записи: [[1141-1169-Исправление]], [[Передача-1141-Справочники-2026-09-10]].
