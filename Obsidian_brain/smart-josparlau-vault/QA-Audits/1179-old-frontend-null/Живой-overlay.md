# №1179 — настоящий старый UI + backend overlay

2026-09-11. Исполнитель: Кодекс Астра 6.

## Итог

Практическая совместимость **nullable полей** подтверждена без пересборки: настоящее API и старый готовый frontend показывают импортированных сотрудников. Полная проверка отсутствия HTTP-ошибок **красная** из-за отсутствующего начального справочника ОМ — не из-за null дат. Этот результат не объявляется общим GREEN.

## Границы стенда и действия

Только проект `staffing-portable-1179-test`; портал `http://127.0.0.1:13379`, API `http://127.0.0.1:18379`. Перед записью проверен label backend-контейнера и состав БД: ровно 2 сотрудника, pk 1/2, external_id 42/43, hire_date/birth_date/gender=None. Реальных данных нет.

Создана отдельная случайная QA superuser-учётка. Логин/пароль только в `/tmp/staffing-portable-1179/qa-null-ui-credentials.json`, mode 0600, в отчёты не копировались. Стандартной ADMIN-роли в пустой БД не было; создана отдельная `QA1179_NULL_UI` с wildcard и назначена только тестовой учётке. Сотрудники и их данные не менялись; существующие права/гейты не ослаблялись. Тестовые учётка/роль оставлены для повторного прогона родителя.

Frontend runtime image ID: `sha256:e8ac1c622a6ea359a3acc92e8c4707ba25b4e494d7d6c6c528bb0564fd6b9cd3`, тот же старый lan-frontend:1172-c637e8264c2a. Frontend не менялся и не пересобирался. Общий pytest, installer и importer не запускались/не правились.

## Выполненная проверка

Сценарий [live-overlay.cjs](live-overlay.cjs), вывод [live-overlay.log](live-overlay.log). Настоящий вход через NextAuth credentials callback, настоящая сессия с backend access token. Browser route только ограничивает разрешённые origin; **API mocks отсутствуют**. Токены не сохраняются в отчётах или трассировках.

- PASS real NextAuth credentials login on isolated stack.
- PASS real API: ровно 2 imported employees; core list/detail возвращают hire_date/birth_date/gender=null, service detail hire_date=null; HTTP 200 для обоих сотрудников.
- PASS old UI: service list содержит 2 строки; service profiles обоих показывают «В Службе с —».
- PASS old UI: обе строки employees table показывают дату найма «—»; профиль — рождение/найм «—»; обе карточки — найм «—». gender=null ошибок не вызывает.
- Browser pageerrors: [].
- HTTP failures: [{path: /api/operations/strength-report/, status: 500}].
- Итоговый exit 1: строгое assert отсутствия HTTP failures оставлено включённым.

Промежуточная настройка harness: два сотрудника имеют одинаковое синтетическое ФИО; вместо неоднозначного единственного locator проверяются обе строки, затем открывается первая. Табельный номер не отображается в строке старой таблицы, поэтому не используется как DOM-селектор. Для смены вкладок применено ожидающее toHaveCount, а не мгновенный count; assertions результата сохранены.

## Реальный блокер чистого экрана

`GET /api/operations/strength-report/` даёт 500. Read-only вызов того же view через APIRequestFactory/force_authenticate тестовой учёткой в **этом** backend-контейнере установил причину:

```text
ValueError: справочник типов не содержит 'IN_SERVICE': выводимому «в строю» некуда лечь в расходе
/app/organization_management/apps/operations/api/views.py:2145 in list
/app/organization_management/apps/operations/strength_report.py:439 in compute
/app/organization_management/apps/operations/strength_report.py:127 in from_rows
```

Это отсутствующие начальные данные ОМ в свежей тестовой БД. При наличии сотрудников расчёт требует IN_SERVICE. Статус-справочник мной не изменялся: передано родителю как prerequisite полного живого UI, не как требование пересборки frontend. Эта проверка не доказывает готовность всего installer/overlay.

Скриншоты только синтетических данных: [service profile](live-service-null.png), [employees table](live-employees-table-null.png), [employees profile](live-employees-profile-null.png).

Родителю сообщено об освобождении окна стабильности; контейнеры родителя не останавливались и не пересоздавались.

## Дополнение — подготовка минимального fixture и повтор

2026-09-11. Исполнитель: Кодекс Астра 6. По прямому поручению заказчика исправляется только предусловие изолированной БД staffing-portable-1179-test: одна строка IN_SERVICE в ops_status_types, без глобального сида и изменений приложения. Предыдущий красный вывод сохранён отдельно: [live-overlay-red.log](live-overlay-red.log). Изучена действующая модель в контейнере: code/name/priority/report_column_code обязательны, legacy_code уникален при заполнении; используем канонические В строю/999/IN_SERVICE/in_service. Далее full_clean, транзакционная вставка и тот же неизменённый live-overlay.cjs со строгим assert0HTTPfailures.

### Финальный GREEN после добавления предусловия тестовой БД

2026-09-11. Исполнитель: Кодекс Астра 6.

**Текущий итог: весь тот же live-overlay.cjs прошёл, exit 0; Browser pageerrors: []; HTTP failures: [].** Ранее описанный RED остаётся историческим фактом ([сохранённый красный лог](live-overlay-red.log)); начальный блокер тестовых данных устранён.

Перед записью ещё раз проверены label проекта staffing-portable-1179-test и ровно 2 синтетических external_id 42/43. В одной transaction.atomic создана одна StatusType: code=IN_SERVICE, name=В строю, priority=999, report_column_code=IN_SERVICE, legacy_code=in_service; остальные флаги — defaults действующей модели. Выполнен full_clean(), затем save(force_insert=True). Сравнения полного снимка Employee и остальных StatusType подтвердили отсутствие изменений, количество StatusType увеличилось ровно на 1. Глобальные сиды не запускались, production не затрагивался.

Команда без изменений сценария/assertions:

```text
node /home/erda/Музыка/Obsidian_brain/smart-josparlau-vault/QA-Audits/1179-old-frontend-null/live-overlay.cjs
```

Фактический stdout ([live-overlay.log](live-overlay.log)):

```text
PASS real NextAuth credentials login on isolated stack
PASS real API: 2 imported employees, core nullable facts + service hire_date=null, detail HTTP 200
PASS old UI: real service list has 2 employees; both profiles display В Службе с —
PASS old UI: real employees table/profile/tiles render null dates as —; gender=null tolerated
Browser pageerrors: []
HTTP failures: []
PASS end-to-end: old frontend + actual backend overlay, no mocked responses, no rebuild
```

Это подтверждает практическую совместимость старого готового frontend и backend overlay без rebuild при наличии обязательного справочника. Требование нуля HTTP failures сохранено. Приложение, importer, installer и frontend не менялись. Стенд освобождён для завершения артефакта родителем; контейнеры не останавливались/не пересоздавались. Тестовая учётка и fixture остаются только в изолированной БД.
