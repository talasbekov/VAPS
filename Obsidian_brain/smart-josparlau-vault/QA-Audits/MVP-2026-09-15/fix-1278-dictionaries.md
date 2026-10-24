
## 2026-09-17 — Plane №1278: начало исправления справочников
Исполнитель: Кодекс Астра 6.

Новое прямое поручение: исправить справочники в вебке и Django admin, включая ОЛ, общие значения, должности и звания; №1275 включена без дублирования. №1278 переведена In Progress. Сессия 01a0af0e-50b2-7e20-a401-8c41e5376f5f.

План в рамках одной разрешённой задачи: воспроизвести UI и проверить runtime; установить причину и читателей контрактов; написать красную регрессию и минимальную согласованную правку; выполнить связанные pytest, frontend gate, живую проверку create/edit/reload/picker и запрета неадмину; коммит/пуш, проверенная сборка на стенде, затем Review. Статусы не открывать для произвольного редактирования. Настоящие данные и учётки не менять.

Начальная проверка: worktree чистый, HEAD detached; создание ветки требует записи в общий .git вне sandbox. В кадровой форме обнаружен вывод только failure.message — гипотеза потери полевых ошибок, пока не подтверждённая UI.

### 2026-09-17 — №1278: воспроизведение и граница правки
Исполнитель: Кодекс Астра 6.
Порты 8100/3108 восстановлены: Django local_postgres из ветки, QA-сборка .next-mvp-20260916 без пересборки. В UI должностей пустое Добавить → HTTP 400 Bad Request. Django admin /admin/operations/opsprotectedperson/add/ доступен администратору; регистрация исправна, ОЛ расположен в группе сотрудников, не справочников. Каталог вебки не содержит create/edit, PATCH API отсутствует.
Красные регрессии: pytest test_dictionary_person_edit.py — 3 failed (403 create для dictionary.manage, 404 PATCH); dictionary-errors.spec.ts — 1 failed (OpsApiError вместо OpsValidationError). Runserver остановлен перед pytest.
Решение: добавить PATCH под dictionary.manage, разрешить этому же праву создание (старые права создания сохранить); добавить форму каталога и вход из справочников; поместить существующий admin ОЛ в группу справочников. Поле code/server-owned неизменяемо. Общий парсер сохраняет DRF ошибки только HTTP400, остальные ответы без изменения. Кадровые формы показывают inline ошибки, не теряют ввод и не подавляют 0 уровня.
UI-UX: error summary validation — подтверждены inline aria-describedby и role=alert. Эталонные компоненты сохраняются. Читатели существующего формата ОЛ (ГВО/picker/бюллетень/каталог) сохраняют контракт; после PATCH инвалидируются каталог и сводки. Кадровые readers: штатка/сотрудники, invalidate positions/ranks вместе с редактором.
Найденные читатели:
- Backend/PersonnelStatus/PersonalRecordFront/lib/ops-api.ts
- Backend/PersonnelStatus/PersonalRecordFront/lib/ops-errors.ts
- Backend/PersonnelStatus/PersonalRecordFront/hooks/use-protected-persons.ts
- Backend/PersonnelStatus/PersonalRecordFront/hooks/use-positions.ts
- Backend/PersonnelStatus/PersonalRecordFront/hooks/use-ranks.ts
- Backend/PersonnelStatus/PersonalRecordFront/features/service-employees/ui/EmployeeAdminDialog.tsx
- Backend/PersonnelStatus/PersonalRecordFront/features/create-security-event/ui/CreateSecurityEventDialog.tsx
- Backend/PersonnelStatus/PersonalRecordFront/features/gvo-section-edit/ui/ProtectedPersonPickDialog.tsx
- Backend/PersonnelStatus/PersonalRecordFront/features/create-security-event/ui/EditBulletinDialog.tsx
- Backend/PersonnelStatus/PersonalRecordFront/app/security-ops/persons/page.tsx
- Backend/PersonnelStatus/PersonalRecordFront/features/employee-status-update/ui/EditStatusDialog.tsx

### 2026-09-17 — №1278: реализация и промежуточные проверки
Исполнитель: Кодекс Астра 6.
Добавлен PATCH ОЛ под dictionary.manage, model validation/server-owned guard, транзакция+аудит. Каталог использует существующую форму ГВО для create/edit, вход ОЛ есть из справочников. Django admin регистрация существующая, изменена группа на Справочники. Кадровые формы получают DRF inline ошибки, сохраняют введённое при отказе, 0 уровня не заменяется старым; invalidate также positions/ranks.
Красная регрессия rename подтвердила потерю связи при сравнении по имени; теперь ID-first, fallback только для legacy без personId. Тесты: backend 3 passed (9.87s), frontend 2 passed (465ms). Первый frontend gate прошёл; после финальных правок будет повтор. Полные ops/operations/dictionaries pytest запущены через lock, backend пока остановлен. Ограниченный reviewer проверяет diff.

### 2026-09-17 — №1278: проверка исходных падений
Исполнитель: Кодекс Астра 6.
Первый полный backend прогон остановлен для диагностики после 1309 passed,18 failed,1 error (174.07s). На чистом HEAD во временной копии повторены четыре файла: allocation_due_at, force_collection_objects, forces_send, evaluation_withdrawn_backfill — ТОЧНО те же 18 failed,10 passed,1 error (14.14s). Это не регрессии справочников; вне scope, код этих процессов не менялся. Запущен полный повтор без прерывания, итог ещё ожидается. Финальный frontend gate завершился успешно. Ревью: подтверждённые подпись кнопки и скрытый отказ загрузки фото исправлены; гипотеза о full_clean/code отозвана проверкой Django, лишняя правка убрана.

### 2026-09-17 — №1278: полный итог и подтверждённая граница
Исполнитель: Кодекс Астра 6.
Полный backend: 30 failed,5103 passed,1 error,9 warnings за440.66s. Из них 29 failed+1 error доказанно предсуществуют:18+1 на четырёх исходных файлах (14.14s), ещё11 failed/336 passed на исходных admin_registry/error_codes_coverage (9.70s). Своя регрессия audit_coverage вызвана новым событием: добавлен реальный вызов update_person в сквозную пробу; целевой повтор далее. Полный повтор больше не запускается по указанию оркестратора; сбор сил/старые административные пины вне scope. Review запрещён, задача останется In Progress с честным блокером гейта, но исправление публикуется и проверяется руками.
Общие справочники: красная браузерная проба читателя подтверждена (Добавить присутствует без dictionary.manage), кнопки мутаций ограничены. На свежей сборке4 regressions passed1.9s; frontend gate PASS. Build ID AcQpQ5HvvdlrGPlBY1oeF, PID91511, http://localhost:3108, worktree .next-build, старая QA-сборка сохранена. Логи лежат рядом в1278-evidence.

### 2026-09-17 — №1278: контроль оркестратора перед публикацией
Исполнитель: Кодекс Астра 6.
Прочитан текущий diff API/service/admin grouping и веб-форм ОЛ. git diff --check вернул 0. Проверены сохранённые логи: фронтовые целевые пробы 9 passed/2 skipped (скипы не считаются проверками), полный backend 5103 passed/30 failed/1 error, исходный дополнительный контроль 11 failed/336 passed. Исполнитель задачи завершает ручные проверки связанных списков и ограниченной учётки. Публикация и итоговая проверка ещё ожидаются; зелёный полный гейт не заявляется.

### 2026-09-17 — №1278: ручные формы и финальные целевые проверки
Исполнитель: Кодекс Астра 6.
132 passed12.39s: ОЛ/create/edit/невалидный JSON/legacy code/запрет читателю, GVO API+catalog refs, общие dictionaries API, приложение dictionaries, audit_coverage целиком. Сквозной аудит исправлен реальным вызовом нового события.
Ручной Playwright Chrome (по действиям с наблюдением):
- Должности: web create QA1278_POS_WEB id22; web edit с level0 сохранился; Django видит, редактирует ту же строку; Django create QA1278_POS_ADMIN id23.
- Звания: web create QA1278_RANK_WEB id18 и edit; Django видит/редактирует; Django create QA1278_RANK_ADMIN id19.
- Пустые формы должности/звания теперь дают summary+inline серверные ошибки name/code, а неHTTP400. Серверный текст обязательности приходит по-английски; название поля и общий текст русские.
- ОЛ: web create OL-22, edit имени/позывного сохраняет id/code; Django видит и редактирует; Django create OL-23. Reload каталога показывает обе записи. Пустое ФИО → Обязательное поле.
- Общие RETURN_REASONS: web create/edit QA1278_WEB id70; Django видит/редактирует; Django create QA1278_ADMIN id71; reload вебки подтверждает. Учебная Django запись активирована через вебку. Причины возврата хранятся в связанном процессе свободным текстом (UI прямо сообщает), picker этого справочника в коде отсутствует.
- Связанные формы: picker бюллетеня показывает OL22/23; OL22 выбран, имя дошло до предпросмотра. Кадровые selects показывают должности22/23 и звания18/19 с именами после Django. Все формы закрыты без создания сотрудников/мероприятий.
- Реальная role_ops_reader: каталог ОЛ и общий справочник → Доступ закрыт; вход Django admin отклонён как не-staff. Аккаунты/права/пароли не менялись.
- Скриншоты persons/picker сохранены и визуально просмотрены. Текущая сборка AcQpQ5HvvdlrGPlBY1oeF. Backend восстановлен на финальном коде. Целевой read-only живой smoke выполняется, teardown удаления отключён.

## 2026-09-17 — №1278: опубликованный результат
Исполнитель: Кодекс Астра 6.

Коммит `67b5ad4974cc6731e5810c0e7055cb757a114d9a`, ветка `codex/1278-dictionaries` запушена в origin; `git status -sb` чистый и без ahead/behind. Код изменения справочников опубликован.

Проверки финальной правки: frontend gate exit0;132 backend passed12.39s;10 целевых browser/read-only smoke passed7.9s,0 skipped. Ручные create/edit/reload/web↔Django и связанные pickers подтверждены выше. №1275 подтверждённо исправлена тем же коммитом, комментарий в карточке оставлен; её Backlog не менялся.

Граница: полный backend перед финальной правкой теста покрытия аудита дал5103 passed,30 failed,1 error; audit_coverage затем зелёный в132целевых. Оставшиеся29 failed+1 error точно совпадают с baseline на исходном HEAD. Полный smoke/обход всего портала в эту узкую приёмку не включались; выполнен целевой read-only smoke. Нет заявления общего PASS. №1278 остаётся In Progress, не Review/On test/Done; блокер — предсуществующий общий гейт вне разрешённого scope.

Стенд оставлен на исправленном коде: frontend PID91511, RSS180272KB, BUILD_ID`AcQpQ5HvvdlrGPlBY1oeF`, DIST`/home/erda/.codex/worktrees/99eb/Smart Josparlau/Backend/PersonnelStatus/PersonalRecordFront/.next-build`; http://localhost:3108/security-ops/dictionaries/ и /security-ops/persons/. Backend PID100820, http://localhost:8100/admin/, исходники этой ветки. Проверка URL: frontend200/admin302(вход). Старая .next-mvp-20260916 сохранена, общий .next не менялся. Учебные записи1278 оставлены для проверки, реальное содержимое/учётки/права/пароли не менялись, удаления не выполнялись.

Plane пересобран с пагинацией:1268карточек; №1278In Progress, №1275Backlog. В №1278 записаны два абзаца было/стало, SHA, проверки и блокер; в №1275 — воспроизведение и исправление. Другие группы не запускались, очередь разработки этим поручением не продолжалась.

### 2026-09-17 — №1278: финальное подтверждение оркестратора
Исполнитель: Кодекс Астра 6.
Проверены git HEAD и origin/codex/1278-dictionaries: одинаковый SHA 67b5ad4974cc6731e5810c0e7055cb757a114d9a; porcelain пуст, git show --check exit0. Веб http://localhost:3108/ и Django /admin/login/ ответили 200. Прочитан опубликованный итог с ручными сценариями, границей покрытия и состоянием Plane. Исправление доступно на стенде; полная приёмка ограничена существующим красным общим гейтом. Общая MVP-очередь остаётся приостановленной согласно последнему поручению заказчика.


## 2026-09-18 — продолжение №1278: сверка блокеров
Исполнитель: Кодекс Астра 6.

После команды «продолжай» выполнена сверка: git status чистый, HEAD 67b5ad49, ветка синхронна с локальным origin/codex/1278-dictionaries. Прочитана актуальная карточка №1278: scope по-прежнему ограничен справочниками, новых комментариев заказчика нет. Повторные тесты и изменения кода не выполнялись.

Все группы оставшихся ошибок уже заведены: №1204 — 18 падений сбора сил; №1206 — 10 несовпадений реестра admin; №1207 — необъявленный FIXTURE_DATE_RANGE_EXHAUSTED (карточка содержит также отдельный API-дефект); №1205 и №1216 — дубли миграционной пробы с IrreversibleError в operations.0120. Все перечисленные карточки сейчас в «Предложено Claude», не разрешены прежним узким scope. Дубли не создавались, статусы не менялись.

Сохранённые baseline-логи подтверждают: сбор сил получает 422 уже на notify, затем ALLOCATION_NOT_SUBMITTABLE на submit; миграционный тест пытается откатить необратимую 0120; старый admin-тест требует регистрации всех моделей. Это основания для дальнейшей диагностики, не утверждение о необходимых исправлениях. Отправлено уточнение смысла команды: блокеры гейта, общая очередь MVP или только справочники. До уточнения выполнена только диагностика без расширения scope.
