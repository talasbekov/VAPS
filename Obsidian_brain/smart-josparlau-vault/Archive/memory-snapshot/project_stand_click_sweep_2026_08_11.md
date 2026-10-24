---
name: project-stand-click-sweep-2026-08-11
description: "Playwright-обход стенда 11.08.2026: 4 дефекта закрыты (00a7c37f), secondments теперь роутится; остаток — не дефекты + 2 транзиента на /dashboard"
metadata: 
  node_type: memory
  type: project
  originSessionId: 404b5f55-f500-4114-9cce-95ff4079919a
---

Полный клик-обход стенда (кроулер: логин admin → BFS 80 страниц → клик всех
недеструктивных кнопок, сбор console/pageerror/HTTP≥400; скрипт одноразовый,
жил в scratchpad). Закрыто коммитом `00a7c37f`:

- **/api/secondments/ ВКЛЮЧЁН** — роут был закомментирован с донор-импорта
  `7577182f`, вьюхи ходили в user.role/user.division (нет на auth.User).
  Область портирована на User→Employee→StaffUnit→Division (идиома
  statuses), superuser видит всё; сериализатор отдаёт вложенные
  employee_detail/from|to_division_detail — форму ждёт
  features/secondment-requests. Таблица есть, строк 0.
- **service-report-jobs**: фронт зовёт ТОЛЬКО `/{id}/detail/` (контракт
  мока), бэк имел только retrieve — добавлен action-алиас `detail_card`
  (+permission_map!). Классическая щель «мок и есть контракт» vs router.
- **deep_link уведомлений рейтинга**: `/ratings/workspace` (маршрут SPA,
  выведен 10.08) → `/security-ops/ratings/workspace`. ТРИ места: генератор
  ratings.py (×2), сид seed_operations.py, и УЖЕ ЛЕЖАЩИЕ строки в БД стенда
  (правлены UPDATE-ом) — фикс генератора не чинит старые данные.
- **/settings**: сайдбар вёл в 404; страница = re-export
  app/security-ops/settings (приём /feedback: одна реализация, два входа).

НЕ дефекты (не чинить повторно): 404 DAY_NOT_SUBMITTED на экспорте расхода
несданного дня (домен, задокументирован в схеме); 400/422 на POST пустых
форм диалогов (combat-duty-shifts, dictionaries entries, demand/approve вне
стадии) — серверная валидация.

Хвост /dashboard РАЗОБРАН (8179e037): hydration mismatch = три `new Date()`
прямо в JSX (секундная граница SSR/клиент; репро — жёсткий goto поверх
редиректа логина, 2/8), починен маунт-гейтом (useState null + useEffect).
CLIENT_FETCH_ERROR next-auth = net::ERR_ABORTED трёх in-flight фетчей
/api/auth/session, когда жёсткая навигация убивает страницу логина —
библиотечный шум v4, НЕ дефект и НЕ чинить глушением (спрячет реальные
сбои); при спокойной загрузке 5/5 чисто. Репро-приём: ошибки, всплывающие
только у кроулера, ищи в его жёстких переходах, а не в самой странице.

Занесено в журнал: `af94b77f` (docs/api-gaps.md) + `00dbe361` (граф), см.
[[reference-vaps-docs-ledger-location]]. Все коммиты на `main` в worktree
`wizardly-chaplygin-f750e9`.

Ямы подъёма см. [[project-stand-raise-gotchas]] (все обошлись: .env.local
на месте, порты 8100/3000 были свободны). Перед кликами — pg_dump бэкап
personnel_records в scratchpad (кнопки могут мутировать живые данные).
