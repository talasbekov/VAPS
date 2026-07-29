"""Story 12.3 — structural guards for deploy/scripts/{install.sh,smoke.sh}.

Regex-over-file, same rationale as test_bundle_script.py: a real
install/smoke run needs a live compose stack and is exercised by hand in
the story's Completion Notes, not here.
"""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_DIR.parent.parent
DEPLOY_DIR = REPO_ROOT / "deploy"
INSTALL_SCRIPT = DEPLOY_DIR / "scripts" / "install.sh"
SMOKE_SCRIPT = DEPLOY_DIR / "scripts" / "smoke.sh"
COMPOSE_FILE = DEPLOY_DIR / "docker-compose.yml"


def _install_text():
    assert INSTALL_SCRIPT.exists(), f"missing: {INSTALL_SCRIPT}"
    return INSTALL_SCRIPT.read_text(encoding="utf-8")


def _smoke_text():
    assert SMOKE_SCRIPT.exists(), f"missing: {SMOKE_SCRIPT}"
    return SMOKE_SCRIPT.read_text(encoding="utf-8")


def test_both_scripts_exist_and_are_executable():
    for script in (INSTALL_SCRIPT, SMOKE_SCRIPT):
        assert script.exists()
        assert script.stat().st_mode & 0o111, f"{script} is not executable"


def test_strict_mode_is_set_on_both():
    assert "set -euo pipefail" in _install_text()
    assert "set -euo pipefail" in _smoke_text()


def _code_only(text):
    # Comments discuss "docker load"/"pg_dump -U"/"docker compose" in prose
    # (crediting the spike, explaining the .env-sourcing gotcha, error-message
    # text) — matching those would find prose, not the real invocation. Anchor
    # on the actual argument-bound forms instead of bare substrings.
    return text


def test_sha256sum_check_precedes_backup_and_load():
    # AC-1: a broken archive must stop BEFORE backup or docker load.
    text = _code_only(_install_text())
    sha_pos = text.find('sha256sum -c "$(basename')
    backup_pos = text.find('pg_dump -U "${VAPS_DB_USER')
    load_pos = text.find('docker load -i "${IMAGES_TAR}"')
    assert sha_pos != -1 and backup_pos != -1 and load_pos != -1
    assert sha_pos < backup_pos < load_pos


def test_backup_happens_before_docker_load():
    # AC-2: the safety-net backup must run before anything mutates.
    text = _code_only(_install_text())
    assert text.find('pg_dump -U "${VAPS_DB_USER') < text.find(
        'docker load -i "${IMAGES_TAR}"'
    )


def test_installed_sha_read_before_overwrite():
    # AC-5: reading the PREVIOUS install must happen before persisting the
    # new one, or rollback has nothing to roll back to.
    text = _install_text()
    read_pos = text.find('cat "${INSTALLED_SHA_FILE}"')
    write_pos = text.find('> "${INSTALLED_SHA_FILE}"')
    assert read_pos != -1, "no read of INSTALLED_SHA_FILE found"
    assert write_pos != -1, "no write of INSTALLED_SHA_FILE found"
    assert read_pos < write_pos


def test_rollback_instructions_reference_previous_sha_not_generic_advice():
    text = _install_text()
    assert "ОТКАТ" in text
    assert "${PREV_SHA}" in text
    assert "VAPS_APP_SHA=${PREV_SHA}" in text


def test_compose_app_service_has_image_tag_for_loaded_tars():
    # AC-0: without `image:`, `docker compose up` on a source-less target
    # machine has nothing to reference from a `docker load`ed tar.
    compose_text = COMPOSE_FILE.read_text(encoding="utf-8")
    app_block_start = compose_text.find("\n  app:\n")
    assert app_block_start != -1, "no app service block found"
    next_service = compose_text.find("\n  postgres:", app_block_start)
    app_block = compose_text[app_block_start:next_service]
    assert "build:" in app_block, "app service must keep build: for dev use"
    assert 'image: "vaps-app:${VAPS_APP_SHA' in app_block


def test_install_exports_vaps_app_sha_before_compose_up():
    text = _install_text()
    export_pos = text.find("export VAPS_APP_SHA")
    up_pos = text.find('up -d --wait')
    assert export_pos != -1
    assert up_pos != -1
    assert export_pos < up_pos


def test_every_docker_compose_invocation_pins_an_explicit_project_name():
    # Review (Edge Case Hunter): a bare `docker compose` derives its project
    # name from the compose file's own directory ("deploy") — generic enough
    # to collide with unrelated projects that also have a deploy/ dir (this
    # session's own incident). Every invocation must pin -p explicitly.
    text = _install_text()
    # Real invocations, not rollback prose echoed for the operator to read
    # (those also mention docker compose -p, just unquoted inside a string).
    invocations = [
        line.strip()
        for line in text.splitlines()
        if "docker compose" in line
        and '${COMPOSE_FILE}' in line
        and not line.strip().startswith("echo ")
    ]
    assert invocations, "no docker compose invocations found"
    unpinned = [line for line in invocations if "-p " not in line]
    assert unpinned == [], f"docker compose call(s) missing -p: {unpinned}"
    # And the rollback instructions printed for the operator must ALSO carry
    # -p — an operator who copy-pastes them without it reopens the collision.
    rollback_lines = [
        line.strip()
        for line in text.splitlines()
        if "docker compose" in line
        and '${COMPOSE_FILE}' in line
        and line.strip().startswith("echo ")
    ]
    assert rollback_lines, "no rollback instructions found"
    assert all("-p ${COMPOSE_PROJECT}" in line for line in rollback_lines)
    code_lines = [
        line for line in text.splitlines() if not line.strip().startswith("#")
    ]
    bad = ("-p deploy " in line or '-p "deploy"' in line for line in code_lines)
    assert not any(bad), (
        "project name must not be the generic 'deploy' — that's the exact "
        "name that collided with an unrelated project"
    )


def test_backup_references_the_project_prefixed_volume_name():
    # Review (Edge Case Hunter, confirmed live): a bare `-v private_storage:`
    # reference doesn't match the volume compose actually creates
    # (<project>_private_storage) — docker silently auto-creates and tars an
    # unrelated EMPTY volume instead of failing, so the backup step must
    # reference the project-qualified name, not the bare one.
    text = _install_text()
    assert "-v private_storage:/data" not in text
    assert '-v "${COMPOSE_PROJECT}_private_storage:/data"' in text


def test_smoke_checks_all_six_api_contexts():
    text = _smoke_text()
    for path in (
        "/api/core/",
        "/api/operations/",
        "/api/audit/",
        "/api/notifications/",
        "/api/documents/",
        "/api/parallel-run/",
    ):
        assert path in text, f"{path} missing from smoke.sh"


def test_smoke_checks_health_and_login():
    text = _smoke_text()
    assert "/api/parallel-run/health/" in text
    assert "/admin/login/" in text


def test_smoke_exits_nonzero_on_any_failure():
    text = _smoke_text()
    assert "exit 1" in text
    assert "FAILED" in text


def test_spike_script_untouched():
    spike = DEPLOY_DIR / "spike-1.9" / "install-probe.sh"
    assert spike.exists(), "spike script must not be deleted"
    assert "спайк" in spike.read_text(encoding="utf-8").lower()
