# E30 — ручной сборщик эксплуатационных сигналов

## Назначение и приёмка

Однократный opt-in сбор четырёх агрегатов. Независимое APPROVE: source `4631d47f0ddc483cd63301c1d51c18323adee5c2`; исходный source `da34eb940071217db44dc3052536e3bcddb6a6a0`; main `b6d5415307edd6b4db853c9a0f1ad0a5edbb795e`. Отчёт ревью: `/tmp/qoldau-monitoring-collector-review/report.md`. Три замечания закрыты независимыми проверками. Полный контракт — [[E30-MONITORING-COLLECTOR-CONTRACT]].

Это ручное наблюдение, не доставка алертов, подтверждение здоровья продукта или финансовая сверка. Никакой scheduler/service не включён, развёртывание не выполнено.

## Запуск оператором

Нужны четыре явно выбранных действующих staff bearer-файла: verification — VERIFICATION_OPERATOR, settlement — FINANCE_CONTROL, push — действующий staff, no-show — QUALITY_TEAM. Автоматического SUPERADMIN fallback нет. Каждый файл принадлежит effective UID, имеет ровно mode0600, является обычным файлом без symlink и содержит одну ASCII bearer-строку размером не более8KiB. Секреты не передавать через argv/env/URL. Bearer имеет существующий ограниченный срок жизни; collector не выполняет login/refresh/2FA.

Шаблон (значения origin, времени и путей оператор заменяет; не является командой production-развёртывания):

```sh
python3 infra/scripts/operational-signals.py --base-url https://api.example.invalid --from 2026-09-17T00:00:00Z --to 2026-09-17T01:00:00Z --verification-bearer-file /secure/verification.token --settle-bearer-file /secure/finance.token --push-bearer-file /secure/push.token --noshow-bearer-file /secure/quality.token
```

Окно обязательно UTC-Z, from<to<=текущего времени, максимум24ч. Только HTTPS origin; проверка сертификата/имени обязательна. `--allow-http-loopback` только для явных literal-loopback fixtures. Proxyenv/netrc/cookies/redirects не используются. SSLKEYLOGFILE игнорируется без создания или изменения файла. Операторский SSL_CERT_FILE может задавать доверенный CA; insecure режима нет.

## Результат

Одна компактная строка JSON `qoldau-operational-signals/v1`: collectedAt, window, overall, sources verification/settle/push/noshow. Ошибка конфигурации: window:null, overall:unknown, все4sources collection:error/state:null/observedAt:null/metrics:{}, без дополнительного code. Никаких запросов при configuration failure.

Exit0=ok,1=alerting,2=unknown/configuration. Любая ошибка/stale/settle unknown имеет приоритет unknown; успешные источники сохраняются. Иначе verification/settle alerting даёт alerting; остальные успешные результаты дают ok. Push/no-show числа не создают alert. Ошибка/stale скрывает state/observedAt/metrics соответствующего источника. Stderr только безопасные фиксированные коды; не сохранять bearer-файлы, headers/raw bodies или свободный exception text в отчёты.

Verification отражает очередь >24ч. Settlement не определяет результат провайдера и не выполняет денежные действия. Push не доказывает provider acceptance/device delivery. No-show отражает подтверждённые outcome counts; никаких новых штрафов/процентов/порогов.

## Пределы и открытые условия

22с whole invocation включает configuration/credentials/trust/network;5с на источник включая DNS/TLS setup/header/body; socket connect/TLS timeout2с, blocking DNS ограничен5с, не2с. Ответ<=64KiB. observedAt должен попасть в [requestStart−60с,responseReceived+60с]; это техническая допустимая погрешность, не SLA. Linux/POSIX runtime соответствует проверенному окружению.

Перед unattended использованием отдельно определить durable least-privilege credentials/renewal owner, cadence, missing-run detection, хранение/retention, адрес доставки, acknowledgement/escalation, эксплуатационные пороги и проверить production connectivity/load. Все эти условия остаются открыты. Срез не меняет auth, БД, провайдеров и продуктовую политику.
