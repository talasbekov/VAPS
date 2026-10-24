# Архив BMAD — часть A: чтение для будущего ревью

Дата: 2026-09-05. Plane: #770. Исполнитель: Кодекс Астра 6.

Задача: прочитать 77 документов из манифеста `/tmp/smart-josparlau-docs-770-part-0.txt`, выделить исторический контекст и риски для будущего ревью. Код, RAW, существующие источники, Plane и Git этой подзадачей не изменяются; тесты и стенды не запускаются. Архив уступает главному канону [[RAW/README]]. Исторические заявления о прохождении проверок здесь не становятся доказательством текущего состояния кода.

## Ход чтения

- 2026-09-05, Plane #770. Проверен манифест: 77 файлов, 164 порции не более 28 КБ по границам строк. Для контроля чтения используется фактический вывод содержимого. Первые объединённые выводы усеклись; соответствующие порции прочитаны повторно отдельно, после чего выбран один фрагмент на вызов. Исполнитель: Кодекс Астра 6.

## Конспект по мере чтения

- Исторический `deferred-work` описывает границы модулей: `core` хранит мастер-данные, `operations/statuses` — статусы и вычисление расхода; RBAC отделён от Django-auth. Clock/Watermark задают время и материализацию, domain-слой не должен читать настенные часы напрямую. Межконтекстные ссылки — плоские идентификаторы, целостность компенсируется проверками на границах.
- Для будущего ревью важны классы ошибок, уже встречавшиеся в истории: формально зелёная RBAC-матрица, производная от той же ошибочной карты; тесты только под ADMIN; слишком узкий AST-скан; отсутствие проверки реальной миграции при зелёном fresh-DB тесте; hard-overlap как deadlock/DataError вместо ожидаемого IntegrityError; потеря атомарности при построении отчёта; недетерминированные равные ключи сортировки.
- Исторические риски импортов: повторный импорт только пропускает старую запись, clamp открытого статуса не продлевается, план становится фактом, ошибочный timestamp способен оживить отменённый статус, циклы подразделений переживают импорт. Указания о закрытии в следующем эпике требуют отдельной проверки, поскольку само перенесение пункта не доказывает устранение.
- Исторические риски конфигурации: re-seed может либо затирать операторские настройки, либо сохранять отозванные RBAC-гранты; Django superuser не должен обходить прикладной RBAC. Маскирование ИИН по последним цифрам и allowlist имён файлов не гарантируют отсутствие персональных данных.
- Проверки поставки/производительности имеют ограниченную силу: hash рядом с архивом доказывает транзитную целостность, но не происхождение; требуется проверить идентичность загруженного образа. Headless Chromium не доказывает Firefox 100 и производительность целевой слабой машины. Старые Vite/Firefox-решения — история, применимость к текущему Next.js устанавливается отдельно.

## Фактический реестр прочитанного

| Источник | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/deferred-work]] | 1–650 из 650 | Полностью. Риски E1–E10: БД, импорт, контур, производительность, RBAC, статусы, аудит, снапшоты сдачи, генераторы, уведомления и клавиатурный грид. |
| [[Archive/bmad/implementation-artifacts/11-4-центр-уведомлений-ui]] | 1–420 из 420 | Полностью. Колокольчик, disclosure-панель, один владелец query, чистое слияние WS/REST; чтение вынесено в 11.4a/b; историческое ревью и ограничения. |
| [[Archive/bmad/implementation-artifacts/11-3-ws-клиент-с-reconnect]] | 1–390 из 390 | Полностью. Транспорт, backoff+jitter, SEED/REST-дочитка, монотонный курсор и grace, сброс credential/epoch, ограничения браузера и историческое ревью. |
| [[Archive/bmad/implementation-artifacts/10-7-печатная-форма-расхода]] | 1–906 из 906 | Полностью. Контрольная печать числового расхода, 17 колонок, +N прикомандированных отдельно, печатный CSS, неполный контракт до 10.7a и browser/DOM-проверки. |
| [[Archive/bmad/implementation-artifacts/10-3-экран-сдачи-дня]] | 1–435 из 435 | Полностью. Сохранение дельт и сдача снапшота разведены; подтверждение, окно сегодня/завтра, отказ 409, локальный drift и ревью. |
| [[Archive/bmad/implementation-artifacts/11-5-kill-switch-ws]] | 1–403 из 403 | Полностью. Env-флаг, identity до флага, accept→close(4503), отключение публикации при сохранении DB/REST; polling передан 11.5a. |
| [[Archive/bmad/implementation-artifacts/10-4-светофор-дерево]] | 1–435 из 435 | Полностью. Серверные пять состояний, полное получение и ленивый рендер дерева, фильтр без порчи ручного раскрытия, 400 узлов и ограничения проверки. |

- 2026-09-05, Plane #770. Завершено полное чтение `deferred-work.md` (650 строк). Выявлены исторические цепочки неполного закрытия: amendment первоначально только для разрешения «уточняется»; append-only аудита ограничен правами подключения; обязательные подразделения без историзации и слабое удаление ссылок; timestamp-поллинг может потерять поздний commit; `is_current` требует согласованного порядка flip→insert; замер синхронной генерации не распространяется на свод с ФИО. Для UI критичны async-ответы, маппинг ошибок по каналам, dirty/pending, возвращение ошибок bulk в строки, настоящий override с причиной и клавиатурный выход из грида. История содержит неоднократные доказательства вакуумных тестов красными пробами и ложных чекбоксов; будущий ревьюер должен проверять тестовый оракул и соответствие обещаний реализации. Исполнитель: Кодекс Астра 6.

Полнота пока не достигнута; реестр пополняется непосредственно после чтения.

### Порция 58–60 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 3.7: verification только, auto-return derived из half-open intervals, смежный следующий факт побеждает на D, gap=IN_SERVICE, cancelled successor исключён. Count before==after буквально не доказывает отсутствие UPDATE/других-table writes, хотя read-only структура тогда подтверждена; pure adjacency не доказывала cancelled eligibility, добавлен DB-pin. Историческую готовую логику не приписываем этой story заново.

5.7b1: configured per-division recipient→global fallback→missing skip, не lastsubmitter; flat actor IDs и справочник Admin, без identity/existence verification. Nonblank DB check не нормализует padded routing keys: selector strip нужен; fallback allow empty/reject whitespace. Двойная итерация generator давала пустой результат, strUUID давал fallback, None давал фиктивного получателя — исправлено materialize/normalize/drop. Exact2queries доказан при существующем singleton, не universal bootstrap cost. Admin UUID search исторически500→убрано; утверждение универсально не переносится без проверки framework/backend.

8.1: scaffold @latest ушёл Vite8/TS6, позднее согласованный downgrade7/5; старые CompletionNotes прямо помечены историческими. Build-target не API-polyfill, compat dataset пропускал некоторые новые API, ES2023 lib открывал runtime failure FF100 — суженES2022. No-CDN эвристика усиливалась от localhost.evil/protocol-relative/ws/srcset/case/asset-types, но не доказательство всех динамических сетевых путей. Budget gzipJS не CSS/fonts/RAM, emptydist не pass; fileURLToPath нужен для кириллицы. Proxy подтверждён API403, WS лишь config доE11; локальный gate не wiringCI. Это архив старого frontend, не руководство текущемуNext.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 58 | [[Archive/bmad/implementation-artifacts/3-7-дефолт-в-строю-и-непрерывность]] | 1–133, полностью | Derived continuity, eligibility и границы verification тестов |
| 59 | [[Archive/bmad/implementation-artifacts/5-7b1-recipient-config-получатель-уведомлений]] | 1–226, полностью | Routing config, нормализация, iterable safety и fallback |
| 60 | [[Archive/bmad/implementation-artifacts/8-1-scaffold-vite-react-ts-с-контурной-донастройкой]] | 1–178, полностью | История FF100 scaffold, no-CDN/budget/compat proofs |

### Порция 55–57 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 3.5: status+Override atomic только при реально обойдённом soft, hard непроходим, planned warnings не создают override. Причина обязательна даже если обход не понадобится; None guard добавлен. Historical per-division метрика не сохранялась: join current employee.division меняет прошлый разрез. Append-once был лишь отсутствием update-service, не DB-trigger у Override; ссылка «E4» требует проверки, потому4.2 защищает audit_logs. Reason длина/права руководителя/API — не закрыты самим service kwarg; параметры — рекомендационные дефолты, не отдельное финальное решение клиента.

2.8: восстановлен Django-auth слой исключительно для Admin поверх отдельного бизнес-RBAC; добавленные flags defaultFalse и M2M, existing identities preserved. create_superuser исправляли на extra_fields+strict flags+nonempty username; unusable password create_user сохранён. Reverse сохраняет строки пользователей, но теряет добавленные права/flags/M2M — «обратимо» не значит сохранить всё новое. Backfill/rollback лишь ручная репетиция, тест нового пользователя не доказывает populated migration. has_perm становится доступен app-wide, нужен boundary guard, не вера в separation.

1.1: PostgreSQL foundation и полный timeout включая compose startup; TCP healthcheck избегает ложной readiness initdb временного сервера. Venv guard, timeout124 diagnostic, миграции возвращены под lint несмотря ранний противоположный DevRecord. Gate исключает property/concurrency/slow с первого дня; чистый clone требует bootstrap, контейнер/том остаются и смена POSTGRES env не изменяет старыйvolume. Фиксированный порт/shared database — источник конфликтов разных checkout. Старые dev credentials не воспроизводятся в этом конспекте; их наличие не разрешает перенос в текущую инфраструктуру.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 55 | [[Archive/bmad/implementation-artifacts/3-5-override-сущность]] | 1–168, полностью | Реальный soft bypass, atomic provenance и historical metrics |
| 56 | [[Archive/bmad/implementation-artifacts/2-8-admin-для-справочников]] | 1–170, полностью | Два auth-domain, User migration и дефолты полномочий |
| 57 | [[Archive/bmad/implementation-artifacts/1-1-тестовый-фундамент-на-postgresql]] | 1–230, полностью | PostgreSQL gate, readiness/time budget и исключённые проверки |

### Порция 52–54 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 8.2: feature dependency/ban canon + lockfile gate + красный selftest конкретного ruleId/severity и зелёные дозволенные направления. V7 legacy config и resolver без TS extensions были молча зелёными; unknown files/deps, JS-в-src, npm alias по lock.name обходили ограничения. Ban-list перечисление не гарантирует запрещённую категорию; расширение согласовано. Dynamic import useMutation deferred. PID fixtures/excludes/pre-clean имеют отдельную параллельную lifecycle-границу; локальный npm gate ещё не корневой CI. Всё относится к историческому Vite канону.

2.10: включение admin материализует cookie/session/security/static риски даже без проектных моделей; contrib Group авто-регистрируется, guard усилен allowlist, не только apps.*. force_login+GET не проверял POST/CSRF/ModelBackend, добавлен настоящий enforced-CSRF login. 200 HTML не доказывает CSS/JS в production; deploy-hardening/STATIC_ROOT отложены. Отдельные технические объяснения middleware в раннем тексте — исторические тезисы, не текущая проверка framework.

9.2: чистая grammar(state,key,position,bounds) возвращает effects/nextstate/position/seed; не хранит значения и не двигает DOM. «Exhaustive» guard проверял лишь валидный action и границы: COMMIT→MOVE/NOOP проходили; заменён независимой expected table и тройными assert. Union-константы нужно проверять на полноту, не просто satisfies; stationary paths тоже clamp после shrink. Грамматика корректна, но consumer preventDefault терял seed/typeahead и stale focus падал — deferred9.4/9.6. Контракт ещё не подписан, код хронологически опередил его ревизию; done не равен клиентскому принятию.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 52 | [[Archive/bmad/implementation-artifacts/8-2-канон-линтеры]] | 1–182, полностью | Исполняемый lint canon и доказательство неглухого гейта |
| 53 | [[Archive/bmad/implementation-artifacts/2-10-admin-платформа-django-auth-включение]] | 1–221, полностью | Admin platform, настоящий login и deployment границы |
| 54 | [[Archive/bmad/implementation-artifacts/9-2-state-machine-грамматики]] | 1–149, полностью | Grammar effects, невакуумный exhaustive oracle и consumer gaps |

### Порция 49–51 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 5.7c: any-auth личный feed с безусловным recipient==actor в selector, не global audit policy; strict created_at>since + offset50/200, deterministic ties. Утверждение про редкость одинаковой микросекунды не доказывает отсутствие потерь, late commit race отложен клиентам overlap+dedup. Индекс recency не unread. Isolation AST был дырявым на aliases/relative и пустом скане; усилили, но соседний старый guard отложили. Пустой router-prefix конфликтовал с api-root — явный path сохранил callback introspection. auto_now_add требует контролируемого timestamp fixture, override Clock его не замораживает.

5.8a: coarse permission→form→отдельный service-scope guard→submit. None/falsy scope не сужал PermissionService, str UUID давал ложный403: fail-loud+UUID normalize. Новая защита blank-actor selector сама дала HTTP500: header whitespace truthy проходил auth; исправлен strip в identity boundary. Это пример ревью-фикса с собственной регрессией и ошибочного «недостижимо изHTTP». Завтрашний блок гейтит выпуск, НЕ сдачу; прочтение формулировки без границы меняет workflow. API-first schema validation, actor payload ignore, две матрицы(RBAC/audit) — audit пока deferred, не эмиссия.

5.6a: required=required даже пустой roster, сдаёт пустой день; решение отличается от NEUTRAL светофора и было согласовано исправлением epics-note. Контрольный час не влияет на blocked; пустой required config открывает выпуск. Flat stale/deleted required ID никогда не сдаст и создаёт вечный org-wide block, None-date тихо включает block — deferred input/config hygiene, не решение самого read-only derive.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 49 | [[Archive/bmad/implementation-artifacts/5-7c-api-уведомлений]] | 1–218, полностью | Self-scope, timestamp polling, AST и pagination |
| 50 | [[Archive/bmad/implementation-artifacts/5-8a-api-post-сдачи-дня]] | 1–198, полностью | Submit API, обязательный scope, регрессия hardening |
| 51 | [[Archive/bmad/implementation-artifacts/5-6a-derive-блокировки]] | 1–204, полностью | Required minus submissions, пустые подразделения и stale refs |

### Порция 46–48 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 5.6b: override date-level для всей организации, один на дату, без revoke; blocked=False, laggards сохраняются. overridden=True означает реально использованный обход при laggards; наличие записи без laggards не показывается этим флагом. Duplicate create раньше отравлял внешнюю транзакцию, исправлен savepoint+чистый ValueError; reason/actor strip и non-blank DB checks. Audit, authority/scope и time-input guard тогда отдельные; created_at inherited auto, не явный Clock бизнес-факт.

4.2: UPDATE/DELETE row triggers и отдельный TRUNCATE statement trigger ловят случайную мутацию; SQLSTATE23001→IntegrityError, INSERT разрешён, сообщение проверяется. Приложение было owner+superuser, REVOKE FROM PUBLIC символичен; hostile privileged actor обходит через disable/replication/drop — dedicated lower-priv role отложенаE12. Это не криптографическое/враждебно-админское доказательство неизменности. RunSQL list защищает тело функции от script splitting; round-trip ручной, не автоматический; model migration check не проверяет trigger drift.

3.4: severity HARD если любой тип hard, SOFT+existingPLANNED→warning, ACTIVE/COMPLETED→409; latter backdated semantics deferred. Чистый детектор получает уже отобранные overlaps, unknown/None тихоSOFT. Ключевое исправление overclaim: GiST защищает ТОЛЬКО hard×hard, hard×soft лишь сервис; constraint frozen migration не следует live tuple без новой миграции. Hypothesis sampling не «все пары»: добавлены289 exhaustive в gate. Warnings тогда вычислялись и отбрасывались до API; tuple/seed parity не гарантировала live DB constraint parity.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 46 | [[Archive/bmad/implementation-artifacts/5-6b-override-сущность]] | 1–236, полностью | День-override, видимость, transaction/actor/reason guards |
| 47 | [[Archive/bmad/implementation-artifacts/4-2-append-only-на-уровне-бд]] | 1–176, полностью | Audit DB enforcement и границы privileged threat model |
| 48 | [[Archive/bmad/implementation-artifacts/3-4-конфликт-детектор-на-матрице-данных]] | 1–175, полностью | Матрица severity, sampled vs exhaustive, GiST≠service |

### Порция 43–45 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 2.2: 17 кодов вместо документ-ярлыка «12», hard4, counts_in_staff=False лишь ATTACHED, DETACHED restricts_editing; кросс-сверка DB-seed/hand-maintained derive/GiST констант. StatusType появился, но обещанная FK-конверсия free-text status_type_code отложена. PENDING990/IN_SERVICE был provisional и позднее3.9 изменён; каталог grow-only без prune, reseed overwrite операторских полей передан2.12. Называть таблицу единственным источником истины без сверки live consumer неверно.

3.10: Secondment связывает DETACHED+ATTACHED одного сотрудника и from/to flat UUID, atomic обе ноги+связь; принимающий +N и живые roster groups тогда ещё НЕ реализованы. COMPATIBLE type-level, не instance-level; PLANNED downgrade пропускает перекрывающиеся будущие secondments, eligibility подразделения/активность сотрудника/целостность связей deferred. План ошибочно обещал сломанный property: HARD iff either-hard не ломается на COMPATIBLE среди soft. Решение Secondment принято, но обязательная ARCH-ID запись тем же PR отсутствовала и была defer — статус done не равен полному документированию.

5.2: версия DailySubmission — integer operations-модель, flat division UUID, submitted_at явно через Clock. DB unique только ≤1current, exactly1 обеспечивает сервис; event choices сами не DB validation, PositiveInteger разрешает0: добавлены явные event-in/version≥1 checks. Readonly Admin тоже исключён точным каталог-guard по решению владельца. Ранний rows-only контракт позже уточнён5.3a roster+rows. Документ содержит технические утверждения о SQLite/deferrable conditional unique, которые не принимаются здесь за проверенную универсальную возможность; актуальный стек и миграции нужно смотреть в будущем ревью.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 43 | [[Archive/bmad/implementation-artifacts/2-2-справочник-типов-статусов-с-seed]] | 1–226, полностью | Канонические коды и seed, отложенная FK/операторская семантика |
| 44 | [[Archive/bmad/implementation-artifacts/3-10-секондменты-инициация]] | 1–184, полностью | Atomic pair, receiving source, bounded display и integrity gaps |
| 45 | [[Archive/bmad/implementation-artifacts/5-2-модель-dailysubmission]] | 1–214, полностью | Версионирование, DB checks, ровно vs не более одной |

### Порция 40–42 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 2.14: coarse RBAC fail-closed per-action mixin после identity/resolver, методовая MATRIX и wildcard parity; OPTIONS/unsupported методы требуют отдельного 200/405 пути. Зеленая матрица ловит неисполнение заявленной карты, но согласованную ошибку карты+оракула или выдачу * новой роли может принять. ADMIN-only функциональные тесты недостаточны; scope и клиентский X-User-Permissions masking оставались отдельно, «все endpoints gated» не равно безопасному scope/masking.

3.8: bulk — сервис, НЕ REST, atomic source=USER, одна строка на человека, lock UUID-order→scope current-division→prefetch→in-memory→insert; неуказанным ничего не пишется, а их подтверждение относится к сдаче. 422>409 агрегация, security403 до бизнес-ошибок. No-N+1 доказан 5/50 и красной мутацией, но p95/300 PENDING, лимит payload/batch, multi-type/per-division масштаб и overridable metadata отложены. Scope current division не исторический; block всех writers через Employee-lock — существенная предпосылка, не гарантия от любых будущих direct writes.

5.8b: manual amend coarse+scope на API, системный hook без RBAC внутри amend_day; identity/triggered_by не берутся из payload. PK идентифицирует цепь, даже старая версия создаёт новую head+1, без optimistic stale rejection (принято тогда). 403 details раскрывает server-resolved division_id и существование PK — явно принятый исторический trade-off, не универсальная безопасность закрытого контура. Sanction≤255, canonical ASCII pk, HEAD/405/ancestor-scope/JSON-shape граничные тесты. Unbounded reason/upload-limit500, визуально пустой unicode, orphan flat-ID Division отложены. Недостижимый422 не тестируют вакуумно; audit тогда только deferred-строка реестра.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 40 | [[Archive/bmad/implementation-artifacts/2-14-раскатка-гейта-core-api-на-остальные-viewsets]] | 1–204, полностью | RBAC rollout, method-aware матрица, 405/OPTIONS и независимость оракула |
| 41 | [[Archive/bmad/implementation-artifacts/3-8-bulk-api-массового-обновления]] | 1–185, полностью | Bulk atomic, scopes/errors/no-N+1 и честный pending perf |
| 42 | [[Archive/bmad/implementation-artifacts/5-8b-api-amend-сдачи]] | 1–199, полностью | Chain amend API, системная граница и информационные trade-off |

### Порция 37–39 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 2.12: ранний рецепт create_defaults ошибочно предполагал merge; фактически полный create-набор нужен отдельно, иначе обязательные canonical поля пропадают. Seed сохраняет операторские color/is_active, обновляет канон; критические типы могут остаться деактивированными. MinValueValidator действует через full_clean/Admin/DRF, не bare save/upsert; импорт отрицательных ordinal изначально ошибочно объявлялся безопасным, исправлен отдельным CLI guard после ревью. Старые отрицательные данные не исправлены и DB-check не добавлен.

1.3: Clock aware UTC, local business-date и ContextVar override с token-reset; non-UTC override нормализован после ревью, datetime в catchup_plan запрещён точной проверкой типа. Alias/dot-boundary AST исправлялись, но API/auto_now оставались вне охвата. ContextVar не наследуется новыми threads, cap и дисциплина Watermark отложены потребителю3.12; первоначальное «единственное место часов во всём проекте» шире фактического гейта services/models.

5.3a: self-contained snapshot={schema_version, roster, rows}; roster включает людей без фактов, rows все действующие неотменённые интервалы, IDs/source, canonical ordering, rows⊆roster. Денорм ФИО/звания заморожен на момент сдачи, НЕ исторически на business_date. Штат/вакансии не входят в self-containment. Direct core.models import из operations был ошибочным даже в плане — заменён core selector. UUID-string давал тихо пустой срез до coercion; unknown-valid division остаётся неотличим от пустого, existence/scope отданы5.3b. Read-only builder не обеспечивает транзакционный consistent snapshot сам; atomic вызывающего — отдельный контракт, не автоматическое доказательство одинакового DB snapshot всех SELECT.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 37 | [[Archive/bmad/implementation-artifacts/2-12-edit-safety-справочников-валидаторы-create-defaults]] | 1–221, полностью | Seed/edit safety, replace-vs-merge, validators и обход импортом |
| 38 | [[Archive/bmad/implementation-artifacts/1-3-clock-сервис-и-watermark]] | 1–230, полностью | Инъекция времени, watermark, AST и реальный охват |
| 39 | [[Archive/bmad/implementation-artifacts/5-3a-срез-билдер]] | 1–224, полностью | Самодостаточный срез, денорм и архитектурная граница |

### Порция 34–36 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 3.13: clock spike done означал knowledge/runbook, реальный OS-clock в контуре не прогнан. Cap31 — на один запуск; forward≤366 может материализовать все N дней за повторные запуски, не максимум31 всего. CLI future-argument guard не защищает beat от спешащих OS часов. Subday backward не вызывает date-watermark halt, но timestamps немонотонны; небольшой дрейф возле midnight/17:00 значим. TIME_ZONE-канарейка не проверяла реальный VAPS_LOCAL_TIMEZONE; raw timezone.now в API и auto_now могли обходить тестовый Clock. Старые таблицы досье не полностью синхронизированы с исправлениями ревью.

3.9: PENDING собственная колонка, приоритет990 ниже фактов10–80, выше IN_SERVICE999; три report константы, seed, renderer, donor fold должны обновляться вместе. Resolve отменяет весь pending и создаёт USER real status в одной транзакции; uncovered часть прежнего интервала возвращается в derived IN_SERVICE, не остаётся pending. Дополнительный cancelled guard нужен для запрета двойного resolve, source-editability его не заменяет. No-op amendment seam имел min/max bounding interval, который захватывал gap разрозненных интервалов; точный union отложен5.4b. N-дней эскалации/права разрешения оставались открытыми.

8.3: два stack-local drift гейта (API→schema.yaml→schema.d.ts), regen-temp и byte compare без мутации дерева; генерация зависит от PostgreSQL vs SQLite числовых границ. Green drift не подтверждал полноту контракта: 5 bare ViewSets и 47 errors/143 warnings генератора были разрешённым baseline, schema enrichment и error envelope отложены. tsc strict сам не был защищён, самотест насильно включал --strict и скрывал удаление настройки — добавлен guard конфигурации. CLI banner, prettierignore и генераторные версии являются частью воспроизводимости, не бизнес-валидацией API.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 34 | [[Archive/bmad/implementation-artifacts/3-13-спайк-часы-без-ntp]] | 1–181, полностью | Временное ядро, blast radius, границы доказанной готовности |
| 35 | [[Archive/bmad/implementation-artifacts/3-9-статус-уточняется]] | 1–202, полностью | Неопределённость и ретро-resolve, закрытый мир отчёта, hook |
| 36 | [[Archive/bmad/implementation-artifacts/8-3-кодоген-типов-из-схемы]] | 1–222, полностью | Двухслойный schema drift и слепые зоны completeness/strict |

### Порция 31–33 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 5.1: проверка подписи JWT сама не доказывает trust-chain. Исторически следующий XUserId класс перезаписывал валидный JWT actor, отсутствие prod key делало fail-open; ревью закрыло обе дыры динамической цепью (dev только без JWT) и config fail-closed. Audience обязателен в prod; явный allowlist, запрет смешения HS/RS, sub-форма, malformed Bearer, authenticate_header для настоящего 401; тесты только HS256 не покрывали production RS256. is_active/revocation/JWKS/logging были отложены; runbook готовности внешнего Auth не означает, что контур проверен.

3.1: чистый DomainError и DRF translator; 400 форма, 422 hard rule, 409 state/soft; wire error_code/details, conflict внутри details, constraint имя из psycopg diag, неизвестное→generic500. Маскирование любого OperationalError под overlap422 исправлено до SQLSTATE 40P01/40001; blanket mapping даже этих кодов остаётся исторической привязкой, не универсальным смыслом всех транзакций. Field-error с именем detail терялся из-за reshape. Registry subset проверял только известные структуры handler, не весь динамический DomainError-код; DRF405/406/415/429 тогда оставались native. Branch-тест не заменял реальное concurrent/HTTP покрытие.

5.4a: amendment создаёт max(version)+1, old-current false ДО new-current insert, старый snapshot неизменен, rebuild нового из live; DB unique обеспечивает at-most-one, сервис должен восстановить exactly-one даже zero-current. reason/sanction стали non-whitespace DB-check, но sanction — свободный вход, не доказанная иерархия разрешения. Внутренний caller получает IntegrityError, 409 создаётся лишь HTTP handler; rollback version collision должен вернуть старый current. triggered_by_status_id — integer flat reference, не UUID; existence/positivity были отмечены как defer (утверждение досье о наличии конкретного DB-check требует проверки реальной миграции в будущем ревью).

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 31 | [[Archive/bmad/implementation-artifacts/5-1-вход-оператора]] | 1–235, полностью | JWT trust-chain, fail-closed, production ветка и ограничения |
| 32 | [[Archive/bmad/implementation-artifacts/3-1-domainerror-и-единый-exception-handler]] | 1–275, полностью | Error protocol, named constraints, ложный422 и неполный envelope |
| 33 | [[Archive/bmad/implementation-artifacts/5-4a-сервис-amendment]] | 1–238, полностью | Версия/снимок/flip atomic, санкция как вход, service vs HTTP ошибки |

### Порция 28–30 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 4.5: аудит list/retrieve внутри audit-app, AND фильтры и half-open timestamp, LimitOffset 50/200 и created_at DESC/id; historical entity_id для статусов означал employee UUID, не status PK. Подтверждённый тогда flat audit.view видел всё с IP/UA; это нельзя молча перенести в новую scope-модель. ReadOnlyModelViewSet сам не обеспечивал обещанные 405 из-за permission mixin initial: понадобилось явное http_method_names. Некорректный detail UUID давал 500; class-attribute тест max_limit не доказывал cap. Детерминизм равных timestamps не гарантирует стабильные offset-страницы при конкурентных вставках (аналитическое ограничение).

5.10: иммутабельность проверяется по двум осям — DB-refetched JSON старой версии и derive этого JSON; сравнивать by_id, не current_for после amendment. Обязателен успешный первый status edit именно сотрудника замороженного roster и sanity v2; глотание DomainError первого op делало тест потенциально пустым, исправлено. Property-пул исключал secondments; только resolve тогда вызывал автоматический amendment, прочие edits давали drift. Проверка JSON-канонизации не доказывает идентичность генерируемых файлов. Gate исключал property, сохранял лишь unmarked-компаньоны.

PRD 10.06: старый VAPS modular monolith, core staffing/status→daily expense и object→duty/8-step OM; двусторонний brokerage, direct physnaryad OMD, cascade substitutes, workload/day-night, immutable audit, closed LAN, RU/KZ. Важно не переносить устаревшие решения: реальные подписи и оценки были future/MVP-2, а текущий RAW требует версии/подписи каждого объекта и оценки/закрытие. Старые цвета индикатора (срок/частичность) позднее сменились snapshot-drift; lifecycle scheduler позднее derived-first. Внешний Auth без пользователей/паролей и донор не платформа — позиция июня, не доказательство нынешнего Next/Django проекта. RTO/RPO и ряд продуктовых вопросов явно оставались допущениями.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 28 | [[Archive/bmad/implementation-artifacts/4-5-api-чтения-аудита]] | 1–232, полностью | Audit read API, фильтры/права/пагинация и тестовые слепые зоны |
| 29 | [[Archive/bmad/implementation-artifacts/5-10-property-иммутабельность-снапшота]] | 1–196, полностью | Двухосевая неизменяемость старой версии, невакуумность |
| 30 | [[Archive/bmad/planning-artifacts/prds/prd-VAPS-2026-06-10/prd]] | 1–257, полностью | Исторический продуктовый объём FR-1…43, фазы и допущения |

### Порция 25–27 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. 6.1: приватные Attachment, UUID имя, sha256, владелец→Attachment (без GenericFK); permission до object-resolve, X-Accel internal контракт отдельно от nginx-реализации. Временный файл→replace→DB+audit допускает сироты при crash/ошибке replace и не равен распределённой атомарности. Whitelist доверял заявленному MIME, object-owner scope отсутствовал, role-grants provisional; UUID не заменяет авторизацию. Скачивание без аудита до 6.7; FileResponse-аудит нельзя откладывать до итерации после reset request-context. Были исправлены gitignore приватного хранилища и неподтверждённые счётчики, не эти сознательные ограничения.

2.6: чистый канон OWN→ATTACHED→DETACHED, Position.level (должность, не звание)→casefold фамилия→id; неизвестные должности после известных. Статический is_attached_force core не равен date-keyed статусам operations; per-person расходы были будущими потребителями. Ревью исправило whitespace-фамилии и property без id-компонента. 2 запроса на один список не гарантируют отсутствие N+1 у будущего цикла списков.

2.4: historical division на local_midnight с fallback current; история побеждает, tie-break starts_at+division UUID; scope после исторического резолва. В той версии employment был текущим WORKING/is_active, hire_date не проверялся: «состав на дату» не означал полной истории занятости. Σ reconciliation фактически конструктивно пустой missing из-за fallback и ещё не встроен в compute, вопреки раннему плану surface finding. Константное число запросов не ограничивало whole-DB материализацию; диагностика expected/actual не имела общего снимка. Это исторические границы, не заключение о текущем коде.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 25 | [[Archive/bmad/implementation-artifacts/6-1-app-documents-и-attachment]] | 1–284, полностью | Private files, авторизация, X-Accel, DB/filesystem граница |
| 26 | [[Archive/bmad/implementation-artifacts/2-6-канон-сортировки-списков]] | 1–233, полностью | Сортировка должность/фамилия/id, классификация отдельно |
| 27 | [[Archive/bmad/implementation-artifacts/2-4-списочный-состав-на-дату]] | 1–224, полностью | Исторический ростер, fallback, детерминизм и Σ |

### Порция 22–24 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. Полностью прочитаны три досье. 3.6: PLANNED можно отменить с append-once фактами/причиной; ACTIVE завершается только непустым полуоткрытым интервалом до сегодня; любой не-CANCELLED можно продлить, включая revive COMPLETED. Employee-lock без refresh статуса не предотвращал перезапись отмены устаревшим instance — это исправлялось отдельно и доказывалось красной пробой. Same-day ACTIVE не имел пути аннулирования; продление перепроверяло весь интервал, повторно поднимало прежний soft-overlap.

2.1: перенос RBAC-моделей в ops_rbac — state-only SDAS, прежние db_table и content_type.id; явное ребро миграционного DAG, не случайный topological порядок. При round-trip post_migrate создавал дубли CT; collision-safe delete мог каскадировать auth_permission (исторически там ещё не было действующих ссылок). elidable relabel опасен для populated старых БД при squash. Fresh-DB тесты не упражняли UPDATE ветвь; ручная репетиция не равна автоматическому покрытию. Заголовок Status: review расходился с последней записью done — статус досье не достаточное доказательство.

5.5b: bulk cascade own→postorder worst UNKNOWN>RED>YELLOW>GREEN, NEUTRAL нейтрален, late OR; один children_map, roster/history, statuses, submissions без N+1. Исправлялись циклы (FK parent не гарантирует дерево); гарантия corrupt-cycle только «не падает», цвет зависит от порядка. Изоляция только ValueError, не KeyError/TypeError schema-drift: ранняя широкая фраза была сужена, не поведение расширено. Псевдокод и старые ловушки про два скана/отсутствие циклов уступают поздним AC/реализации. Несуществующий root→NEUTRAL и actor-scope были отданы API.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 22 | [[Archive/bmad/implementation-artifacts/3-6-операции-жизненного-цикла-статуса]] | 1–206, полностью | Lifecycle, half-open, отмена и stale-instance гонка |
| 23 | [[Archive/bmad/implementation-artifacts/2-1-перенос-rbac-во-вложенный-app-operations-rbac]] | 1–262, полностью | SDAS, CT identity, populated migrations и squash |
| 24 | [[Archive/bmad/implementation-artifacts/5-5b-каскад-по-дереву]] | 1–272, полностью | Bulk светофор, partial fault isolation, cycle-safe fold |

### Порция 19–21 — 05.09.2026, Plane #770

Исполнитель: Кодекс Астра 6. Прочитано полностью; это история BMAD, не подтверждение текущего кода. 4.4: аудит внутри транзакции мутации, before до изменения, bulk N событий + summary; UUID entity_id сотрудника, целочисленный PK статуса в payload; возврат секондмента подавляет события обеих ног. Ревью уточнило: no-op подавлялся лишь для all-None, supplied-but-equal всё ещё эмитил; аудит увольнения — реальный пропуск E3, осознанно вынесенный в 4.7. Ручное зеркало action-кодов не доказывало closed-world.

8.6: credential отдельно от серверного Query-кэша прав; JWT и dev X-User-Id взаимоисключающие; отсутствие credential исторически давало 403, поэтому guard/enabled обязаны остановить запрос заранее. 401 обрабатывается обоими кэшами, 403 не logout; ошибку загрузки прав нельзя представлять запретом. Ревью исправляло права прежней личности при повторном login, protocol-relative return URL. Сброс только ['me'] — исторический контракт, не достаточное доказательство изоляции всех будущих кэшей. SessionStorage/JWT-вставка были YOLO-дефолтами с вопросами, а не независимым подтверждением безопасности.

6.2: номер документа — транзакционная строка-счётчик, не nextval: bootstrap get_or_create под unique/savepoint, затем обязательное перечитывание FOR UPDATE; лок до коммита вызывающего, rollback возвращает номер, новый год начинает с 1. Вызов вне atomic успевал создать нулевую строку до TransactionManagementError. Исторические concurrency-прогоны имели 3 passed И 3 teardown errors из-за append-only TRUNCATE; зелёный gate исключал их. Поздний QA добавил структурный судья FOR UPDATE, потому что удаление лока первоначально не краснило gate. Это важное различие между функциональным результатом и полнотой гейта.

| № | Источник | Прочитано | Смысл |
|---|---|---|---|
| 19 | [[Archive/bmad/implementation-artifacts/4-4-аудит-мутаций-статусов]] | 1–268, полностью | Транзакционный аудит 10 операций; реальный scope и no-op-оговорки |
| 20 | [[Archive/bmad/implementation-artifacts/8-6-auth-подключение]] | 1–255, полностью | Credential, Query-права, guards, 401/403 и смена личности |
| 21 | [[Archive/bmad/implementation-artifacts/6-2-documentsequence]] | 1–246, полностью | Нумерация, bootstrap/row-lock/rollback; неполнота обычного гейта |

- 2026-09-05, Plane #770. Прочитана 8.8 (228 строк). Печать в отдельном auth-route вне AppLayout, семантический HTML, print-классы и CSS скоуп. Глобальный preflight всё равно действует, поэтому типографика полная; @page остаётся глобальным исключением, старый FF требует ориентацию вручную. Проверка шрифта и computed styles нужна в браузере; удаление woff2 доказало зубастость. Flat-eslint override заменяет правило целиком: надо сохранять предыдущие запреты; CSS scanner мог глобально разрешить print-классы. ReuseExistingServer допускает smoke по устаревшему preview, gate вне e2e не подтверждает печать. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/8-8-печатный-каркас]] | 1–228 из 228 | Полностью. Изоляция печати, вендоринг kk-шрифтов, браузерные пробы и ограничения CSS/гейта. |

- 2026-09-05, Plane #770. Прочитана 6.5 (259 строк). Номерованный выпуск привязан к конкретной версии сдачи; повторная выдача читает файл, новая версия создаёт supersedes-цепь и не меняет старые байты. Submission→sequence порядок локов, одна atomic и flip-before-insert важны; actor без сервисного RBAC требует защищённого API-преемника. Schema_version строго int (bool не проходит). Проверяются и violations, и warnings: исходная фикстура проверяла обе сразу и скрывала неработающую warning-ветку. Файл до внешнего commit может остаться сиротой при rollback, признано историческим компромиссом. Номер/«взамен» первоначально только метаданные, не тело DOCX; выпуск первоначально DOCX-only и одно управление. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/6-5-выпуск-расхода]] | 1–259 из 259 | Полностью. IssuedDocument, целостность выпуска, amendment/supersedes, нумерация/локи и независимые ветки проверок. |

- 2026-09-05, Plane #770. Прочитана 8.7 (262 строки). В истории Mantine/preflight-off отменён 04.07 в пользу donor-shadcn/Tailwind3/preflight-on; старый EXPERIENCE требует хронологического чтения. Навигация скрывается по праву, но прямой URL отдельно защищается guard; logout остаётся доступным при ошибке прав. Линтер путей имел отдельные непроверенные path-каналы и template literal обход; произвольный hex остаётся валидным Tailwind и плагин его не ловил. JS-only размер не включает CSS, jsdom не подтверждает CSS-совместимость. Донорский ds-bundle JSX — re-export-заглушки, не исходники компонентов. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/8-7-роутер-routes-ts-и-layout]] | 1–262 из 262 | Полностью. Маршруты/guards/каркас, переход на shadcn, вендоринг и пределы линтеров путей/токенов. |

- 2026-09-05, Plane #770. Полностью прочитан EXPERIENCE (305 строк). Исторический спайн отделяет визуал донора от новой механики сдачи/конфликтов; единый портал, subtree-scope всех списков и агрегатов, один ConflictDialog, клавиатура+возврат фокуса, цвет всегда с текстом. 409 не всегда override: структурная неготовность отлична от soft, 422 hard без обхода. Разногласия с поздними стори оставлены явно: оптимистичный автосейв, heartbeat, счёт/ответственный светофора, async-генерация, личный кабинет. Не переносить эти ранние обещания на факт реализации или нынешний RAW-канон; правило last4-маскирования тоже историческое, не доказательство достаточной защиты ПД. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE]] | 1–305 из 305 | Полностью. IA/роли/рабочие потоки, клавиатура, ошибки и доступность, card-язык и открытые противоречия реализации. |

- 2026-09-05, Plane #770. Прочитана 6.9 (258 строк). Отдельная фоновая джоба имеет exit 0 даже при ошибках/диффах, в отличие от блокирующей CLI 1.8; поэтому зелёный exit не является паритетом. Watermark bootstrap, session advisory-lock и подневная atomic-персистенция важны; заказчик отдельно разрешил advance после ошибки ради живучести, авторетрай передан 7.8. No-baseline (включая rows:[]) прозрачен для green streak, error/blocking рвёт; pending_signature модельного объяснения не равна принятой подписи, серия не равна exit-criterion. Синтетический baseline, отсутствие запуска beat и реального контура явно отложены. Исправлены тихое усечение catch-up 31д, незащищённая recovery-ветка и future-date guard только в CLI; gap>366 всё ещё мог вечно halt без алерта. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/6-9-зерно-parallel-run]] | 1–258 из 258 | Полностью. Diff/Day реестр, watermark catch-up, не-блокирующая джоба, зелёная серия и границы паритета/подписи. |

- 2026-09-05, Plane #770. Прочитана 1.10 (313 строк). Исторический перф-спайк done на уровне аппарата, но физические FF100/4ГБ TTI/память/p95 не измерены. Прибор сначала не мог увидеть второй commit навигации, HUD сам искажал нагрузку; после исправления nav-перепрогон не состоялся, поэтому verified относится только к edit-1commit. Виртуализация зависит от viewport/overscan, не обязана всегда иметь 30 строк. Нужны разрешение таймера и достаточная выборка; target transpile и Chromium-smoke не подтверждают старый браузер. Это история методологии, не нынешний фронтенд-канон. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/1-10-спайк-перф-грид-на-целевой-машине]] | 1–313 из 313 | Полностью. Одноразовый Vite-грид, in-page измерение, открытый целевой замер и дефекты измерителя. |

- 2026-09-05, Plane #770. Прочитана 1.12 (280 строк). Реестры error/audit/WS и Decision Register делают закрытый мир проверяемым, но YAML-валидность/количество не доказывают полноту и резолвимость: ревью нашло пропуски, неверные секции и номера строк, замаскированные под якоря. Историческая DailySubmission — акт со снапшотом, не отчёт-документ и не отметка; partial unique даёт максимум одну current, не минимум одну. Перенесены вопросы годового первого номера, отмены AsyncJob, границ amendment и Clock против DB-default. Наличие файлов на диске не означало их поставку: blanket .gitignore скрывал обязательные реестры. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/1-12-инвентаризация-артефакт]] | 1–280 из 280 | Полностью. Истоки реестров, ARCH-решения, контракты submission/amendment/sequence/job/attachment, приоритеты и ошибки ссылок. |

- 2026-09-05, Plane #770. Прочитана 6.4 (275 строк). Генераторы чистые, получают один ExpenseDocumentData; документы XLSX/PDF показывают count+члены, CSV — только числа, ATTACHED нормализуется отдельно. PDF использует вендоренные kk/ru шрифты; cmap должен покрывать не только подписи, но и алфавит данных. Парсинг уникальных чисел устраняет коллизии дат, однако само присутствие токенов не доказывает правильную колонку PDF — это граница исторического теста. Строка PDF не разрывается между страницами: несколько насыщенных колонок могут громко упасть; 34ms одноcтрочного спайка не доказывает объёмный свод. CreationDate библиотеки недетерминирован, повторная выдача должна читать сохранённые байты. Историческое закрытие OQ-5 семантическое: донорский XLSX-шаблон отсутствовал. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/6-4-генераторы-xlsx-csv-pdf]] | 1–275 из 275 | Полностью. Три формата над контрактом DOCX, числа/члены, шрифты и PDF-переполнение, эквивалентность и семантическая сверка донора. |

- 2026-09-05, Plane #770. Полностью прочитана 1.8 (304 строки). Read-only расход питается одним StrengthReportService; прикомандированные вне списочного баланса. Донорский closed-end и VAPS half-open, fold отпусков/учёбы и inferred in-service требуют разных объяснений. Потеря данных никогда не объясняется автоматически как model: удалённая категория single_winner скрывала потерянных людей. Отрицательные head-count позже опровергли заявленную fail-safe гарантию; дубли даты/кода должны STOP, включая обе стороны сравнения. Прото timing по знаку не равен replay донора; расхождения вне реально сравнимых полей нельзя выдавать за охваченные. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/1-8-read-only-вывод-расхода-и-дифф-с-донором]] | 1–304 из 304 | Полностью. Read-only таблица/XLSX, многодневный эталон, категории timing/model/unclassified, обходы гейта и консервативная сверка. |

- 2026-09-05, Plane #770. Полностью прочитана 1.9, 324 строки. Артефакт `done` был разрешён заказчиком при НЕ проведённой контур-пробе и неотправленной A5-эскалации; LAN/Firefox/air-gap не доказаны localhost-проверкой. История семи ревью показывает опасность разноса патча скрипта и рунбука, несогласованного PORT, fail-fast, теряющего последующие диагностики, и смешения нескольких стори в одной ветке. Проверка hash рядом с tar не подтверждает происхождение; нужно различать целостность переноса, загружаемость tar и identity образа. Эти архивные обещания не считаются текущим фактом. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/implementation-artifacts/1-9-спайк-контур-проба]] | 1–324 из 324 | Полностью. Одностраничный бандл, путь носителя, открытый орг-гейт, семь ревью и передача реального прогона в E12. |

- 2026-09-05, Plane #770. Полностью прочитан brainstorming 25.05–01.06: 186 вопросов и эволюция несовместимых вариантов. Первоначальные PS-owned employee/HTTP, запрет своего users и hard-status-gating заменялись модульным монолитом, core/operations и soft-warning+override; нельзя выбирать удобный ранний абзац как действующее решение. Протокол сделал объект центром, развёл ежедневные дежурства и ОМ, поставил цепочку потребность→запрос→выделение; роли ОМД/ОРГД отложены на валидацию. Исторические оценки default 8, закрытость личной оценки, нагрузка >3 дней по >8 часов, абсолютный отдых против override остаются только контекстом — сверять с RAW/README. Исполнитель: Кодекс Астра 6.

| Источник (продолжение реестра) | Прочитанные строки | Статус и смысл |
|---|---:|---|
| [[Archive/bmad/brainstorming/brainstorming-session-2026-05-25-2256]] | 1–770 из 770 | Полностью. 186 вопросов интеграции, пересмотры владения/монолита/ролей, объект-центричная сверка протокола и этапы. |

- 2026-09-05, Plane #770. Прочитана 10.4. Исторический светофор потребляет контракт сервера, не выводит цвет родителя из детей; намеренно противоречивая фикстура обнаруживает самовольную клиентскую свёртку. 400 узлов получаются одним запросом, свёрнутые ветки не монтируются; фильтр использует отдельное эффективное раскрытие, а не мутирует ручное. Ревью поймало обратное действие кнопки «Свернуть» на авто-раскрытой ветке. Отброшенное серверное эхо business_date и дата, застывающая через полночь, остались LOW; отдельные преемники нужны для responsible/drift и счёта готовности, отсутствующих в API. При сбое polling прежние данные остаются с баннером ошибки. Исполнитель: Кодекс Астра 6.

- 2026-09-05, Plane #770. Прочитана 11.5. WS-флаг выключает только сигнал: Notification должен сохраняться, возвращаться вызывающему и читаться по REST; иначе останавливается catch-up бизнеса. Исторический тест должен доказывать отсутствие обращения к layer, поскольку общий catch уже скрывает сбой; consumer при этом может обратиться к layer ещё до своего connect, поэтому обещание «Redis вообще не трогается» относится только к publish. Identity проверяется раньше флага, для валидного клиента accept→close(4503) делает выключение различимым браузеру. Polling/возврат на WS и операторский runbook — отдельные преемники, не подтверждены статусом этой стори. Исполнитель: Кодекс Астра 6.

- 2026-09-05, Plane #770. Полностью прочитана 10.3. Главный исторический продуктовый дефект: кнопка «Сдать день» сохраняла только дельты; реальная сдача должна создавать DailySubmission даже без правок. Сдача блокируется несохранёнными дельтами, поскольку снапшот берётся с сервера. Категория и допустимые даты авторитетны из ответа; `event` сравнивает ростер+факты предыдущей сдачи, drift сравнивает derive-winners текущего снапшота и live — это разные функции. После 409 ревью поймало второй уровень активной кнопки подтверждения, переживавший рефетч. Отдельные передачи: серверный drift 10.3a/b, аннотация схемы 10.1c, право оператора на сохранение статусов, amendment 10.6. Сам локальный маркер имеет окно гонки после 201, поэтому не заменяет серверную проверку. Исполнитель: Кодекс Астра 6.

- 2026-09-05, Plane #770. Полностью прочитана 10.7. Печать исторически зеркалила DOCX: 5 фиксированных + 12 статусных колонок; ATTACHED берётся отдельным полем `+N`, в сумму списочного состава не входит. `/period/` отдавал только числа, имена/периоды ячеек оставались в 10.7a; статус done самой стори не означал полноту epic-AC. Нельзя переносить исторический приоритет «генератор выше UX» на нынешний канон RAW/README. Полезные риски ревью: frontend-derive дублирует серверный домен; непрозрачная OpenAPI-схема лишает tsc проверки контракта; JS date-тест под +05 мог оставаться зелёным на ошибке, браузер в отрицательной зоне обнаруживал сдвиг; jsdom не доказывает print CSS, шрифты и жирность; ссылка входа в работающий маршрут нуждается в отдельной поведенческой проверке. Исполнитель: Кодекс Астра 6.

- 2026-09-05, Plane #770. Полностью прочитана 11.3. Исторические инварианты: идемпотентное планирование на `error`+`close`, отмена таймеров и отцепление старого socket, монотонный курсор с grace и дедупом, epoch-проверка позднего REST-ответа после смены credential; первое подключение лишь инициализирует курсор. Ограничение — дочитка до 200 и отсутствие прикладного heartbeat. Пример различия тестовой и реальной среды: `close(4403)` до `accept()` виден ASGI-фейку, но браузер видит неуспешный handshake/1006; тест по невозможному browser-коду не подтверждает поведение. Историческое ревью устранило phantom reconnect позднего `close` заменённого socket. Исполнитель: Кодекс Астра 6.

- 2026-09-05, Plane #770. Полностью прочитана 11.4. Канон истории: БД/REST — истина, WS — сигнал; транспортом владеет ConnectionIndicator, хук подписывается и иммутабельно обновляет кэш, дедуплицирует пересечение каналов, сохраняет серверный порядок и не выдаёт дельту за полную историю. Отметка чтения тогда отсутствовала на бэке, а кэш предыдущего пользователя переживал смену credential и был отложен в 11.4b. В ревью важно перепроверить фактическое закрытие этой передачи и сброс пользовательских данных. В фокус-тесте даже строгий `activeElement === bell` был вакуумным без предварительного увода фокуса; красная проба это выявила. Числа общего гейта дрейфовали из-за соседней стори в общем дереве — требуется привязка замера к SHA и файлам. Исполнитель: Кодекс Астра 6.
