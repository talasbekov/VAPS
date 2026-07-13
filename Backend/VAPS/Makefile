PYTHON  := .venv/bin/python
RUFF    := .venv/bin/ruff
PYTEST  := .venv/bin/pytest

.PHONY: gate test-full schema golden-update parallel-run-diff

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
	HYPOTHESIS_PROFILE=full \
	timeout 1500 sh -c '\
		docker compose up -d --wait db && \
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
	timeout 300 sh -c '\
		docker compose up -d --wait db && \
		$(RUFF) check . && \
		$(PYTEST) -m "not property and not concurrency and not slow and not golden" && \
		$(PYTHON) manage.py makemigrations --check --dry-run \
	'; \
	status=$$?; \
	end=$$(date +%s); \
	if [ $$status -eq 124 ]; then echo "gate TIMED OUT: exceeded 300s budget (NFR-8)"; fi; \
	echo "gate duration: $$((end - start))s"; \
	exit $$status
