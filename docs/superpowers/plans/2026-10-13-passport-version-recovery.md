# Чтение опубликованной версии паспорта

**Goal:** Прямая ссылка ждёт право object.view; отказ чтения повторяется на месте. Версия показывает свой snapshot постов, ошибочный объект скрыт. История/версия/история сохраняют back-отбор реестра.

**Scope:** Version page, её existing object hook enabled, back prop панели ссылок. Retry/401/403/404/mismatch как в действующем паспорте. Cached transient error сохраняет readonly snapshot с предупреждением. Подтверждённая отсутствующая версия не заменяется действующей редакцией. Русская подпись «Только просмотр». Никаких изменений REST, публикации, серверных областей или основного DB.

- [x] Browser RED: held/denied permissions, initial503, navigation context, mismatchedID, cached503; missing-version control и closing401/403/404.
- [x] Bounded page guard/loading/failure/retry, missing cached+failure distinction и контекст ссылок/возврата.
- [x] Target12/production39 PASS, review/typecheck/gate0; настоящий readonly объект2/version1×1440/390/320 без записей/overflow, detail совпал.
- [x] Документы/локальный commit; работа до10:00 продолжается.
