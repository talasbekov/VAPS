"""Story 12.5 — structural guards for deploy/scripts/deploy-rehearsal.sh
and deploy/CHECKLIST.md.

Regex-over-file, same rationale as the sibling deploy-script test files: a
real rehearsal needs a live compose stack and is exercised by hand in the
story's Completion Notes.
"""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_DIR.parent.parent
DEPLOY_DIR = REPO_ROOT / "deploy"
REHEARSAL_SCRIPT = DEPLOY_DIR / "scripts" / "deploy-rehearsal.sh"
INSTALL_SCRIPT = DEPLOY_DIR / "scripts" / "install.sh"
RESTORE_REHEARSAL_SCRIPT = DEPLOY_DIR / "scripts" / "restore-rehearsal.sh"
CHECKLIST = DEPLOY_DIR / "CHECKLIST.md"


def _text(path):
    assert path.exists(), f"missing: {path}"
    return path.read_text(encoding="utf-8")


def test_rehearsal_script_exists_and_is_executable():
    assert REHEARSAL_SCRIPT.exists()
    assert REHEARSAL_SCRIPT.stat().st_mode & 0o111


def test_strict_mode_is_set():
    assert "set -euo pipefail" in _text(REHEARSAL_SCRIPT)


def test_uses_its_own_isolated_compose_project():
    text = _text(REHEARSAL_SCRIPT)
    assert 'COMPOSE_PROJECT="vaps-deploy-rehearsal"' in text
    assert "-p deploy" not in text and '-p "deploy"' not in text


def test_reuses_install_sh_rather_than_reimplementing_the_pipeline():
    # Story 12.4's nightly-backup.sh/restore-rehearsal.sh deliberately do NOT
    # share code with install.sh (different caller contexts, documented).
    # This script is different: it exists specifically to rehearse
    # install.sh's OWN sequence, so calling it directly (not re-copying
    # pg_dump/docker load logic a third time) is the correct choice here.
    text = _text(REHEARSAL_SCRIPT)
    assert '"${SCRIPT_DIR}/install.sh"' in text


def test_install_sh_compose_project_is_override_able():
    # Prerequisite this script depends on: install.sh must let the caller
    # override COMPOSE_PROJECT, or reusing it under an isolated name is
    # impossible and a rehearsal would silently touch the real prod stack.
    text = _text(INSTALL_SCRIPT)
    assert 'COMPOSE_PROJECT="${COMPOSE_PROJECT:-vaps-install}"' in text


def test_installed_sha_file_is_also_override_able_and_overridden():
    # Self-caught before review: without overriding INSTALLED_SHA_FILE too,
    # a rehearsal would silently overwrite the REAL install's version-
    # tracking marker with the rehearsal's own sha.
    install_text = _text(INSTALL_SCRIPT)
    assert "INSTALLED_SHA_FILE:-" in install_text
    rehearsal_text = _text(REHEARSAL_SCRIPT)
    assert "export INSTALLED_SHA_FILE=" in rehearsal_text
    assert ".installed-sha-rehearsal" in rehearsal_text


def test_avoids_nginx_port_collision_with_a_live_prod_stack():
    # Review (Edge Case Hunter): install.sh brings up ALL 4 services with
    # no filter — a rehearsal on a machine already running the real
    # vaps-install stack would otherwise fight over host port 80.
    compose_text = _text(DEPLOY_DIR / "docker-compose.yml")
    assert '"${VAPS_NGINX_PORT:-80}:80"' in compose_text
    rehearsal_text = _text(REHEARSAL_SCRIPT)
    assert 'export VAPS_NGINX_PORT="18080"' in rehearsal_text
    install_text = _text(INSTALL_SCRIPT)
    assert "VAPS_NGINX_PORT" in install_text


def test_cleanup_runs_via_trap_even_if_install_sh_fails():
    # Review (Blind Hunter/Edge Case Hunter): without a trap, install.sh
    # failing partway (set -euo pipefail) would kill this script before an
    # inline cleanup step ever ran, leaving the isolated stack running.
    text = _text(REHEARSAL_SCRIPT)
    assert "trap cleanup EXIT" in text
    assert "cleanup()" in text


def test_every_step_is_timestamped():
    text = _text(REHEARSAL_SCRIPT)
    assert "log_step()" in text
    assert "date -u +%H:%M:%S" in text


def test_pauses_for_confirmation_unless_auto_mode():
    text = _text(REHEARSAL_SCRIPT)
    assert "confirm()" in text
    assert "VAPS_REHEARSAL_AUTO" in text
    assert "read -r -p" in text


def test_writes_a_log_file_under_rehearsal_logs():
    text = _text(REHEARSAL_SCRIPT)
    assert "rehearsal-logs" in text
    assert "LOG_FILE" in text


def test_header_disambiguates_from_the_other_two_rehearsal_scripts():
    text = _text(REHEARSAL_SCRIPT)
    assert "restore-rehearsal.sh" in text
    assert "12.7" in text or "RUNBOOK" in text


def test_tears_down_its_own_isolated_stack():
    text = _text(REHEARSAL_SCRIPT)
    assert "down -v" in text
    assert '"${COMPOSE_PROJECT}"' in text


def test_checklist_exists_and_has_version_before_after_and_secrets_section():
    text = _text(CHECKLIST)
    assert ".installed-sha" in text
    assert "manifest.json" in text
    assert "Секреты" in text or "секрет" in text.lower()


def test_checklist_has_a_step_table_with_time_columns():
    text = _text(CHECKLIST)
    assert "Начало" in text and "Конец" in text


def test_restore_rehearsal_untouched():
    # Confirms 12.4's file wasn't accidentally edited while wiring this one.
    assert RESTORE_REHEARSAL_SCRIPT.exists()
    assert 'COMPOSE_PROJECT="vaps-restore-rehearsal"' in _text(RESTORE_REHEARSAL_SCRIPT)
