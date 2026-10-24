---
name: project-full-review-2026-08-08
description: "Полное ревью проекта 08.08.2026: 3 фикса закоммичены, остальной бэклог находок открыт"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04c7f43d-7d14-4bb5-a2ca-6f07ef7a40ec
---

Полное 4-осевое ревью (security/correctness/frontend/infra) 2026-08-08, ветка
`claude/wizardly-chaplygin-f750e9`. **Закрыто тремя коммитами** (853dad17,
38619bcd, c0666e28): fail-closed дефолты settings (DEBUG default off +
SECRET_KEY-гвард; `VAPS_DEBUG=1` теперь обязателен в dev — см.
[[reference-vaps-test-run-recipe]]), вторая половина E3-блокера в
`update_status` (refresh под локом + cancelled-гвард), noopener-фикс
ExpenseReportPage + e2e same-tab + синк josparlau.

**Открытый бэклог находок** (по убыванию):
- ~~Critical: прод `NEXTAUTH_SECRET` в docker-compose.prod.yml~~ — ЗАКРЫТО
  10.08 (11020c80): литерал удалён, `${NEXTAUTH_SECRET:?}` + fail-closed в
  auth-config (прод без секрета не стартует, dev — явный dev-local-secret).
  ОСТАЛОСЬ РУКАМИ НА ПРОДЕ: ротация утёкшего секрета (история git его
  помнит) + NEXTAUTH_SECRET в окружение хоста перед деплоем. Открыто:
  хардкод SECRET_KEY легаси-бэка (стенд :8100).
- ~~High: гонки легаси-эндпоинтов core~~ — ЗАКРЫТО 10.08 (861958bf):
  archive/restore/assign_employee/release получили select_for_update +
  state-гварды (3 новых 409-кода) + аудит через record() (4 новых события,
  AUDIT_MATRIX → _Audited); 5 тестов с лок-ассертами по имени таблицы,
  3 красные пробы; гейт 2503. Открыто из High: CI гоняет только
  makemigrations легаси (check:josparlau больше не существует — демонтаж
  10.08); 75 МБ tar в git-истории.
- Medium: Sentry `send_default_pii=True` на бэке И фронте (ПДн наружу);
  RBAC-мутации operations/services.py без audit.record (revoke_role без actor);
  attachment download без division-scope; WS `?user_id=` без origin-check;
  `SensitiveFieldPolicy.mask_strategy` fail-open (неизвестная стратегия → ИИН
  без маски) и без CHECK; лок-дыра `assign_employee_division` при пустом
  открытом интервале; `timezone.now()` вместо Clock в core views; N+1 политик
  маскирования (51 запрос/страница); старый DefaultPagination без max_limit.
- Ретро E3 остаток: forward-guard часов — НЕ закрыт этим ревью.
