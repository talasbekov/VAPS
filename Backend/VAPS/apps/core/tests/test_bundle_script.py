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
    # Story 13.3: two `docker save` lines now exist (full bundle vs
    # --hotfix's app-only branch) — this test is specifically about the
    # FULL-bundle path, so it targets the LAST occurrence (the --hotfix
    # branch's own guard, test_hotfix_flag_skips_base_image_pull_and_save,
    # covers the first).
    text = _text()
    save_lines = [
        line for line in text.splitlines() if line.strip().startswith("docker save")
    ]
    assert save_lines, "no `docker save` invocation found"
    save_line = save_lines[-1]
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
    manifest_start = text.find('cat > "${MANIFEST}"')
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


def test_manifest_has_hotfix_field():
    # Story 13.3: manifest.json must always declare hotfix true/false, not
    # just be silently absent on the full-bundle path.
    text = _text()
    manifest_start = text.find('cat > "${MANIFEST}"')
    assert manifest_start != -1
    assert '"hotfix"' in text[manifest_start:]


def test_hotfix_flag_skips_base_image_pull_and_save():
    # Story 13.3/AC-1: --hotfix must not pull/save nginx/postgres/redis —
    # only the app image, keyed on the same HOTFIX branch condition.
    text = _text()
    hotfix_branch_start = text.find('if [[ "${HOTFIX}" -eq 1 ]]; then')
    assert hotfix_branch_start != -1, "no --hotfix conditional found"
    else_start = text.find("\nelse\n", hotfix_branch_start)
    assert else_start != -1, "no matching else for the --hotfix conditional"
    # Slice EXACTLY the hotfix branch's body (up to `else`) — the FIRST
    # `if [[ "${HOTFIX}" -eq 1 ]]; then` is the save-images branch (a later
    # occurrence, in the manifest-digest section, is a separate branch).
    hotfix_block = text[hotfix_branch_start:else_start]
    assert "docker save" in hotfix_block
    assert "${APP_IMAGE}" in hotfix_block
    assert "${NGINX_IMAGE}" not in hotfix_block
    assert "${POSTGRES_IMAGE}" not in hotfix_block
    assert "${REDIS_IMAGE}" not in hotfix_block


def test_hotfix_requires_prior_bundle_marker():
    # Story 13.3/AC-2: --hotfix without a prior bundle (nothing to patch)
    # must fail loudly, not silently produce a null-upgrade-path bundle.
    #
    # Review (Edge Case Hunter, red-probe-confirmed): the original second
    # assertion (`"..." in text.lower() or "hotfix" in text`) was vacuous —
    # "hotfix" appears dozens of times regardless of whether this guard
    # exists at all (the flag name, docstrings, variable names). Deleting
    # the entire guard block left it passing. Pinned to the EXACT guard
    # condition and exit instead — a real regression (removed/weakened
    # guard) now fails this test.
    text = _text()
    assert "LAST_SHA_FILE" in text
    guard_pos = text.find('if [[ "${HOTFIX}" -eq 1 && ! -s "${LAST_SHA_FILE}" ]]; then')
    assert guard_pos != -1, "missing-marker guard condition not found verbatim"
    guard_block = text[guard_pos : guard_pos + 400]
    assert "exit 1" in guard_block, "guard does not actually exit non-zero"


def test_hotfix_requires_non_null_min_upgrade_from():
    # Story 13.3/AC-2: a --hotfix bundle that would still resolve
    # min_upgrade_from to null (same-sha rebuild) must be rejected.
    text = _text()
    assert 'prev_sha" == "null"' in text or 'prev_sha}" == "null"' in text


def test_full_bundle_behaviour_unchanged_without_hotfix_flag():
    # Regression guard: the non---hotfix path must still save all 4 images
    # (Story 13.3 must not have narrowed the default path).
    text = _text()
    else_branch_start = text.find('else\n  echo "[2/6] docker pull')
    assert else_branch_start != -1, "no full-bundle else-branch found"
    else_block = text[else_branch_start : else_branch_start + 700]
    for var in (
        "${APP_IMAGE}",
        "${NGINX_IMAGE}",
        "${POSTGRES_IMAGE}",
        "${REDIS_IMAGE}",
    ):
        assert var in else_block, f"{var} missing from full-bundle else-branch"


def test_spike_script_untouched():
    # 12.2 is the named successor to the spike, not a replacement — the
    # spike script documents spike 1.9's own history and stays as-is.
    spike = REPO_ROOT / "deploy" / "spike-1.9" / "build-bundle.sh"
    assert spike.exists(), "spike script must not be deleted"
    assert "спайк" in spike.read_text(encoding="utf-8").lower()
