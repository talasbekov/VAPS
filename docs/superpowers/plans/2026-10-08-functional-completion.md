# Завершение функций — план выполнения

> **For agentic workers:** Use superpowers:executing-plans для интеграции и проверок; superpowers:dispatching-parallel-agents для трёх независимых реализаций. Все тяжёлые проверки сериализует root.

**Goal:** За три часа завершить подтверждённые недоделки, проверить фактические ролевые процессы и оставить проверенный локальный портал.

**Architecture:** Три изолированных изменения существующих сценариев reports/rating/recon; отдельная копия базы и production frontend. Общие миграции линейны0131→0132group→0133recon. Root проверяет результаты и интеграцию, ведёт исходные доказательства и Obsidian.

**Tech Stack:** Django5.1/PostgreSQL16ICU/Redis/Celery, Next15.5.25, pytest/Playwright, WindowsPowerShell.

**Spec:** [functional-completion](../specs/2026-10-08-functional-completion.md).

## Global Constraints

- Срок05:46–08:46UTC 8октября2026, местное времяAsia/Qyzylorda10:46–13:46.
- Linked worktree codex/requirements-fixes-20261007, исходныйHEADd10aec3c; preserve user changes.
- Основной портал3345/API18345/dbsmart_soak_20261007; manual48/10accounts/18videos сохраняются.
- Отдельный API18349, UI3350/Next3351, dbsmart_complete_20261008, PostgreSQL15345, свои Redis/storage/worker1 безBeat.
- Секреты и артефакты внеGit в %TEMP%/smart-complete-20261008; shareddeps/source/serverDB не удаляются.
- Один тяжёлый backend/build/browser одновременно; без mocks для утверждений о рабочем процессе, без remote/deploy.

## Review Focus

- Scoped/global права и отдельная ответственность старшего на соседних объектах.
- Null/inactive/fired/imported staffing values, пустой набор, большой экспорт, формульный текст.
- Перекрытие статусных интервалов, inclusive dates/current business day, уникальные люди против человеко-дней.
- Изменение состава группы между формой и отправкой, исправления/идемпотентность/атомарный rollback.
- Forged/oversize/missing/tampered private files, завершённый или замороженный этап, сохранность официальных документов.

### Task1: Действующие кадровые отчёты

**Files:** reports/api/views.py, reports/application/personnel_reports.py, reports/tests/integration/test_personnel_reports.py; app/reports/page.tsx, components/reports/personnel-report-cards.tsx, reports-specific in-development config/assertions, e2e/personnel-reports.spec.ts.

**Interfaces:** GET /api/reports/reports/staffing/?division_id&page&page_size&export=xlsx; GET /api/reports/reports/absences/?division_id&date_from&date_to&page&page_size&export=csv. JSON count/results/totals/divisions, current_staffing basis for absences; immutable query for preview/export.

- [x] Написать и выполнить meaningfulRED: functional routes404; reports-red-actual16failed/2passed.
- [x] Реализовать реальные scoped preview/export, canonical absence segmentation и удобные карточки.
- [x] Выполнить новый файл плюс existing test_reports_access/test_data_aggregator: reports-green-final45 PASS.
- [x] Настоящие UI-превью/Excel/CSV: reports-live-bytes2 PASS, содержимое полного экспорта и три persisted штатные строки сверены; обычной учётке403 и экран отказа. Только завершённые labels сняты.
- [x] Проверить diff, review и сохранить отдельный локальный коммит: 5f497a45.

### Task2: Коллективная оценка группы

**Files:** ops/ratings.py, operations/models_rating.py, migrations/0132_group_evaluation_targets.py, ops/tests/test_ops_group_ratings.py; operational-rating types, rating workspace/registry/submitted-card/group-roster и live spec.

**Interfaces:** existing evaluation-workspace/submit/correct/detail/registry; additive group target, immutable group_snapshot/planned evidence, groupRosterToken409; individual aggregates unchanged.

- [x] Написать и выполнить meaningfulRED: opening exact posts0groups vs2, group-rating-red1failed.
- [x] Добавить0132/model/queue/submit/correct/history и UI с обновлением изменившегося состава.
- [x] Focused backend107 PASS после исправления обоих chief-account boundary paths; затем109 functional PASS с autocommit read checks. Отдельные общие транзакционные guards ещё повторяются после исправления RECON.
- [x] Собственный fixture52 на отдельном API: group-browser-live-auth-0701,1 PASS, реальные submit/correct201, snapshots/chain2 и две записи реестра после reload.
- [x] Проверить diff, review и сохранить отдельный локальный коммит: 94374672.

### Task3: Вложения RECON

**Files:** operations/models_recon_material.py/recon_material_storage.py/models.py; migrations/0133_recon_materials.py; ops/recon_materials.py/api/views_recon_materials.py/api/urls.py/audit vocabulary/tests; hooks/use-recon-materials.ts, ReconMaterials.tsx/ReconStage.tsx/e2e/recon-materials.spec.ts.

**Interfaces:** GET+POST /api/ops/security-events/{event}/visit-objects/{visit}/recon-materials/; DELETE /{material}/; GET /{material}/download/. Multipart file+optional checklist item, private generated storage, truthful validation/permission errors.

- [x] Написать и выполнить meaningfulRED actual upload404vs201, recon-materials-red1failed.
- [x] Добавить0133/private storage/lifecycle, exact object authorization и материалы вне disabledfieldset.
- [x] recon-green-final26 PASS: actual bytes, scope/stage/freeze/type/limit/tamper, cascade rollback и official-document isolation.
- [x] recon-browser-live-first-0650,1 PASS: собственный объект, PNG/PDF upload/reload/exact-byte download/removal; реальная другая event.view-only учётка скачивает без mutation controls.
- [x] Проверить diff, review и сохранить отдельный локальный коммит: 71075f20.

### Task4: Удобство, очистка и итоговая интеграция

**Files:** подтверждённые UX-ошибки и собственные regression files; existing Obsidian Journal/Tasks/Autonomous report, guardedTEMPhelpers.

- [x] Создать отдельный ICUclone/volume/API/worker; before-source integrityPASSED48/10accounts/18videos.
- [ ] Закончить администраторский обход и календарную диагностику. Statistics исправлена: настоящий RED1 FAIL/1 PASS → GREEN2 PASS; permission-gated hook, review APPROVED.
- [ ] Инвентаризировать и удалить подтверждённый неиспользуемый кэш/сборки, проверяя exact paths/reparse/process references; protectedrawvideos не трогать.
- [x] Полный PostgreSQL pytest 6228 PASS/1 SKIP/0 FAIL; makemigrations--check и Django check0. Source gate exit0 08:31:08, live cases сохранены. Actual fullmixed625 PASS/16 FAIL/26 SKIP; все16 отказов отдельно повторены успешно после fixture/selector fixes (651e955c), whole suite не повторялся.
- [x] Независимый whole-change review: два group defects, дополнительный unlinked-chief fallback и inherited transaction integration устранены, финальный review APPROVED. Новые результаты общих проверок сохраняются отдельно.
- [x] Предыдущая сборка862 files/19779619bytes сохранена и SHA сверены. Локально additive0132/0133, API/worker restart, source BUILD_ID KG_koJ2NEx7wFXMah-QIp/Next21196. Source-after PASSED48/10accounts/18videos; manifest/page/newAPI200. Отдельные ручные group51/recon52 подготовлены с защитой48/50 и текущего sourceHEAD.
- [x] Отдельная диагностическая копия остановлена; source3345/18345 сохранён. Actual main UI08:42 PASS, source integrity PASSED. Existing Obsidian обновлён с честными ограничениями; код и notes локально. Срок13:46 завершён, закрытие результатов выполнялось после него. Admin9 walk дал1 PASS/8 незавершённых; полный обход не объявлен успешным. Native очистка complete cache709275600bytes отклонена автоматической проверкой, файл сохранён; cleanup-задача остаётся незакрытой.
