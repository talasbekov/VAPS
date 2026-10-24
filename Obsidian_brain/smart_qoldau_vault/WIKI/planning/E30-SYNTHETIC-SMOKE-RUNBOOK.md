# E30 — синтетическая проверка доступности

Принято 2026-09-17. Main `443bbfbab011423c4645c9eaa0f75bbc33b758e1`; independent APPROVE `/tmp/qoldau-smoke-review/followup2-report.md`. На main 19/19 tests, systemd verify, tree equality и clean status подтверждены. Ничего не установлено/включено на сервере.

Python standard library, Linux/POSIX signal deadlines. SMOKE_BASE_URL — обязательный origin, endpoint /v1/health. SMOKE_WEB_URL и SMOKE_WEB_MARKER задаются парой либо отсутствуют. SMOKE_CONNECT_TIMEOUT и SMOKE_TOTAL_TIMEOUT: 0 < seconds <= 5, defaults2/5. Общий бюджет двух запросов до10с; unit15с. Лимит ответа256KiB. Timer5мин + jitter до30с.

Exit: 0 success;2 config;3 health transport;4 health HTTP;5 health contract;6 web transport;7 web HTTP;8 web marker/body limit. Только фиксированные классификации, без URL/body в output.



### Purpose and safety boundary

The synthetic smoke performs only unauthenticated GET requests: exact `/v1/health`, plus an optional explicitly configured public web page. It does not follow redirects, retry, log response bodies/URLs, or touch logins/payments/data-changing endpoints.

### Manual invocation

После установки unit по инструкции ниже ручной запуск использует тот же EnvironmentFile без передачи URL/marker в аргументах:

```bash
systemctl start smart-qoldau-synthetic-smoke.service
systemctl status smart-qoldau-synthetic-smoke.service
```

Для ручного запуска без systemd оператор должен предоставить валидированные SMOKE_* переменные через доверенный механизм окружения и вызвать `python3 infra/scripts/synthetic-smoke.py` без аргументов. Не выполняйте systemd EnvironmentFile как shell-код: форматы отличаются. Не помещайте секреты в URL/marker.

### Opt-in installation outline

1. Create a locked, unprivileged `smart-qoldau-smoke` service account with no interactive login.
2. Place the checked-out runner at the path selected for the host and replace `/opt/CHANGE_ME/smart_qoldau` in the copied service unit.
3. Copy `synthetic-smoke.env.example` to `/etc/smart-qoldau/synthetic-smoke.env`; replace every placeholder. Quote environment-file values according to systemd syntax if the marker contains whitespace.
4. Copy the service and timer into the host's systemd unit directory.
5. Run `systemd-analyze verify` against the installed copies.
6. Run `systemctl daemon-reload` so PID 1 discovers the new or changed units.
7. Run the service once manually with `systemctl start smart-qoldau-synthetic-smoke.service`, then inspect `systemctl status` and the unit journal.
8. Only after a successful manual run, enable the schedule with `systemctl enable --now smart-qoldau-synthetic-smoke.timer` and verify the next trigger using `systemctl list-timers`.
9. To disable without deleting configuration, run `systemctl disable --now smart-qoldau-synthetic-smoke.timer`.

For a health-only schedule, omit `SMOKE_WEB_URL` and `SMOKE_WEB_MARKER` from the environment file. No service-unit edit is required.

### Failure triage

- Exit 2: deployment configuration is invalid; inspect placeholders/quoting, never paste secret-bearing URLs into logs or tickets.
- Exits 3/6: transport, DNS, TLS, refusal, or timeout. Compare from the same host and check network/proxy/service state.
- Exits 4/7: the endpoint answered but not with 200. A 3xx is deliberately a failure; correct the configured canonical URL rather than enabling redirect following.
- Exit 5: `/v1/health` returned 200 but not the exact healthy contract. Treat HTML, partial JSON, extra fields, or a proxy fallback page as failure.
- Exit 8: choose a stable server-rendered marker or investigate the public page/status/body-size limit.

Do not expand this smoke into authenticated flows, retries, alert delivery, or production remediation without a separate design/review.

## Ограничения

Нет alert channel или автоматического remediation; результат в process status/journal. Production домен/TLS/доступность и включение timer не проверены. Smoke не доказывает работоспособность платежей, push, media или пользовательских сценариев.
