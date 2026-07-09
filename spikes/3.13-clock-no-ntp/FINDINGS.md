# FINDINGS — часы без NTP (спайк 3.13)

> Дурабельный продукт спайка. Контур закрыт и **не имеет публичного NTP**
> ([architecture.md#L57]) — источник времени, таймзона и дрейф часов держатся
> вручную. Спайк **не строит код**: механизм «часы назад → стоп + алерт, данные
> целы» уже реализован (стори 1.3 + 3.12) и зелёный. Здесь — ЗНАНИЕ: каталог
> режимов рассинхрона, честный blast radius **незагарженного** прыжка вперёд и
> вход для будущих стори.
>
> Ветка: `claude/awesome-jemison-1319e0`, baseline `63842c3`. Дата: 2026-07-09.

**Легенда статусов:**
`VERIFIED` — проверено фактически на dev (команда/наблюдение, вывод ниже).
`code-traced` — прочитано в коде, отдельным прогоном не подтверждено.
`UNVERIFIED-pending-contour` — снимается только на реальном сервере контура (путь A).
`TODO` — заполнить позже.

**Решение гейта A5 (Task 0, 2026-07-09):** путь **B**. Эскалация
`escalation-A5-A8-owner-2026-06-16.md` в статусе `draft-pending-send`, чекбоксы
«Отправлено» / «Получен ответ» пусты → доступа в контур нет. Аппарат доказан на
dev (ниже); всё, что требует реальных OS-часов сервера, помечено
`UNVERIFIED-pending-contour` и делегировано админу / E12 по `RUNBOOK-clock.md`.

---

## Премиссы (зафиксированы)

1. **NTP в контуре нет** ([architecture.md#L57]) — by design, не недостача. Значит
   реальный ambient-режим отказа — не внезапный скачок (его даёт только рука
   админа), а **тихий накопительный дрейф** аппаратных часов.
2. **Бизнес-день = календарные сутки, полночь `Asia/Qyzylorda`.**
   `Clock.today_local()` = `now().astimezone(Asia/Qyzylorda).date()`
   [`clock.py#L37-L40`]. `TIME_ZONE = USE_TZ = VAPS_LOCAL_TIMEZONE`
   [`config/settings.py#L86-L88`]. Казахстан — единый пояс UTC+5 без сезонных
   переходов; канарейка это пиннит (ARCH-DATA-023).
3. **`Clock` — единственная легитимная точка чтения wall clock**
   ([architecture.md#L300]). Раннер читает её **ровно один раз** за прогон
   [`tasks.py#L70`]; ниже этой строки бизнес-дата — параметр.
4. **Эффекты материализации сегодня — документированный NO-OP**
   [`effects.py#L38-L47`]: `record_catchup_audit` (E4) и
   `emit_catchup_notifications` (E5) возвращают `None`. Единственная строка, куда
   раннер вообще пишет, — `core_watermarks.last_materialized_date`.
5. **Beat/Celery в проекте ещё нет** (E12). Сегодняшняя точка входа — только
   `manage.py catchup_status_effects` (cron или руками), **без аргументов**
   [`catchup_status_effects.py#L9`].
6. **Watermark движется строго вперёд.** `advance_watermark` отбивает
   `to <= current` через `ValueError` [`watermark.py#L93-L97`]. Тихий откат назад
   из кода **невозможен** — только руками через SQL (Вариант C рунбука).
7. **«Алерт» = ERROR-запись в лог + ненулевой exit команды.** Внешних каналов
   уведомлений в контуре нет [prd.md#L174]; GlitchTip DEFERRED
   ([architecture.md#L338]). Отдельной alert-абстракции в проекте нет.

---

## Каталог режимов рассинхрона

| # | Режим | Текущее поведение (код) | Доказано? | Остаточный риск (blast radius) | Что делает админ |
|---|---|---|---|---|---|
| **а** | **Перевод часов НАЗАД** (`today < watermark`, дата меняется) | `catchup_plan` пишет **ERROR** `clock behind watermark: catch-up halted` в логгер `apps.core.clock` с `extra={"watermark","today"}` и отдаёт `[]` [`clock.py#L90-L95`]. Раннер **отдельно** сравнивает даты и отдаёт `status="halted"` [`tasks.py#L87-L88`] — эффекты не вызваны, watermark не сдвинут. Команда → `CommandError` → ненулевой exit [`catchup_status_effects.py#L16-L19`] | `VERIFIED` | **Нет порчи данных.** Цена — **простой материализации** на всё время, пока `today < watermark`. Если watermark отравлен вперёд (режим д) — простой длится, пока реальное время не догонит | Понять причину. Часы отстали → §2 рунбука (правим вперёд, catch-up догонит сам, watermark не трогаем). Watermark отравлен → §3 Вариант C |
| **б** | **Прыжок ВПЕРЁД на `N` дней** (`today = watermark + N`) | **Гарда нет.** План `(watermark, today]` = `N` дат; за прогон обрабатывается `min(N, 400)`, при `N > 400` — `logger.warning` + `remaining` [`tasks.py#L92-L99`]. `CATCHUP_MAX_DAYS = 400` [`tasks.py#L42`] — **чанк-кап, а не hard-stop** (осознанное Решение C стори 3.12). Следующие прогоны продолжают, пока `watermark == today` | `VERIFIED` (характеризация N=3; **числа `⌈N/CAP⌉` — тестом** `test_catchup_clock_drift.py::…_drains_over_ceil_n_over_cap_runs`, QA 2026-07-10) | **ГЛАВНЫЙ РИСК.** Материализуются **все `N`** «будущих» дней за `⌈N/400⌉` прогонов. Сегодня blast radius = **одна строка** `core_watermarks` (эффекты NO-OP) → бизнес-данные целы. **После E4 (4.1) и E5 (5.7)** — `N` дней ложного аудита и уведомлений за не наступившие даты, **и они никогда не переиграются**: watermark монотонен [`watermark.py#L93-L97`] | Детектить (§1), откатить часы малым шагом (§2), затем **осознанно** переравнять watermark (§3 Вариант C). Гарда в коде нет → см. «находка → стори» |
| **в** | **Тихий ДРЕЙФ без NTP** (накопительный, минуты→часы) | Автокоррекции нет — NTP отсутствует by design. `Clock.today_local()` просто верит wall clock [`clock.py#L37-L40`] | `VERIFIED` (`test_clock_drift_characterization.py::…_drift_inside_the_day_never_moves_the_business_date`, QA 2026-07-10) | **Пока Δ не перебрасывает дату через полночь — вреда нет** (бизнес-домен оперирует календарными датами, не длительностями). Как только перебрасывает → режим (г) | **Периодическая сверка с доверенным эталоном ВНЕ контура** ≥1×/неделю (§1). Автоматического drift-монитора нет → находка для E12 |
| **г** | **Дрейф/прыжок ЧЕРЕЗ ПОЛНОЧЬ** `Asia/Qyzylorda` (сдвиг на сутки, `N = 1`) | Частный случай (б) при `N = 1`. `today_local()` = `D+1`, реальный день ещё `D` → план `[D+1]` → день `D+1` материализуется, watermark → `D+1` | `VERIFIED` (порог 23:50 + 20 мин — `…_twenty_minutes_of_drift_before_midnight_flips_the_business_date`; тот же Δ в полдень безвреден — `…_the_same_twenty_minutes_at_noon_leaves_the_business_date_alone`; раннер — `…_drift_across_midnight_materializes_tomorrow_and_poisons_the_watermark`, QA 2026-07-10) | **Достаточно ошибки в МИНУТЫ у границы суток** (23:50 + 20 мин → уже `D+1`); большой прыжок не нужен. Последствия: (1) день `D+1` материализован на данных реального дня `D`, т.е. **на неполных данных**; (2) переиграть его нельзя — watermark монотонен; (3) после коррекции часов назад — **halt до ≤24 ч**, пока реальное время не дойдёт до `D+1` (затем `today == watermark` → `noop`, не halt) | Сверка часов **особенно у границы суток** (§1); порог тревоги — **близость к полуночи, а не величина Δ** |
| **д** | **`watermark` ВПЕРЕДИ реального дня** («отравлен вперёд») — состояние, а не событие | Следствие (б)/(г). Каждый прогон: `today < watermark` → `halted` + ERROR [`tasks.py#L87-L88`]. Из кода состояние **неисправимо**: `advance_watermark` двигает только вперёд [`watermark.py#L93-L97`] | `VERIFIED` (halt + выход в `noop`, когда реальное время догоняет: `…_poisoned_watermark_halts_until_real_time_catches_up_then_noops`, QA 2026-07-10; неисправимость — уже покрыта `test_watermark.py::test_advance_watermark_backwards_raises`, `…_to_same_date_raises`) | **Бессрочный простой** материализации: halt держится, пока реальное время не догонит отравленный watermark (дни→месяцы при большом `N`). Данные при этом **целы** — halt и есть защита | **§3 Вариант C рунбука** — единственная санкционированная ручная правка: `UPDATE core_watermarks SET last_materialized_date='<D_real>'`. **Пока эффекты NO-OP (2026) — безопасно** (откатывать нечего); после E4/5.7 — решение по ДАННЫМ |
| **е** | **Несовпадение tz** хост / контейнер / БД | Канон приложения — `Asia/Qyzylorda` [`config/settings.py#L86-L88`]. Контейнер живёт в **UTC**, dev-хост может быть `Asia/Almaty` (тоже +05) — сюрприз зафиксирован ещё 1.9 [`deploy/spike-1.9/RUNBOOK.md#L66-L71`]. Канарейка `test_tzdata_canary.py` пиннит `utcoffset(Asia/Qyzylorda) == +05:00` лето и зиму + `settings.TIME_ZONE` | `VERIFIED` (канарейка, 3 passed) | Расхождение **отображаемых** часов (5 ч хост vs контейнер) само по себе безвредно: `USE_TZ=True`, всё хранится в UTC, дата берётся через `astimezone(Asia/Qyzylorda)`. Реальный риск — **дрейф ВЕРСИИ tzdata** между образом / хостом / БД. **Слепое пятно канарейки:** она ассертит `settings.TIME_ZONE`, а `Clock` читает `settings.VAPS_LOCAL_TIMEZONE` [`clock.py#L24`] — сейчас обе `Asia/Qyzylorda`, но опечатка в `VAPS_LOCAL_TIMEZONE` оставит гейт зелёным при неверном `business_date`. **Слепое пятно ЗАКРЫТО QA-прогоном 2026-07-10:** `…_clock_resolves_the_business_date_through_vaps_local_timezone` исполняемо показывает сдвиг бизнес-даты на сутки при зелёной канарейке, а `…_vaps_local_timezone_is_pinned_to_the_canonical_zone` пиннит зону, которую `Clock` реально читает | Сверить `timedatectl` хоста, `date` в контейнере, `SHOW timezone` в БД (§1). Сверка версий tzdata при сборке бандла → E12 |
| **ж** | **`watermark is None`** (свежая БД) | `catchup_plan` отдаёт `[]` **молча, без алерта** [`clock.py#L88-L89`]. Раннер перехватывает раньше: `bootstrap_watermark(on=today)` → `status="bootstrapped"`, INFO-лог, ноль материализаций [`tasks.py#L73-L78`] | `VERIFIED` | **Не инцидент, а bootstrap.** Ловушка для читателя кода: `catchup_plan` отдаёт `[]` для **трёх** разных причин (`today < watermark`, `today == watermark`, `watermark is None`) → по пустому списку halt **не отличить**; раннер обязан сравнивать даты сам [`tasks.py#L84-L90`] | Ничего. **Но:** bootstrap ставит watermark на `today` — если часы врут **при первом старте**, система «рождается» с отравленным watermark. Сверить часы **до** первого запуска (§1, DO) |
| **з** | *(доп.)* **Под-суточный сдвиг НАЗАД без смены даты** (23:50 → 22:30) | Halt сравнивает **даты**, не моменты: `today < watermark`, обе `date` [`tasks.py#L87`] → при том же локальном дне **halt не срабатывает** | `VERIFIED` (halt не срабатывает — `…_sub_daily_backward_shift_inside_one_day_is_a_noop_not_a_halt`; `updated_at` идёт мимо `Clock` — `…_watermark_updated_at_is_written_by_the_os_clock_not_by_the_clock_service`, QA 2026-07-10) | Catch-up не затронут (он и не должен). Но `timezone.now()`-таймстампы идут **назад**: `Watermark.updated_at` (`auto_now=True`, [`core/models.py#L433`]) и `starts_at`/`ends_at` в [`core/api/views.py#L176,#L191,#L207`] пишутся **мимо `Clock`**, реальными OS-часами. AST-гард `test_no_wall_clock_reads_in_domain_layers` этого **не ловит** (`auto_now` — kwarg, не вызов) → **немонотонный timeline**, `updated_at` **недостоверен для форензики** инцидента. **Семейство уже кусалось:** `test_staffing_api.py::test_vacancies_endpoint` считал бизнес-дату как `timezone.now().date()` (UTC) и краснел каждую ночь 00:00–05:00 (+05); это списывали на «tz-флейк». Починено в QA-прогоне 2026-07-10 на `Clock.today_local()` | Малый шаг коррекции + пересверка (§2). При разборе инцидента **не доверять `updated_at`** — сверять с логами |

---

## Blast radius прыжка вперёд — числами (главная находка ветки)

Пусть `watermark = W`, часы прыгнули на `N` дней вперёд: `today = W + N`.

1. **План** `(W, today]` = **`N` дат** [`clock.py#L96-L97`].
2. **За один прогон** обрабатывается `min(N, 400)` дней. При `N > 400`:
   `logger.warning("catch-up plan capped at 400 days; %s day(s) remaining")`,
   `remaining = N − 400`, watermark → `W + 400` [`tasks.py#L92-L99`].
3. **Кап — не стоп.** Следующие прогоны продолжают, пока `watermark == today`.
   Итог: материализуются **все `N`** «будущих» дней за **`⌈N/400⌉` прогонов**.
   Пример `N = 1000`: прогон 1 → 400 дней (`remaining=600`, wm=`W+400`);
   прогон 2 → 400 (`remaining=200`, wm=`W+800`); прогон 3 → 200
   (`remaining=0`, wm=`W+1000`). Три прогона, ноль halt-ов, ноль ошибок.
   **Не только `code-traced`:** формула проверена тестом
   `test_catchup_clock_drift.py::…_drains_over_ceil_n_over_cap_runs` (QA
   2026-07-10) — на `CAP=2, N=5` раннер сам сходится ровно за `⌈5/2⌉ = 3`
   прогона, `remaining` идёт `3 → 1 → 0`, ни один день не переигран, ни одного
   halt-а. Кап уменьшен только ради скорости; реальные 400 пиннит
   `test_plan_longer_than_cap_is_chunked_and_warns`.
4. **Верхнего sanity-потолка на `N` нет.** Аргумента `--today` у команды нет
   [`catchup_status_effects.py#L9`] — и он бы всё равно не помог: beat-путь читает
   `Clock.today_local()` [`tasks.py#L70`], а не CLI.
5. **Blast radius СЕГОДНЯ ограничен:** `materialize_day_effects` — NO-OP
   [`effects.py#L38-L47`]. В БД меняется **только**
   `core_watermarks.last_materialized_date` (доказано тестом
   `test_real_run_writes_nothing_but_the_watermark`
   [`test_catchup_materialization.py#L104`]). Forward-jump **отравляет watermark,
   но не портит бизнес-данные**.
6. **Дни не переиграются никогда.** `advance_watermark` отбивает откат
   [`watermark.py#L93-L97`], поэтому «будущие» дни, посчитанные на сегодняшних
   данных, при наступлении реальной даты уже помечены как материализованные
   (`today == watermark` → `noop`). Ошибка **фиксируется**, а не самоисправляется.
7. **Коррекция часов назад** → `today_real < watermark` → **halt**
   [`tasks.py#L87-L88`], и он держится, пока реальное время не догонит отравленный
   watermark: **`N` дней простоя** (для `N = 1000` — почти три года). Выход —
   §3 Вариант C рунбука. **Это и есть цена forward-прыжка.**
8. **Когда риск станет настоящим:** заполнение сеймов — **E4 (стори 4.1,
   `AuditLog`)** и **E5 (стори 5.7, уведомления)**. До этого момента процедура
   восстановления дёшева (откатывать нечего) — **поэтому рунбук пишется сейчас**.

---

## Что доказано на dev (`VERIFIED`, 2026-07-09)

Все команды — из `Backend/VAPS`, с окружением гейта
(`VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433`).

| # | Проверка | Команда | Фактический вывод |
|---|---|---|---|
| 1 | Backward-halt в чистой функции + `watermark is None` без алерта | `pytest apps/core/tests/test_clock.py -k "behind_watermark or none_watermark"` | **2 passed**, 16 deselected |
| 2 | Backward-halt в раннере **и** в команде | `pytest apps/operations/statuses/tests/test_catchup_materialization.py -k "halted or halts"` | **2 passed**, 17 deselected (`test_clock_behind_watermark_halts_and_alerts`, `test_management_command_exits_nonzero_when_halted`) |
| 3 | tzdata-канарейка | `pytest apps/core/tests/test_tzdata_canary.py` | **3 passed** (лето +05:00, зима +05:00, `settings.TIME_ZONE`) |
| 4 | Точная форма алерта | `python -c` с перехватом `logging.getLogger("apps.core.clock")`, `catchup_plan(watermark=2026-06-10, today=2026-06-05)` | `plan=[]`; `logger=apps.core.clock`; `level=ERROR`; `message=clock behind watermark: catch-up halted`; `extra.watermark=2026-06-10`; `extra.today=2026-06-05`; **1 запись**. Затем `catchup_plan(watermark=None, …)` → `[]`, число записей **не выросло** (алерта нет) |
| 5 | **Forward-jump не загаржен** (характеризация, AC-6) | `pytest apps/operations/statuses/tests/test_catchup_materialization.py -k "characterization"` | RED-проба с `assert result.status == "halted"` → **failed**: `AssertionError: assert 'ok' == 'halted'`. Затем тест зафиксировал фактическое поведение → **1 passed** |
| 6 | Ноль регрессий в файле | `pytest apps/operations/statuses/tests/test_catchup_materialization.py` | **20 passed** (было 19) |

> ⚠️ **Поправка к спеке:** `-k "halted"` (как записано в AC-3) выбирает **только
> один** тест — `test_management_command_exits_nonzero_when_halted`. Раннер-тест
> зовётся `…_halts_and_alerts`. Корректный селектор для обоих — `-k "halted or halts"`.

### Достроено QA-прогоном (`bmad-qa-generate-e2e-tests`, 2026-07-10)

Шесть строк каталога выше стояли `code-traced` — «прочитано в коде, прогоном не
подтверждено». Прогон превратил их в `VERIFIED`, **не тронув ни строки
продакшн-кода и не добавив ни одного гарда** (AC-11). Два новых файла:
`apps/core/tests/test_clock_drift_characterization.py` (7 тестов) и
`apps/operations/statuses/tests/test_catchup_clock_drift.py` (4 теста).
`test_catchup_materialization.py` остался ровно с одним тестом, как требует AC-6.

| # | Проверка | Команда | Фактический вывод |
|---|---|---|---|
| 7 | Все 11 новых тестов | `pytest apps/core/tests/test_clock_drift_characterization.py apps/operations/statuses/tests/test_catchup_clock_drift.py` | **11 passed** in 1.41s |
| 8 | **Тесты умеют краснеть** (мутационная проба на прод-коде, восстановлен через `git checkout`) | M1: убрать `extra=` из алерта · M2: `Clock` читает `settings.TIME_ZONE` · M3: внедрить forward-guard в раннер | M1 → упал `…_alert_is_structured_for_forensics`; M2 → упал `…_resolves_the_business_date_through_vaps_local_timezone`; M3 → упали **ровно два** forward-теста, backward-тесты целы ⇒ якорь для guard-стори работает |
| 9 | Гейт после прогона | `make gate` (из `Backend/VAPS`, 00:16 +05) | **1318 passed, 22 deselected**, `No changes detected`, 26 с, exit 0 (было 1307 + 11) |

> 🔴 **Побочная находка QA — не флейк, а баг того же семейства.**
> `test_staffing_api.py::test_vacancies_endpoint` брал бизнес-дату как
> `timezone.now().date()` — это дата в **UTC**, мимо `Clock`. Она расходится с
> `Asia/Qyzylorda` ежедневно с 00:00 до 05:00 (+05), запрос уходил на сутки
> назад, за `valid_from` слота, и `count` был `0`. Гейт краснел каждую ночь и
> списывался как «tz-флейк» (E5-ретро, AI-1). Причина — ровно та, что описана в
> режиме (з): чтение wall clock в обход `Clock`. Починено на
> `Clock.today_local()`; A/B-проба выполнена **внутри окна** (00:15 +05): с
> `Clock` — `1 passed`, с `timezone.now().date()` — `1 failed`, та же минута,
> та же БД.

**Не доказано на dev (`UNVERIFIED-pending-contour`):** реальный перевод OS-часов
на сервере контура (назад / вперёд / дрейф), наличие и поведение `timedatectl`,
tz хоста и БД контура, реальный вид ERROR-записи в журналах контура. Процедура —
`RUNBOOK-clock.md`; исполнитель — админ / E12 (гейт A5, путь A).

---

## Находка → куда передана → как

| Находка | Куда передана | Как |
|---|---|---|
| **Forward-jump без sanity-гарда**: `N` дней «будущего» материализуется за `⌈N/400⌉` прогонов; `--today` не помог бы (beat читает `Clock`) | `deferred-work.md` → стори **forward-bound-guard** (E3-refinement) / мониторинг **E12** | Сравнить `today` с разумным потолком либо монотонным полом **в раннере**, не в CLI. Потолок `N` — число, которое называет Bratan. Красно-зелёный якорь уже есть: `test_clock_jumped_forward_materializes_future_days_characterization` — при появлении гарда тест **инвертируется** |
| **`Watermark.updated_at = auto_now=True`** пишет `timezone.now()` мимо `Clock`; AST-гард не ловит | `deferred-work.md` | При перекосе часов `updated_at` недостоверен для форензики. Решение: писать через `Clock` либо явно задокументировать как «OS-время, не бизнес-время» |
| **`clock.override()` — ContextVar**, не пересекает границу треда | `deferred-work.md` (продлевает [`deferred-work.md#L20`]) | Актуально с приходом beat/Celery (E12): тесты «часы + воркер» потребуют иного механизма |
| **Дрейф ≤ суток через полночь** отравляет watermark на 1 день; переиграть нельзя | `deferred-work.md` + `RUNBOOK-clock.md#§1` | Порог тревоги — близость к полуночи, а не величина Δ |
| ~~**Слепое пятно канарейки**: ассертит `settings.TIME_ZONE`, `Clock` читает `settings.VAPS_LOCAL_TIMEZONE`~~ | **ЗАКРЫТО** QA-прогоном 2026-07-10 | Зона, которую `Clock` реально читает, запиннена (`…_vaps_local_timezone_is_pinned_to_the_canonical_zone`), а сам сдвиг бизнес-даты при зелёной канарейке показан исполняемо (`…_clock_resolves_the_business_date_through_vaps_local_timezone`) |
| **`views.py` пишет `starts_at`/`ends_at` через `timezone.now()`** мимо `Clock` (режим з) | `deferred-work.md` | Немонотонный timeline при под-суточном сдвиге назад; закрыть при переносе view→сервис (E2/E4) |
| 🔴 **`timezone.now().date()` = UTC-дата мимо `Clock`** — реальный красный гейт каждую ночь (`test_staffing_api.py::test_vacancies_endpoint`), маскировался под «tz-флейк» | **исправлено** в QA-прогоне 2026-07-10; `deferred-work.md` (пересмотр записи E5-ретро AI-1) | Тест переведён на `Clock.today_local()`. Урок шире одного теста: **`timezone.now().date()` — не бизнес-дата**. Стоит грепом проверять это выражение так же, как AST-гард проверяет `services.py`/`models.py` |
| **Реальный OS-clock контура** (все `UNVERIFIED-pending-contour`) | админ / **E12** (12.7 «прогон по рунбуку»), гейт **A5** | Исполнить `RUNBOOK-clock.md` на сервере, заполнить статусы |
| **Момент, когда Вариант C перестаёт быть бесплатным** | **E4 (4.1)**, **E5 (5.7)** | Заполняя сеймы `effects.py`, обеспечить идемпотентность эффектов (контракт 3.12) — иначе переравнивание watermark станет решением по данным |

---

## Границы спайка (анти-gold-plating)

**НЕ построено и построено быть не должно** (AC-11 стори 3.13):

- **forward-bound / sanity-guard** любого вида (`CATCHUP_SANITY_DAYS`, потолок на
  `N`, монотонный пол) — это **находка**, а не задача спайка. Потолок обязан
  назвать Bratan; beat-путь требует дизайна, а не однострочника;
- аргумент `--today` у `catchup_status_effects`;
- Celery / beat-schedule / worker+beat контейнеры (**E12**);
- реальный аудит (**E4/4.1**) и уведомления (**E5/5.7**);
- мутация lifecycle-состояний — **запрещена** ([architecture.md#L298], derived);
- таблица материализации эффектов; изменение `CATCHUP_MAX_DAYS`;
- NTP-сервер / `chrony` / `systemd-timesyncd` в контуре — **организационное
  решение заказчика/админа**, не код;
- прогон на реальном контуре (гейт A5, путь B);
- правка `deploy/spike-1.9/RUNBOOK.md` (его §4 уже указывает на 3.13).

**Тронуто в коде (dev-story, 2026-07-09):** ровно один файл —
`test_catchup_materialization.py`, +1 характеризационный тест.

**Тронуто в коде (QA-прогон, 2026-07-10):** два **новых** тестовых файла
(`test_clock_drift_characterization.py`, `test_catchup_clock_drift.py`, 11 тестов)
+ однострочная починка `test_staffing_api.py` (UTC-дата → `Clock.today_local()`).

**Во всех случаях:** `clock.py`, `tasks.py`, `watermark.py`, `effects.py`,
команда и `test_catchup_materialization.py` **не изменены**; ни одного гарда не
добавлено (AC-11). Реестры `docs/registries/*.yaml` — без изменений (новых кодов
ошибок и событий нет). Миграций нет.
