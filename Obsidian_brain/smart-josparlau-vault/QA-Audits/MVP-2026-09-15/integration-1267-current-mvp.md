# №1267 — интеграция актуального MVP: передача дополнительного QA, 18.09.2026

Исполнитель: Кодекс Астра 6.

## Код и исходные базы
Локальная ветка `codex/mvp-current-integration-1267`, worktree `/home/erda/.codex/worktrees/6190/Smart Josparlau`.
Merge `1c3c8050bf124b25dfa1b67723aa5efa123d6314`, родители `0f64bac2109ec432cee5c5ea53e755de64751d99` и `90277694238eddce63ecb2eb8f1bb87bd14d654d`. Git ancestry подтвердил обе базы, revert9120d164, поиск9b0e6d74, рольc551ec6a. Никаких cherry-pick, main или чужих деревьев не меняли, push не выполняли. №1267 остаётся In Progress.
Конфликты разрешены объединением testMatch144 и сохранением двух API-проверок с актуальным strength-report route. Reviewer: новых регрессий интеграции не найдено. Tracked diff и index diff пусты, unmerged нет. Untracked `.next-qa1267/` — намеренно оставленная работающая сборка, в git не включена; автоматическое добавление include вtsconfig восстановлено точечно.

## Дополнительный стенд — актуальный код
Frontend `http://127.0.0.1:3110`, PID780290, BUILD_ID `EWYHGoZzODbHNp8II8cHY`, dist `Backend/PersonnelStatus/PersonalRecordFront/.next-qa1267`, cwd standalone внутри него.
Backend `http://127.0.0.1:8110`, PID775703, cwd Personnel-Records этойworktree, существующий основнойvenv, local_postgres settings. Запуск обоих detached/Popen start_new_session/stdinDEVNULL, постоянные логи в [[QA-Audits/MVP-2026-09-15/1267-integration-evidence]]. Все21 HTTP rewrite в routes-manifest ведут в127.0.0.1:8110, подтверждено assertion. Независимые повторныеhostGET:3110 HTTP200,8110/schema HTTP200. ПоследнийRSS: frontend152260КБ,backend140928КБ.
Старый frontend498246(:3108)/backend499543(:8100) НЕ остановлен и НЕ изменён, остаётся на старойбазе90277694. Их RSS185480/172616КБ. Для продолжения актуальногоUI использовать ИМЕННО3110/8110;3108 больше не доказательство текущегоMVP.

## Проверки
- `npm run gate:front`: exit0, TypeScript+встроенные проверки+production build; исходный контрольный `.next-build` BUILD_ID Ax2hTp5GGTLJWlSTmIpZG. Для дополнительногостенда выполнена отдельнаяproduction build сBACKEND_URL8110, exit0.
- Read-only `showmigrations operations`:0123–0126 уже[X]; `migrate --plan`:No planned migration operations,exit0. Миграции/backup не выполнялись, необходимости нет.
-63изменённыхPythonфайла:AST PASS. Smoke discovery:639тестов/144файла, не полныйпрогон.
- ЦелевыеNodePlaywright/systemChrome:10passed за6.6s,exit0. Три parsing/contract проверки справочников; mock читательсправочника; триread-only сценария1223(дежурному сводоткрыт,ответственному закрыт,руководстводепартамента); двапрофиля434; реальныйreaderпаспорт1276. Конфиг /tmp/qa1267-targets.config.cjs, globalSetup/globalTeardown отсутствуют,SMOKE_PRESERVE_DATA=1. Подменаpermissions только в отдельнойmock dictionary пробе; прочие роли реальные.
- Дополнительныйread-only helper:1247 API поискдвумясловами и обратнымпорядкомPASS; UI старшегонаряда показываетполноеимяPASS, формаНЕотправлялась; навигациясправочник→охраняемыелицаPASS. Django adminсписки opsprotectedperson/opsdictionaryentry/opsratingdynamicspoint/opsratingidempotencyrecord/opspolicysectionversion PASS. Первыйhelper завершилсяexit1 из-за неверного ИЗОБРЕТЁННОГО проверкой URL opswatermarksettings(404); фактическаямодель OpsWatermark прочитанаизкода, повтор ТОЛЬКО /admin/operations/opswatermark/ PASS,exit0. Это ошибкаhelper, не дефектпродукта. Логи readonly-ui.log иreadonly-admin-watermark.log сохраняютобаступеня. Browsercontexts закрыты; несохранённыхформ/активныхhelper нет.
- БезБД service-summary-access:1PASS. smoke-preserve-data:3FAIL, Uncontrolled teardown dependency:./purge-python; файлыидентичны обоимродителям, причинаbaseline. Родитель оформил №1284,UUID46050a95-27fb-45d7-902c-b376b80df2e7, не исправлять подинтеграцией/1282.

## Блокер полного backend gate
Auto-review дважды запретила TERM только проверенного499543 и запуск apps pytest. Первыйвариант также сохранялenvironment; он полностьюотклонён. Второй исключалsnapshot иявноиспользовалtest settings, отдельнуюcheckout-specific testDB иштатныйlock; reviewer вновь назвал разрешение изродительскогоthread untrusted и недостаточным дляserviceinterruption/database sideeffects. Обекоманды НЕ выполнялись. Прямойasyncвопрос пользователю здесь задан, ответ пока не получен. Не обходитьотказ: полныйbackendgate не запускался, старые5711/17 кэтомуMVP не относятся. Добавочные3110/8110 отдельноодобрены как менее рискованнаяальтернатива; это не снимаетbackendблокер.

## Передача родителю
Дополнительныйruntime свободен для точечныхповторов1270/1271/1272/1273 по3110/8110; всеcontexts этойзадачи закрыты. ОбщаяБД таже, бизнесданные/права/учебныйОМ9848 не изменялись; seed/reset/flush невызывались. Полный620/639smoke не гонялся. Для1271 актуальные поиск/сборсил/роль; для1270 повтор только затронутогорасхода и причиннойцепочки. Статусы On test/Done не менялись, push по-прежнему требуетответа пользователя оgithub.com/talasbekov/VAPS. Завершениемполногоаудита этотhandoff неявляется.
