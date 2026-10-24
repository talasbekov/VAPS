# Блокировка hard-delete оператора (hd-5-7 / Story 5.7, FR-13)

> **Тип:** bounded design (see `_bmad-output/planning-artifacts/epics-hardening.md` Story 5.7).
> **Статус:** РЕАЛИЗОВАНО 2026-08-22.

## Проблема

При проверке кода на эту задачу обнаружено: soft-delete (`deactivate`/`reactivate`,
Story 2.4) уже существовал в `OperatorViewSet`, НО рядом с ним оставались **три
живых пути физического удаления**, каждый каскадно стирающий
`Operator.user` (CASCADE) → `Request.created_by` (CASCADE) →
`Attendee.request` (CASCADE) — всю историю заявок/участников оператора
безвозвратно:

1. `DELETE /api/v1/operators/{id}/` — `ModelViewSet` по умолчанию отдаёт destroy
2. `POST /delete_operator/<username>/` — легаси Django-view, буквально
   `operator.delete(); user.delete()`
3. Django admin — `OperatorAdmin` без `has_delete_permission`, ПЛЮС
   default `auth.User` admin (не переопределён) допускал удаление User
   напрямую тем же каскадом

## Решение

1. `OperatorViewSet.http_method_names` — исключает `'delete'`, DRF сам отдаёт 405
2. `delete_operator` (легаси) переписан на ДЕАКТИВАЦИЮ (тот же паттерн, что
   `OperatorViewSet.deactivate`: гварды self/superuser, `record_access_event`,
   `audit_log`) — URL/кнопка в шаблоне не убраны, меняется только семантика
3. `OperatorAdmin.has_delete_permission` → `False`
4. `GuardedUserAdmin` (перерегистрация `auth.User`) — `has_delete_permission` →
   `False`, закрывает путь через `/embankment/auth/user/{id}/delete/`

## Итерация после code-review (2 прохода)

**Первый проход** нашёл, что диф закрыл только DRF-путь (1) и пропустил (2) и (3)
— легаси-view и Django admin всё ещё позволяли физическое удаление ровно тем же
каскадом, который весь diff должен был предотвратить.

**Второй проход** (после фикса 2 и 3) нашёл ещё одну дыру: `OperatorAdmin`
закрыт, но `auth.User` (авто-регистрируемый Django'ом `UserAdmin`) — нет, а
удаление `User` напрямую даёт тот же каскад в обход `OperatorAdmin` полностью.
Также отметил (не блокирующе — «сейчас инертно»): легаси-view не дублирует
P2-1-гвард (супероператор не может деактивировать другого супероператора) —
но у этого view декоратор `@user_passes_test(is_superuser)`, туда супероператоры
вообще не попадают, так что гвард там неприменим по построению (сам ревьюер
это признал).

## Тесты

`OperatorHardDeleteBlockedTests` (4 новых) + regression-фикс существующего
`test_delete_operator_post_deletes` (переименован в
`..._deactivates_not_deletes`, ассерты инвертированы под новую, безопасную
семантику) + 2 доп. теста после второго ревью (bulk `delete_selected` в admin,
прямое удаление `auth.User` через admin).

Полный прогон: **724 теста OK** (9 skip).

## Связанные заметки

- Story 2.4 (`OperatorViewSet.deactivate`/`reactivate`) — уже существовавший
  правильный путь, который эта задача защитила от разрушительной альтернативы рядом
