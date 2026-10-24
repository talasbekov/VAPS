---
name: project-new-stack-removed
description: "12.08.2026 vite-SPA frontend/ и бэк Backend/VAPS выведены из репо — работаем только на Personnel-Records + PersonalRecordFront"
metadata:
  node_type: memory
  type: project
---

**Решение Bratan 12.08.2026: параллельная ветка разработки закрыта.** Коммит
`c3fdc293` удалил `frontend/` (vite-SPA, 474 файла, 116k строк) и
`Backend/VAPS` (476 файлов, 66k строк). Это отменяет прежнее G1 «строить на
Backend/VAPS» — соответствующий пункт в [[project-vaps-architecture]] больше
не действует.

**Рабочий стек — только `Backend/PersonnelStatus/`:**
- `Personnel-Records` — Django, стенд `:8100`,
  `DJANGO_SETTINGS_MODULE=organization_management.config.settings.local_postgres`;
- `PersonalRecordFront` — Next, стенд `:3106`, ВКЛЮЧАЯ раздел ОМ
  `/security-ops/*` (он был явно сохранён при выводе — это живой раздел старого
  фронта, а не встройка SPA).
Оба поднимаются через `.claude/launch.json` (`personnel-django`,
`personalrecord-next-local`); запись `vaps-spa-live` удалена вместе с фронтом.

Что решило вопрос безопасности сноса (проверено ДО удаления): Personnel-Records
упоминает `Backend/VAPS` только в докстрингах-провенансах портированных модулей
(`clock.py`, `services.py`, `day_submission_service.py` и др.), импортов нет;
`ci.yml` собирает исключительно Personnel-Records.

**Откат** — `git revert c3fdc293`: всё отслеживаемое в истории. Неотслеживаемое
(`.venv`, `node_modules`, кеши, ~690 МБ) стёрто безвозвратно, но регенерируется.

⚠️ `graphify-out/` построен по удалённому `Backend/VAPS` — до первого
`graphify update .` он описывает несуществующий код (отмечено в CLAUDE.md).

**Что похоронено вместе с фронтом** (искать в истории до `c3fdc293`):
смоук-обход портала `frontend/e2e/smoke-buttons.spec.ts` + `playwright.smoke.
config.ts` + `scripts/smoke-report.mjs` (коммит `1a8c34e7`) и его находки в
`docs/smoke-frontend-summary.md` — в частности дефект «фронт гейтит разделы
кодами `ops.*`, которых у бэка нет» (под `admin` c правом `*` невидим). Если
похожий обход понадобится для PersonalRecordFront — механику брать оттуда, а не
писать заново: там уже закрыты ловушки outputDir, `[aria-modal]`-оверлеев и
ложных «запрос без ответа».

Связано: [[project-two-backends-spa-targets-new]] (устарела — второго бэка
больше нет), [[project-smart-josparlau-frontend-state]], [[project-ops-backend-plan]].
