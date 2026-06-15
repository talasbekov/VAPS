PYTHON  := .venv/bin/python
RUFF    := .venv/bin/ruff
PYTEST  := .venv/bin/pytest

.PHONY: gate test-full

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
		$(PYTEST) -m "not property and not concurrency and not slow" && \
		$(PYTHON) manage.py makemigrations --check --dry-run \
	'; \
	status=$$?; \
	end=$$(date +%s); \
	if [ $$status -eq 124 ]; then echo "gate TIMED OUT: exceeded 300s budget (NFR-8)"; fi; \
	echo "gate duration: $$((end - start))s"; \
	exit $$status
