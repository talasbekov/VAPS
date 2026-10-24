# E30 — локальная ротация журналов контейнеров

Принято 2026-09-17. Source5e9f38d → main86c871eb53f20a9bb1629ea30d9d31a915186333. Независимое APPROVE: /tmp/qoldau-log-rotation-review/report.md; на main config test PASS, tree совпадает reviewed source, status clean.

Все семь production Compose services, включая migrate, явно используют json-file с max-size10m/max-file3. Это приблизительно30MiB на контейнер; docker compose logs сохраняется. Настройка применяется при будущем создании/пересоздании контейнеров, существующие логи не удалены и запущенные контейнеры не изменены. Persistent volumes не ограничиваются этой настройкой.

Это локальная ротация; централизованный сбор, доставка алертов и ограничения общего диска остаются отдельными задачами. Runtime/deploy не выполнялись. Проверка использует только disposable Compose copy и synthetic environment, не deployment .env.
