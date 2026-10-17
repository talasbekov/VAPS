# Повтор выбора объектов и завершение старого добавления

**Goal:** Ошибка каталога не заставляет закрывать выбор объектов; позднее добавление из закрытого окна не закрывает новый выбор.

**Design:** Использовать inline LoadFailure/retry с сохранением поиска/галочек при временном отказе. Новая отправка ждёт подтверждённый каталог, список401/403/404 скрывает старые значения до фактического успешного чтения, включая retry503/remount; Query identity и AbortSignal защищают поздние отменённые ответы. Async batch сохраняет snapshot ID мероприятия/выбора и контекста открытия; invalidation подтверждённых изменений разрешена, локальные callbacks/toast нового окна защищены mounted/context. Открытое окно закрывается при потере уже существующей capability mayManageVisitObjects; её смысл и server payload не меняются. Последовательное добавление и частичный успех сохраняются; исходные добавленные строки не повторяются. Закрытие окна не отменяет уже запущенный batch.

- [x] Browser RED: отсутствие повторного чтения и поздний callback закрывает новую форму.
- [x] Минимальные catalogue/mutation/parent guards без смены правил capability.
- [x] Проверить cached/initial recovery, pending snapshot, success/partial retry, close/reopen/permission/late response.
- [x] Review/typecheck/gate, production affected checks и настоящий readonly mobile каталог.
- [x] Журнал/задачи и локальный commit; работа до10:00 продолжается.
