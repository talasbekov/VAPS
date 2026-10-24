# №1141 / №1166 — независимое spec-review подтверждения удаления

Дата: 10.09.2026. Plane №1166: `a4cd08b2-16b3-4fa7-88af-e8dd14436515`.
Исполнитель: Кодекс Астра 6.

Проверен реальный незакоммиченный diff относительно `510c680a54d487260cb291ac4a8f82c99cdda720` в worktree `/home/erda/.codex/worktrees/36b5/Smart Josparlau`. Область: только `Backend/PersonnelStatus/PersonalRecordFront/app/security-ops/dictionaries/[code]/page.tsx` и `personnel/[kind]/page.tsx` внутри того же каталога dictionaries. Соседняя правка bootstrap исключена из оценки. Прочитаны AGENTS.md, superpowers:requesting-code-review, индекс vault, состояние и известные дефекты Frontend, [[1141-1166-Исправление]], реальные хуки удаления, обработчик API-ошибок, Button и серверные guard-пути.

## Verdict

**PASS по статическому соответствию требованиям №1166. Нарушений спецификации в проверенном diff не найдено.** Это не подтверждение runtime-проверки и не разрешение перевода карточки в Done.

## Факты соответствия

| Требование | Доказательство |
| --- | --- |
| Исходная «Удалить» только открывает подтверждение | В generic строках 442–446 и personnel 329–333 кнопка является AlertDialog.Trigger, собственного вызова mutation у неё нет. Единственный новый путь запроса — confirmDelete, вызываемый отдельной кнопкой подтверждения. |
| В подтверждении указано конкретное значение | Generic 458–460 выводит `entry.label` и `entry.code`; personnel 345–347 выводит `row.name` и `row.code`. Замыкание onDelete связано с id той же карточки. |
| Начальный фокус на «Отмена» | В каждом Content есть AlertDialog.Cancel asChild с кнопкой «Отмена» (generic 466, personnel 353). Для независимой проверки прочитан установленный Radix в основном checkout: `@radix-ui/react-alert-dialog/dist/index.js`, 123–125 вызывает `cancelRef.current?.focus({ preventScroll: true })`, 169–171 привязывает ref к Cancel. Button прокидывает props/ref на DOM button. В текущей worktree node_modules отсутствует; установка не выполнялась. |
| Отмена / закрытие без запроса | onOpenChange меняет только UI-state, Cancel не вызывает onDelete; Escape до запроса закрывает диалог штатным механизмом. Внешний клик предотвращается AlertDialog (исходник пакета 127–128). Во время запроса закрытие запрещено через ref/pending и preventDefault на Escape. |
| Отдельное подтверждение, pending, защита повторного запроса | Generic 284–295 / personnel 227–238 синхронно ставят `deleteInFlight.current = true` до await и отсекают повторный вход. `isDeleting = remove.isPending` передаётся из общей mutation и отключает кнопки удаления, подтверждения и отмены; подпись меняется на «Удаление…». preventDefault на Action оставляет управление закрытием у async-обработчика. |
| Серверные ошибки остаются видимыми | catch выводит Error.message в локальном `role=alert`, при отказе `setDeleteOpen(false)` не выполняется. Общий вывод mutation.error сохранён. OpsApiError наследуется от Error; parser сохраняет message конверта и строку DRF detail. |
| Проверка серверного использования не обходится | Хуки по-прежнему вызывают `opsApiClient.del` существующих `dictionaryEntryPath(entryId)` / `staffDictionaryRowPath(kind,id)`. Параметров force/override нет. `ops/dictionaries.py::delete_entry` (572+) сохраняет lock, запрет неизвестных связей (422) и ненулевого usage (409). `dictionaries/api/views.py::_StaffDictionaryViewSet.destroy` (59+) сохраняет usage count и ProtectedError. |

## Граница проверки

Выполнены только чтение файлов, git diff/status/rev-parse и сопоставление цепочек вызова. Тесты, tsc, сборка, серверы, браузер и запросы удаления не запускались; код не менялся. Поведение фокуса и запросов в живом UI этим review не наблюдалось. Видимое доказательство чтения: diff двух экранов содержит обе пары Trigger/Cancel/Action, ref guard и catch; вывод Radix содержит focus Cancel и предотвращение outside interaction; вывод backend содержит usage guard до удаления. Финальная проверка интерфейса относится к основной сессии в рамках её разрешений.

Связанные записи: [[1141-1166-Исправление]], [[Передача-1141-Справочники-2026-09-10]].
