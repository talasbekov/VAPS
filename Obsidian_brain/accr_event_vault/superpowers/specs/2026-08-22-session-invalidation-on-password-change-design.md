# Инвалидация сессий после смены/сброса пароля (hd-2-8 / gap §3.5)

> **Тип:** bounded design (see [[accreditation-gap-analysis]] §3.5, `Critical`).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22.

## Результат

Реализовано полностью по дизайну ниже:

- `eventproject/services/session_security.py::terminate_other_sessions()` — новый.
- `change_password` (ru/default) — `terminate_other_sessions` после `update_session_auth_hash`.
- `new_password` (админский сброс) — `terminate_other_sessions` + новый `audit_log(action="user.password_reset_by_admin")`.
- `kz_event`/`en_event::change_password` — попутно найден и исправлен баг: отсутствовал `update_session_auth_hash` (пользователь сам себя разлогинивал после смены пароля); добавлены `update_session_auth_hash` + `terminate_other_sessions` + `audit_log` (раньше не аудировалось вообще).
- `user.password_reset_by_admin` добавлен в `SIGNIFICANT_ACTIONS` (`audit.py`).
- Тесты: `eventproject/tests/test_session_security.py` (unit, 3), `eventproject/tests/test_password_change_session_invalidation.py` (интеграционные, ru/kz/en + admin-reset, 15), плюс новый `NewPasswordAdminResetAuditTests` в `test_audit_action_coverage.py`.
- Попутный регресс-фикс: докс-уборка того же дня переместила `integration-spec-v1.schema.json` в `WIKI/`, что сломало захардкоженный путь в `test_export_contract.py` — путь поправлен.
- Полный прогон: 664 теста, OK (9 skipped — Postgres-only на SQLite).
- Ничего не закоммичено в момент записи этой заметки — коммит по решению пользователя.

## Проблема

`docs/WIKI/accreditation-gap-analysis.md` §3.5: старые сессии оператора не
завершаются при смене/сбросе пароля. Если пароль скомпрометирован и сброшен,
сессия злоумышленника остаётся активной — сброс пароля не отрезает доступ.

## Найдено при анализе кода

Три места, где меняется пароль оператора, и все три ведут себя по-разному:

1. **`eventproject/views/views.py::change_password`** (ru/default, самообслуживание) —
   вызывает `update_session_auth_hash` → чужие сессии *лениво* инвалидируются
   (протухают на следующий запрос через сравнение `session_auth_hash`), но не
   удаляются из БД активно. Пишет `audit_log(action="user.change_password")`.
2. **`kz_event/views.py::change_password`** и **`en_event/views.py::change_password`** —
   **баг**: не вызывают `update_session_auth_hash` вообще → пользователь сам себя
   разлогинивает на следующем запросе после смены пароля в своей же сессии. Не
   пишут `audit_log`.
3. **`eventproject/views/views.py::new_password`** (админ генерирует новый пароль
   оператору) — вообще не трогает сессии (ни hash, ни удаление) и не пишет
   `audit_log`. Главная дыра из gap-анализа: реквестор жмёт «сбросить пароль»,
   а скомпрометированная сессия остаётся живой неограниченно.

`new_password` не дублирован в kz/en (единственная точка входа в
`eventproject/urls.py`). Сессии — `db`-backed (`SESSION_ENGINE` не
переопределён в `settings.py`).

Django admin (`/embankment/`) сброс пароля через `AdminPasswordChangeForm` —
**вне scope** (решение пользователя): доступен только суперюзерам, меньший
риск.

## Решение

1. **`eventproject/services/session_security.py`** (новый файл) —
   `terminate_other_sessions(user, current_session_key=None)`: проходит по
   живым `django.contrib.sessions.models.Session` (`expire_date__gte=now`),
   декодирует `session_data`, сравнивает `_auth_user_id`, удаляет совпадения
   (кроме `current_session_key`, если передан).
2. **`change_password`** (ru/default) — после `update_session_auth_hash`
   добавить `terminate_other_sessions(request.user, request.session.session_key)`.
3. **`new_password`** — после `set_password`/`save`:
   `terminate_other_sessions(user)` (без исключения — сбрасывает всё, т.к.
   инициатор не сам юзер) + `audit_log(action="user.password_reset_by_admin", ...)`
   (actor = текущий залогиненный админ/оператор, target = user).
4. **`kz_event/views.py::change_password`**, **`en_event/views.py::change_password`** —
   баг-фикс: добавить отсутствующий `update_session_auth_hash(request, request.user)`
   + `terminate_other_sessions(...)` + `audit_log(action="user.change_password", ...)`
   (привести к параметру ru-версии).
5. Новое действие `user.password_reset_by_admin` добавить в
   `SIGNIFICANT_ACTIONS` (`eventproject/audit.py`).

## Тестирование

- unit-тест на `terminate_other_sessions` (2+ сессии → остаётся только
  исключённая/ни одной);
- интеграционные тесты на все 3 `change_password` (self-логаут не происходит
  при наличии hash-обновления, чужая сессия гибнет);
- интеграционный тест на `new_password` (все сессии сброшены + audit-запись
  создана);
- регресс: существующие 612 тестов должны остаться зелёными.

## Связанные заметки

- [[accreditation-gap-analysis]] — §3.5, источник требования
- [[rbac-matrix]] — роли, которым доступны `change_password`/`new_password`
