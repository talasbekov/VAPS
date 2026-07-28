"""Story 12.2 — structural guards for deploy/scripts/bundle.sh.

Regex-over-file, not a live docker/npm run (pattern mirrors
apps/notifications/tests/test_ws_guards.py::
test_gate_starts_redis_and_points_the_suite_at_it): a real bundle build is
too slow/heavy for the gate. These tests catch the shape of the script
regressing silently — the live behaviour (two builds on one sha producing
an identical manifest.json, sha256sum -c passing) is verified by hand in
the story's Completion Notes, not here.
"""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_DIR.parent.parent
BUNDLE_SCRIPT = REPO_ROOT / "deploy" / "scripts" / "bundle.sh"


def _text():
    assert BUNDLE_SCRIPT.exists(), f"missing: {BUNDLE_SCRIPT}"
    return BUNDLE_SCRIPT.read_text(encoding="utf-8")


def test_bundle_script_exists_and_is_executable():
    assert BUNDLE_SCRIPT.exists()
    assert BUNDLE_SCRIPT.stat().st_mode & 0o111, "bundle.sh is not executable"


def test_strict_mode_is_set():
    assert "set -euo pipefail" in _text()


def test_dirty_tree_guard_precedes_docker_and_npm():
    # AC-6: a bundle built from uncommitted changes has no verifiable sha —
    # the guard must run before the first docker/npm call, not after.
    text = _text()
    guard_pos = text.find("git diff --quiet HEAD")
    docker_pos = text.find("docker build")
    npm_pos = text.find("npm run build")
    assert guard_pos != -1, "no dirty-tree guard found"
    assert docker_pos != -1 and npm_pos != -1
    assert guard_pos < docker_pos < npm_pos


def test_dirty_tree_guard_ignores_untracked_files():
    # `git status --porcelain` would trip on legitimate untracked files
    # (node_modules/, graphify-out/) — the guard must use `git diff HEAD`
    # instead, which only sees tracked-file drift. Only executable lines
    # count — the comment explaining the choice legitimately names both.
    code_lines = [
        line for line in _text().splitlines() if not line.strip().startswith("#")
    ]
    assert not any("git status --porcelain" in line for line in code_lines)
    assert any("git diff --quiet HEAD --" in line for line in code_lines)


def test_all_four_topology_images_are_saved_together():
    text = _text()
    save_line = next(
        (line for line in text.splitlines() if line.strip().startswith("docker save")),
        None,
    )
    assert save_line, "no `docker save` invocation found"
    required = ("${APP_IMAGE}", "${NGINX_IMAGE}", "${POSTGRES_IMAGE}", "${REDIS_IMAGE}")
    for var in required:
        assert var in save_line, f"{var} missing from docker save: {save_line!r}"


def test_image_tags_match_docker_compose():
    # AC-1's whole point breaks silently if these two files drift: the
    # bundle would carry different image versions than what
    # deploy/docker-compose.yml pulls on the target machine.
    compose_text = (REPO_ROOT / "deploy" / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    bundle_text = _text()
    for tag in ("nginx:1.27-alpine", "postgres:16", "redis:7-alpine"):
        assert tag in compose_text, f"{tag} missing from docker-compose.yml"
        assert tag in bundle_text, f"{tag} missing from bundle.sh"


def test_manifest_has_all_required_fields():
    text = _text()
    manifest_start = text.find("cat > \"${MANIFEST}\"")
    assert manifest_start != -1, "no manifest.json heredoc found"
    manifest_block = text[manifest_start:]
    for field in (
        '"sha"',
        '"built_at"',
        '"images"',
        '"migrations"',
        '"frontend_sha"',
        '"min_upgrade_from"',
    ):
        assert field in manifest_block, f"{field} missing from manifest.json heredoc"


def test_sha256sums_covers_exactly_the_three_artifacts_not_itself():
    text = _text()
    prefix = '( cd "${OUT_DIR}" && sha256sum'
    sums_line = next(
        (line for line in text.splitlines() if line.strip().startswith(prefix)),
        None,
    )
    assert sums_line, "no sha256sum invocation over the built artifacts found"
    inputs, _, redirect_target = sums_line.partition(">")
    assert "IMAGES_TAR" in inputs
    assert "FRONTEND_TAR" in inputs
    assert "MANIFEST" in inputs
    assert "SUMS" not in inputs, "sha256sums.txt must not hash itself"
    assert "SUMS" in redirect_target, "SUMS should be the redirect target, not an input"


def test_bundle_output_dir_is_gitignored():
    gitignore = (REPO_ROOT / "deploy" / ".gitignore").read_text(encoding="utf-8")
    assert "dist-bundle/" in gitignore


def test_spike_script_untouched():
    # 12.2 is the named successor to the spike, not a replacement — the
    # spike script documents spike 1.9's own history and stays as-is.
    spike = REPO_ROOT / "deploy" / "spike-1.9" / "build-bundle.sh"
    assert spike.exists(), "spike script must not be deleted"
    assert "спайк" in spike.read_text(encoding="utf-8").lower()
