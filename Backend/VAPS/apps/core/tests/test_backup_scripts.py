"""Story 12.4 — structural guards for deploy/scripts/{nightly-backup.sh,
restore-rehearsal.sh} and deploy/systemd/vaps-backup.{service,timer}.

Regex-over-file, same rationale as test_bundle_script.py/
test_install_and_smoke_scripts.py: a real backup+restore run needs a live
compose stack and is exercised by hand in the story's Completion Notes.
"""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_DIR.parent.parent
DEPLOY_DIR = REPO_ROOT / "deploy"
BACKUP_SCRIPT = DEPLOY_DIR / "scripts" / "nightly-backup.sh"
REHEARSAL_SCRIPT = DEPLOY_DIR / "scripts" / "restore-rehearsal.sh"
SERVICE_FILE = DEPLOY_DIR / "systemd" / "vaps-backup.service"
TIMER_FILE = DEPLOY_DIR / "systemd" / "vaps-backup.timer"


def _text(path):
    assert path.exists(), f"missing: {path}"
    return path.read_text(encoding="utf-8")


def test_both_scripts_exist_and_are_executable():
    for script in (BACKUP_SCRIPT, REHEARSAL_SCRIPT):
        assert script.exists()
        assert script.stat().st_mode & 0o111, f"{script} is not executable"


def test_strict_mode_is_set_on_both():
    assert "set -euo pipefail" in _text(BACKUP_SCRIPT)
    assert "set -euo pipefail" in _text(REHEARSAL_SCRIPT)


def test_backup_and_rehearsal_use_distinct_non_generic_project_names():
    # Review-precedent from 12.3: a bare/generic "deploy" project name has
    # already collided with an unrelated project's volumes twice this
    # session. Restoring into the SAME project as live prod would also
    # destroy real data — the two scripts must use different names, and
    # neither may be "deploy".
    backup_text = _text(BACKUP_SCRIPT)
    rehearsal_text = _text(REHEARSAL_SCRIPT)
    assert 'COMPOSE_PROJECT="vaps-install"' in backup_text
    assert 'COMPOSE_PROJECT="vaps-restore-rehearsal"' in rehearsal_text
    for text in (backup_text, rehearsal_text):
        assert '-p deploy' not in text
        assert '-p "deploy"' not in text


def test_every_docker_compose_invocation_pins_the_project_flag():
    for path in (BACKUP_SCRIPT, REHEARSAL_SCRIPT):
        text = _text(path)
        invocations = [
            line.strip()
            for line in text.splitlines()
            if "docker compose" in line
            and '${COMPOSE_FILE}' in line
            and not line.strip().startswith("#")
        ]
        assert invocations, f"no docker compose invocations found in {path}"
        unpinned = [line for line in invocations if "-p " not in line]
        assert unpinned == [], f"{path}: docker compose call(s) missing -p: {unpinned}"


def test_latest_symlink_moves_only_after_both_artifacts_exist():
    # AC-3: an interrupted backup must never become the pointer
    # restore-rehearsal.sh trusts.
    text = _text(BACKUP_SCRIPT)
    dump_pos = text.find("pg_dump -U")
    tar_pos = text.find("tar czf /backup/private_storage.tar.gz")
    symlink_pos = text.find("ln -sfn")
    assert dump_pos != -1 and tar_pos != -1 and symlink_pos != -1
    assert dump_pos < symlink_pos and tar_pos < symlink_pos


def test_rehearsal_does_not_start_nginx():
    # AC-4: nginx would collide with the real prod stack's published :80.
    text = _text(REHEARSAL_SCRIPT)
    up_lines = [
        line
        for line in text.splitlines()
        if "up -d --wait" in line and not line.strip().startswith("echo ")
    ]
    assert up_lines, "no `up -d --wait` invocation found"
    assert not any("nginx" in line for line in up_lines)


def test_rehearsal_smokes_from_inside_the_app_container():
    # AC-4: smoke must hit 127.0.0.1:8000 directly (inside the container),
    # not go through nginx/an external port — that's the whole point of
    # skipping nginx above.
    text = _text(REHEARSAL_SCRIPT)
    assert "docker compose" in text and "exec -T app" in text
    assert "127.0.0.1:8000" in text


def test_rehearsal_tears_down_on_both_success_and_failure():
    text = _text(REHEARSAL_SCRIPT)
    assert "trap cleanup EXIT" in text


def test_rehearsal_restores_from_the_correct_backup_directory():
    text = _text(REHEARSAL_SCRIPT)
    assert "backups/latest" in text or 'BACKUP_ROOT}/latest' in text
    assert "postgres.sql" in text
    assert "private_storage.tar.gz" in text


def test_systemd_units_exist_and_mirror_the_7_0_pattern():
    service = _text(SERVICE_FILE)
    timer = _text(TIMER_FILE)
    assert "Type=oneshot" in service
    assert "ExecStart=" in service
    assert "OnCalendar=" in timer
    assert "Persistent=true" in timer
    assert "WantedBy=timers.target" in timer


def test_systemd_service_targets_the_backup_script_not_something_else():
    service = _text(SERVICE_FILE)
    assert "nightly-backup.sh" in service


def test_no_email_or_webhook_alerting_invented():
    # AC-5: architecture.md's own DEFERRED list excludes email/webhook
    # alerting — a script inventing one here would be undocumented scope
    # creep the story explicitly decided against.
    for path in (BACKUP_SCRIPT, REHEARSAL_SCRIPT):
        text = _text(path).lower()
        assert "smtp" not in text
        assert "webhook" not in text
        assert "sendmail" not in text
