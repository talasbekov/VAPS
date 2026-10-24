# №1151 — независимое scoped review исключения query-токенов из журналов

Дата: 10.09.2026. Исполнитель: Кодекс Астра 6.

Scope: `66360b33..301e3754da273d8af6003ae9457c6db40fd056e1`, diff `QA-Audits/contour-2026-09-10/1151-review.diff`. Проверены только nginx format, Uvicorn filters/settings и включение helper в snapshot; прочитан report. Требование карточки — исключить query-токены из журналов nginx и ASGI при сохранении полезной диагностики. Текущий browser legacy WS без query; наблюдавшаяся утечка JWT не заявляется.

## Вердикты

**Spec compliance: PASS для кода на089a3867. Code quality: PASS.** Открытые Critical: 0. Important: 0. Minor: 0. I1 закрыт5ef686a8, I2 закрыт089a3867. Фактический rebuild/install, error redaction с безопасным маркером и stop/start с активным WS подтверждает контроллер.

## I1 — закрыт в5ef686a8; исходный Important: nginx error log сохранял полный query

Файл изменения: `deploy/contour/nginx.conf:6` (новый log_format), `:17` (access_log). Изменение санитизирует только access_log. Shipped `/etc/nginx/nginx.conf`, независимо прочитанный через разрешённый nested docker exec, содержит `error_log /var/log/nginx/error.log notice;`; контур его не перенастраивает.

Nginx1.28 `ngx_http_log_error_handler` формирует контекст ошибок из `r->request_line` целиком, затем upstream URI и referrer. Источник: [nginx release-1.28.0, ngx_http_request.c](https://github.com/nginx/nginx/blob/release-1.28.0/src/http/ngx_http_request.c#L3682), строки3707–3744. Новый `log_format contour_path` этой веткой не используется. При connection refused/timeout upstream на `/ws/operations/notifications/?token=…` токен остаётся в error log, даже когда access log и ASGI журнал уже очищены. Consumer действительно допускает token query: `organization_management/apps/operations/ws_auth.py` читает scope query_string через parse_qs. Это конкретный статический путь, а не факт утечки текущего browser JWT.

Требуемое исправление: обеспечить безопасную обработку nginx error-output, исключающую query из request/upstream/referrer до записи в долговременные/container журналы, сохранив время/уровень/причину/безопасный путь. Простое изменение access log_format не закрывает путь; простое глобальное подавление error_log ценой всей диагностики не рекомендуется. Проверку ошибок с реальными секретами не провоцировать; контроллер может подтвердить санитарную обработку безопасным маркером в разрешённой приёмке.

## Подтверждённые положительные результаты

- `ASGIPathOnlyFilter` обрабатывает string positional args, начинающиеся `/`, до форматирования сообщения и удаляет query через partition. `record.msg`, уровень, code/status, исключение и traceback не переписываются, записи не отбрасываются. HTTP и WS paths в actual Uvicorn передаются именно такими отдельными tuple args.
- Независимо прочитан shipped `UvicornWorker.__init__`: handlers uvicorn.error/access устанавливаются до загрузки Django; Config получает log_config=None. Django contour dictConfig назначает оба фильтра после bootstrap; повторной подмены log_config при `_serve` нет.
- Actual WebSocketProtocol.asgi_send пишет accepted/403/HTTP rejection через logger.error-канал Uvicorn с path+query отдельным arg. Фильтр на uvicorn.error необходим и присутствует; HTTP RequestResponseCycle.send использует uvicorn.access и покрывается вторым фильтром. Существенной потери диагностики в фильтрах нет.
- Оба logger выводят в bounded console/file handlers, propagate=False предотвращает повторную необработанную запись через root. Остальные logger diff не меняет.
- Nginx access format содержит method/uri/protocol, status/bytes/user-agent и timestamp/IP; request/request_uri/args/referrer отсутствуют. Формат объявлен в http-контексте подключаемого conf.d, применён в server, наследуется location.
- `git ls-files --error-unmatch` подтвердил tracking нового `organization_management/config/logging_filters.py`. Файл лежит под разрешённым backend prefix; ни path, ни extension не попадают под exclusions snapshot.py. Helper войдёт в source/backend и COPY backend image.

## Граница доказательств

Чтение локального diff/report/кода и разрешённый read-only nested docker exec с inspect/getsource и чтением статического nginx.conf; не печатались токены, environment или runtime request logs. Тесты, сборка, запросы, ошибки upstream, изменения кода или runtime не выполнялись. Inspect устаревающего WebSocketProtocol напечатал обычный UvicornDeprecationWarning; это не дефект рассматриваемого diff. Фактический runtime после сборки проверяет контроллер.


## 10.09.2026 — scoped fix2 review, 5ef686a8

Исполнитель: Кодекс Астра 6. Проверен только `QA-Audits/contour-2026-09-10/1151-review-fix2.diff`, конечный SHA `5ef686a821273fb413b416c3f0391a54f189706f`. Оценка только Critical/Important по residual redaction и lifecycle.

**I1 закрыт по коду.** Nginx server error_log явно направлен в stderr; исходный entrypoint и nginx запускаются child с fd2 в FIFO. Awk получает исходный stderr контейнера, заменяет все query-фрагменты в строке (request, upstream, referrer) на ?[redacted], сохраняя пути/причину/уровень/время, и fflush после каждой строки исключает ожидание большой буферной порции. Сырые сообщения не пишутся wrapper в обычный файл. Access log использует ранее проверенный path-only format. Исходный nginx entrypoint сохраняется, Docker CMD/ENTRYPOINT определены явно. Оба новых helper включены в explicit snapshot allowlist и COPY proxy image.

**Нормальная lifecycle-цепочка корректна.** FIFO создаётся в приватном mktemp directory с mode600. Reader запускается отдельно, supervisor не держит write descriptor, поэтому завершение nginx/его workers даёт EOF и позволяет drain. PID nginx-entrypoint сохраняется; стандартный entrypoint exec nginx оставляет тот же PID. TERM/QUIT/INT/HUP/USR1 пересылаются; wait_child отличает обработанный signal interruption по счётчику и продолжает ждать. Итог возвращает nginx status, а ошибка redactor после успешного nginx приводит к nonzero. Старые логгеры приложения и протоколы diff не меняет.

### I2 — закрыт089a3867; исходный Important: не ограничено graceful завершение активного WebSocket

Файлы: `deploy/contour/Dockerfile.proxy:7` (CMD), `deploy/contour/proxy-entrypoint.sh:19`, `:42` (QUIT и ожидание child); связанный `/ws/ proxy_read_timeout3600s`. `docker image inspect nginx:1.28-alpine --format '{{.Config.StopSignal}}'` независимо показал `SIGQUIT`; новый image наследует его. CMD не задаёт worker_shutdown_timeout, в compose нет собственной stop_grace_period.

QUIT корректно пересылается как graceful shutdown, но активное WS-соединение может оставлять workers живыми дольше стандартного срока docker stop. Nginx сам закрывает оставшиеся соединения при graceful shutdown только после заданного `worker_shutdown_timeout`; директива здесь отсутствует. Следствие — supervisor продолжает wait, Docker принудительно завершает контейнер, и обещанное ожидание actual exit/drain не завершается. Это относится к штатной ситуации «остановить proxy при открытом портале с WebSocket», а не к искусственному сбою redactor.

Основание: [nginx worker_shutdown_timeout](https://nginx.org/en/docs/ngx_core_module.html#worker_shutdown_timeout), default не задан, main context, после timeout nginx закрывает открытые соединения. Минимальный scoped вариант — добавить `worker_shutdown_timeout 5s;` в main globals аргумента nginx -g и оставить запас времени Docker для drain; директиву нельзя вставлять в текущий conf.d http/server context. Контроллер уже выполняет реальный stop/start с активным WS; reviewer его не запускал. Фактический exit137 пока не заявляется.

### Итог всего проверенного контура №1138

[[Ревью-1138-Офлайн-бандл]]: исходный bundle, nginx redirect fix и ingress topology ранее PASS. [[Ревью-1147-Suspense-api-сборка]]:10 wrappers PASS, лишняя11-я правка отменена. [[Ревью-1148-ASGI-bootstrap]] PASS; [[Ревью-1150-Redis-WebSocket-timeout]] PASS. №1151 access/Uvicorn и error redaction теперь PASS; открытый lifecycle I2 оставляет суммарное code-review disposition **CHANGES REQUIRED**, Critical0/Important1. Actual build6/install5, браузерный502 с безопасным маркером и stop/start контроллера остаются отдельными доказательствами и не подменяются этим анализом. Reviewer только читал diff/статические файлы, метаданные базового image и официальную документацию; ничего не тестировал, не собирал и не менял в runtime.


### Подтверждение I2 контроллером в том же заходе

10.09.2026. Исполнитель: Кодекс Астра 6. После статического review контроллер сообщил фактическое наблюдение на текущем proxy301e3754 с тем же inherited SIGQUIT и активным browser WS: docker stop --time10 → ExitCode137, StopSignalSIGQUIT; proxy немедленно восстановлен. Это подтверждает механизм I2 до нового wrapper, не является прогоном5ef686a8. Контроллер заказал минимальный main-context worker_shutdown_timeout5s в CMD и повторит остановку уже с wrapper+deadline. I2 открыт до scoped review исправления; reviewer в runtime не вмешивался.


## 10.09.2026 — финальный scoped fix3 review,089a3867

Исполнитель: Кодекс Астра 6. Прочитан только `QA-Audits/contour-2026-09-10/1151-review-fix3.diff`, SHA `089a38678dbe2f5ef6976ffd057defa7400f53d0`. Однострочное изменение Dockerfile.proxy добавляет `worker_shutdown_timeout 5s;` в строку main globals после `daemon off;`, передаваемую nginx через -g. JSON exec form сохраняет строку одним аргументом; wrapper передаёт аргументы через "$@", исходный nginx entrypoint их не теряет. Директива находится в правильном main context, daemon off и signal forwarding остаются прежними.

При graceful SIGQUIT nginx теперь получает5-секундный срок для закрытия оставшихся соединений, меньший Docker grace10секунд; остаётся запас для завершения master, EOF FIFO и drain redactor. Тем самым конкретная конфигурационная причина I2 устранена. Новых Critical/Important по этой строке нет. Сообщённый контроллером успешный nginx syntax check исполнителя принимается как его доказательство, reviewer команд не запускал. Реальный stop с активным WS на новом wrapper+deadline ещё проверяет контроллер.

**Финальный code-review verdict №1151: Spec compliance PASS, Code quality PASS, Critical0/Important0/Minor0.** Исторические I1/I2 выше сохранены для трассировки и больше не являются открытыми замечаниями. Предыдущий общий CHANGES REQUIRED по контуру ниже/выше заменён финальным disposition в [[Ревью-1138-Офлайн-бандл]].
