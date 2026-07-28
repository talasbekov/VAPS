PYTHON  := .venv/bin/python
RUFF    := .venv/bin/ruff
PYTEST  := .venv/bin/pytest

.PHONY: gate test-full e2e schema golden-update parallel-run-diff migrate-rehearsal

# Story 8.3: единственная команда обновления бэк-половины контракта (ARCH-FE-011).
# Regen in place; drift ловит pytest-тест test_schema_drift.py внутри gate.
# После изменения API: make schema && (cd ../../frontend && npm run generate:api).
# VAPS_DB=postgres обязателен: схема зависит от DB-бэкенда (int32-границы
# IntegerField у Postgres vs int64 у SQLite), контракт = целевая БД (ARCH-DATA-020),
# и gate гоняет drift-тест именно под postgres. Живая БД НЕ нужна — интроспекция
# статическая, docker не поднимается.
schema:
	@test -x $(PYTHON) || { \
		echo "schema: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	VAPS_DB=postgres \
	VAPS_DB_NAME=vaps \
	VAPS_DB_USER=vaps \
	VAPS_DB_PASSWORD=vaps \
	VAPS_DB_HOST=localhost \
	VAPS_DB_PORT=5433 \
	$(PYTHON) manage.py spectacular --file schema.yaml

# Story 6.8: ревью-гейтовая регенерация golden-эталона расхода (числа +
# нормализованный document.xml) НА МЕСТЕ из input.json. ЧИСТО — без БД (docker
# не поднимается, postgres env не нужен): те же чистые функции, что и consumer.
# Эталон меняет ЧЕЛОВЕК, читая git diff (зеркало schema + test_schema_drift).
# Опц. CASE=NNN — обновить один кейс.
golden-update:
	@test -x $(PYTHON) || { \
		echo "golden-update: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	$(PYTHON) manage.py golden_update $(if $(CASE),--case $(CASE),)
	@echo "review the diff before committing: git diff -- apps/operations/submissions/tests/golden"

# Story 6.9: parallel-run diff catch-up job (расход VAPS vs замороженный донор).
# Beat-ready manual entrypoint (12.6 регистрирует в beat); NON-blocking — НЕ в
# `gate` (фоновый режим, не CI-гейт). Читает БД → нужен УЖЕ ЗАПУЩЕННЫЙ postgres
# (docker compose up -d --wait db) — цель БД сама НЕ поднимает. Опц.
# TODAY=YYYY-MM-DD (ручной/тестовый прогон: обрабатываются даты (watermark,
# TODAY], не раньше), BASELINE=path.
parallel-run-diff:
	@test -x $(PYTHON) || { \
		echo "parallel-run-diff: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	VAPS_DB=postgres \
	VAPS_DB_NAME=vaps \
	VAPS_DB_USER=vaps \
	VAPS_DB_PASSWORD=vaps \
	VAPS_DB_HOST=localhost \
	VAPS_DB_PORT=5433 \
	$(PYTHON) manage.py parallel_run_diff \
		$(if $(TODAY),--today $(TODAY),) $(if $(BASELINE),--baseline $(BASELINE),)

# Story 7.6 — репетиция дня X: EXPORT=<копия прод-выгрузки> обязателен.
# Полный импорт дважды подряд, замер времени, программная проверка
# идемпотентности (0 created на втором прогоне) — см.
# apps/migration_legacy/management/commands/migrate_rehearsal.py.
migrate-rehearsal:
	@test -n "$(EXPORT)" || { \
		echo "migrate-rehearsal: EXPORT=path/to/export.json обязателен"; \
		exit 1; \
	}
	@test -x $(PYTHON) || { \
		echo "migrate-rehearsal: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	VAPS_DB=postgres \
	VAPS_DB_NAME=vaps \
	VAPS_DB_USER=vaps \
	VAPS_DB_PASSWORD=vaps \
	VAPS_DB_HOST=localhost \
	VAPS_DB_PORT=5433 \
	$(PYTHON) manage.py migrate_rehearsal $(EXPORT) \
		$(if $(DAYS),--days $(DAYS),) $(if $(UNTIL),--until $(UNTIL),)

test-full:
	@test -x $(PYTHON) && test -x $(RUFF) && test -x $(PYTEST) || { \
		echo "test-full: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	@start=$$(date +%s); \
	VAPS_DB=postgres \
	VAPS_DB_NAME=vaps \
	VAPS_DB_USER=vaps \
	VAPS_DB_PASSWORD=vaps \
	VAPS_DB_HOST=localhost \
	VAPS_DB_PORT=5433 \
	VAPS_REDIS_URL=redis://127.0.0.1:6380/0 \
	HYPOTHESIS_PROFILE=full \
	timeout 1500 sh -c '\
		docker compose up -d --wait db redis && \
		$(PYTEST) \
	'; \
	status=$$?; \
	end=$$(date +%s); \
	if [ $$status -eq 124 ]; then echo "test-full TIMED OUT: exceeded 1500s budget"; fi; \
	echo "test-full duration: $$((end - start))s"; \
	exit $$status

gate:
	@test -x $(PYTHON) && test -x $(RUFF) && test -x $(PYTEST) || { \
		echo "gate: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	@start=$$(date +%s); \
	VAPS_DB=postgres \
	VAPS_DB_NAME=vaps \
	VAPS_DB_USER=vaps \
	VAPS_DB_PASSWORD=vaps \
	VAPS_DB_HOST=localhost \
	VAPS_DB_PORT=5433 \
	VAPS_REDIS_URL=redis://127.0.0.1:6380/0 \
	timeout 300 sh -c '\
		docker compose up -d --wait db redis && \
		$(RUFF) check . && \
		$(PYTEST) -m "not property and not concurrency and not slow and not golden" && \
		$(PYTHON) manage.py makemigrations --check --dry-run \
	'; \
	status=$$?; \
	end=$$(date +%s); \
	if [ $$status -eq 124 ]; then echo "gate TIMED OUT: exceeded 300s budget (NFR-8)"; fi; \
	echo "gate duration: $$((end - start))s"; \
	exit $$status

# Story 11.6a: единая точка входа для живого Playwright-сьюта (architecture.md
# §Make-цели: «make e2e | < 15 мин | Playwright 5 сценариев против compose»).
# НЕ переизобретает оркестровку frontend/playwright.live.config.ts — тот
# webServer-массив уже сам поднимает compose db/redis, гоняет `migrate` и
# стартует uvicorn; здесь `docker compose up -d --wait db redis` вызывается
# ЗАРАНЕЕ тем же паттерном защитной идемпотентности, что уже несёт `gate`, —
# чтобы 900-секундный бюджет считался от начала тестов, а не от поднятия
# Postgres с нуля.
#
# uvicorn остаётся ЛОКАЛЬНЫМ ПРОЦЕССОМ внутри playwright.live.config.ts, НЕ
# сервисом compose: docker-compose.yml сегодня несёт ровно db+redis, ни
# одного web-сервиса даже в зачаточном виде — заводить его сейчас означало бы
# городить топологию, которую прод-compose (Story 12.1, backlog) неизбежно
# переопределит. Адрес — «после 12.1», записано явно, не забыто.
#
# НЕ запускать в офлайн-контуре: там нет ни Playwright-браузеров, ни docker
# (установленный прецедент проекта — 8.8 Решение Д4, 9.9, playwright.config.ts,
# playwright.live.config.ts) — эта цель только для машины разработчика,
# дисциплиной релиза, а не CI (CI в проекте нет).
e2e:
	@test -x $(PYTHON) || { \
		echo "e2e: .venv not found or incomplete."; \
		echo "  run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'"; \
		exit 1; \
	}
	# Гвард на .venv, хоть эта цель сама $(PYTHON) не зовёт: playwright.live.config.ts's
	# webServer запускает .venv/bin/python manage.py migrate и .venv/bin/uvicorn —
	# без венва npm-скрипт упадёт своей собственной ошибкой глубоко внутри
	# Playwright-оркестровки, а не понятным сообщением здесь.
	@start=$$(date +%s); \
	timeout 900 sh -c '\
		docker compose up -d --wait db redis && \
		cd ../../frontend && npm run test:e2e:live \
	'; \
	status=$$?; \
	end=$$(date +%s); \
	if [ $$status -eq 124 ]; then echo "e2e TIMED OUT: exceeded 900s budget (architecture.md#L640)"; fi; \
	echo "e2e duration: $$((end - start))s"; \
	exit $$status
