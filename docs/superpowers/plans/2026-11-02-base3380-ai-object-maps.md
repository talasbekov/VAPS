# Версия3380 с ИИ-помощником и картой объектов

> Implement the three independent source domains in parallel under superpowers:dispatching-parallel-agents; the coordinator owns branch state, integration, verification, deployment and cleanup. Do not ask for another approval round: the user explicitly requested this rollback and these two additions.

**Goal:** Сделать версию на3380 основной, сохранить её интерфейс/данные и добавить только ИИ-помощника и локальную карту объектов/паспортов, затем убрать безопасно определённые лишние файлы.
**Spec:** Пользователь: «давай откатимся на то что тут http://127.0.0.1:3380/ просто помощник по ии добавим и чтобы карта была в объектах и паспортах и лишние файлы потом почисти». Это заменяет прежнюю задачу фиксации Yandex navbar. Navbar до изменения поручения не редактировался.
**Baseline:** `f1092e93788c3a3dc70acb680b4c422eca64f4a7`, фактически установленные BEe4746c6f/FEb77ca02f, schema operations0147. 616 deployed backend modules побайтово совпадают с Git. UI/behaviour вне двух дополнений остаются baseline.
**Architecture:** Сохранить merged10576013 отдельной backup-веткой; в текущем уже изолированном linked worktree создать новую рабочую ветку и восстановить только PersonnelStatus из f109, не трогая AGENTS/vault. Перенести точный dependency-closed AI code с10576013, сохранить baseline shell/theme/roles/routes. Карта использует существующий офлайн Astana canvas, nullable координаты каталога и immutable snapshots новых версий паспорта. Подготовить/проверить additive schema на отдельной копии, затем guarded update именно3380 с прежними volumes/env/accounts. Cleanup только после успешного обновления и проверки.
**Tech Stack:** Existing Next/React/Tailwind, Django/PostgreSQL/Redis/Celery, local Ollama qwen2.5:7b, existing local map JSON. No online map/model downloads or frontend dependency changes.

## Global constraints

- Основной адрес —3380, canonical launcher остаётся `tools/start-reviewed-stack.ps1`. Версия38130 пока сохраняется как rollback source; её данные уже отдельно сохранены, не переносить её schema155 поверх3380.
- Сохранить существующие employees/events, null dates/import identifiers, роли/права/пароли, DB/media/private volumes, конфигурацию/секреты3380. Не запускать seed/reset, не заменять рабочую БД дампом ноутбука.
- Fresh private backups: `.local-review/base3380-ai-map-20261102/backups/primary3380` (138 tables;8952media/5private/177static) и `previous-merged-preview` (DB+data+runtime). Конфигурация3380 скопирована в `installed-config-before`. Все приватные данные/ключи здесь имеют user/SYSTEM ACL и исключаются из Git/cleanup.
- Все исходные миграции baseline0001–0147 остаются byte-identical. Новые schema-only migrations:0148_object_map_locations (map domain),0149_local_ai_assistant (AI domain, depends0148). Не переносить R7/Yandex0152/inspection/combat chains. Ни RunPython, ни role seed/grant не нужны.
- Исходные смешанные Yandex/R7 commits сохраняются в backup-ветке. Не переписывать историю/force push, не публиковать без отдельного поручения.
- Исходники сборки/тесты только во внешней `.build/base3380-ai-map-20261102`; существующий shared node_modules junction не переустанавливать и не удалять.
- Mutating acceptance только на новом synthetic/copy stand. Live3380 сначала read-only; применяются только заранее проверенные schema/image changes с rollback/backup и проверкой прежних строк/файлов.

## Review focus

- Исходный shell/ThemeProvider/ThemeToggle/sidebar/старые маршруты и права не получают Yandex styles, AmbientBackground, новый duty UI или отдельный daily-expense route.
- ИИ: актуальная authority, signed chat context/scoped reads, queued OM dialogue, explicit confirmation/idempotency. Сохранить локальный Ollama env и90s frontend proxy для55s model request; не отправлять live records в модель.
- Карты: отсутствие координат остаётся null, нет guessed markers, отделить object IDs от visit IDs. Read-only registry/history; запись только object.manage и только после Save. Out-of-coverage click не превращается в сохранённую точку молча.
- Passport publish snapshots координаты и sectors из fresh locked row. Старые опубликованные версии/документы/цветовые состояния не меняются и не получают координаты из текущего объекта.
- Cleanup: сначала инвентаризация/проверка абсолютных путей, junctions, процессов и mounts; не трогать current source/build, Git store/shared deps, backup/private/vault/user files, действующие volumes и ранее запрещённые4assignment paths. Никакого global docker prune.

## Source ownership and contract

1. Map backend owns models_object.py, ops/object_locations.py, ops/passport.py, ops/api/views.py, serializers.py, operations/audit_service.py and focused backend map tests; migration0148. DTO: `location: {latitude:number,longitude:number} | null` on object and passport version. `PATCH /api/ops/objects/{id}/location/` payload `{location: point|null}`, full object response, permission object.manage. Nullable paired latitude/longitude fields and paired snapshot fields, WGS84 DB constraints; historical rows remain null.
2. Map frontend owns entities/security-object, object-map feature, use-security-objects mutation, objects registry/card, PassportVersionSnapshot, mocks and focused map tests. Existing OfflineAstanaMap/asset files and all shell/provider/assistant files remain outside its ownership. Registry follows existing filters/back links; card owns Save/Cancel/Clear; published map read-only.
3. AI owns assistant package/view/model/connection, models.py assistant imports, operations/tasks.py, optional key settings and split requirements; migration0149. Frontend owns assistant-dock, om-assistant, minimal providers/header/dashboard/assistant-access/next config changes. Exact starting paths `.build/base3380-ai-map-20261102/assistant-proposed-paths.json`. No central services, permission hooks or aggregate urls.py copy. Do not edit map-owned audit_service.py; map owner may add assistant_connection entity for retained helper compatibility if needed.
4. Coordinator owns scripts/gate-front.mjs, migration policy/deployment tooling, manifests/docs, Git/index/commits, external harnesses, exact image builds, tests/backup/rehearsal/cutover and cleanup. Agents never access real private data/credentials/Docker or commit/stage.

## Work

- [x] Зафиксировать точную baseline3380, сохранить backup данных/файлов/конфигурации обеих версий и текущий Git/status.
- [x] Создать backup/new branch, восстановить baseline app source и сохранить старую работу/notes.
- [x] Добавить AI-only backport с локальной моделью и исходным оформлением.
- [x] Добавить nullable карту объектов/паспортов с защищённой записью и snapshots.
- [x] Объединить source, проверить diff к f109 на отсутствие несвязанных изменений; baseline migrations byte-identical.
- [x] Собрать точные Linux images; frontend gate/types/build, backend checks/tests и graph, synthetic real browsers (AI+maps+roles/mobile/theme).
- [x] Restore/migrate rehearsal копии138-table3380 с fingerprint/rows/files proofs; проверить package policy и rollback.
- [x] Guarded update3380 с прежними volume/env/session/accounts, verify real-data read-only UI/Ollama/maps/source metadata/canonical launcher.
- [x] Инвентаризировать и удалить только доказанно лишние временные files/ретированную preview инфраструктуру, сохранить данные/backup/Git/deps; записать reclaimed bytes.
- [x] Обновить журнал/передачу/launcher receipts и дать рабочий адрес/результат/ограничения.

## Integration verification and runtime correction

- Source baseline restored as74ec32b9; old10576013 is retained in backup/yandex-before-base3380-20261102.
- Complete isolated backend run:8058passed/1skip (no supplied anonymised document samples). Four integration failures identified missing admin registrations and two audit labels. All538 admin/registry/privacy tests and4 audit-label tests passed after the specific corrections; no assertions were weakened.
- Full Linux frontend gate/types/production build passed before those two literal audit labels; final images rebuild those reviewed corrections.31 map tests and175 assistant tests passed; synthetic map browser12/12 passed.
- Actual synthetic production-image assistant/Celery lifecycle passed:18 durable user messages, explicit retry after transport failure, explicit creation, confirmation and duplicate-free replay. Business APIs were real; only model HTTP transport was synthetic. No live-data writes were used for acceptance.
- Fresh migration rehearsal of the exact3380 backup passed:138→140 public tables; every original column/row and business sequence preserved. Added location columns remain null, task.processing defaults to empty JSON; no role/data seeding.
- Direct runtime inspection corrected an earlier assumption: installed3380 API has local Ollama configured, but its original pre-queue worker was disabled and internal-only. The new queued interpreter needs the API's same three local Ollama values and existing ingress/DNS settings. The guarded updater changes only that worker override while retaining all secrets, ports, services and data volumes. Database/Redis network configuration stays unchanged.
- Final canonical3380 cutover, browser/local-model validation and cleanup remain pending at this source checkpoint. Private rollback backups and all original user notes are retained.

## Completion

Canonical3380 update completed with the reviewed transactional updater, a fresh paused backup and another isolated restore/migration rehearsal. Both additions committed together; old138-table projections and all business sequences survived migration, startup and final browser verification. All8952media/5private/177static files match byte-for-byte. Original database/Redis container identities, all data volumes, passwords and session/encryption secrets remain unchanged.

Eight live read-only browser checks passed at1440/390: workspace, assistant, registry map and an existing passport; no external requests, business writes, API or page errors. Actual local Ollama/qwen2.5:7b answered independently from API and worker using synthetic input only. The canonical launcher passed validation and an actual start; all six services remained healthy.

Cleanup completed: eight obsolete Yandex generated folders removed (4,152,104,041 file bytes;17,148 files). Five shared-dependency junctions were unlinked without traversing targets. Twelve owned preview/test containers and five owned networks retired; no real data volumes removed. Current source/build, private backups, shared Git/dependencies and earlier user notes preserved. The small colleague comparison Git repository is preserved privately after connectivity verification. Old38130 is retired; use3380.
