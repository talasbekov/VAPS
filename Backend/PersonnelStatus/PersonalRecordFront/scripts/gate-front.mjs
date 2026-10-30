import { spawnSync } from "node:child_process";
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildOnly = process.argv.includes("--build-only");

function run(script, args = [], env = process.env, nodeArgs = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, join(root, script), ...args], {
    cwd: root, env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status ?? result.signal}).`);
}

try {
  if (!buildOnly) {
    run("node_modules/typescript/bin/tsc", ["--noEmit", "--incremental", "false"]);
    run("scripts/check-rewrites.mjs");
    run("scripts/check-shot-paths.mjs");
    run("scripts/tests/check-shot-paths.test.mjs", [], process.env, ["--test"]);
    run("scripts/tests/access-token-race.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/login-forwarding.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/ops-permissions-state.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/feedback-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/ops-protected-reads.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/service-analytics.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/strength-report-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/leadership-read-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/recon-materials-authority.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/report-authority.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/event-workflow-readability.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/event-stepper-visual.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/ambient-background.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/shared-map-recon.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/workflow-context-navigation.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/om-assistant.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/assistant-dock.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/assistant-chat.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/assistant-progress.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/force-collections-queue.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/security-events-filters.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/service-summary-retry.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/account-scope-choice.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/portal-workspace.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/portal-workspace-ui.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/navigation-sections.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/notifications-center.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/rating-notification-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/ops-write-authority.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/smoke-preflight.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/query-read-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/org-board-tree-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/access-user-role-pages.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/account-form-state.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/notification-report-download.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/status-document-download.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/dashboard-status-breakdown.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/status-manage-scope.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/workflow-action-gates.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/approval-decision.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/status-extension-availability.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/daily-report-range.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/summary-versions-rights.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/service-summary-current.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/expense-reminder-link.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/breadcrumbs-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/staff-pagination.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/staff-selection.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/mass-status-schema.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/mass-status-result.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/edit-status-schema.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/calendar-status-draft.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/map-search.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/map-viewport.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/map-asset.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/day-submission-current.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/portal-start.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/workdesk.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/resource-calculation.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/duty-workspace.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/duty-control.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/profile-next-shift.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/profile-next-access.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/profile-next-card.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/profile-next-panel.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/profile-next-link.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/expense-workspace-actions.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/expense-workspace-snapshot.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/department-workspace-role.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/workspace-daily-scope.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/employee-portrait.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/employee-service-profile.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/employee-media-rewrite.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/report-workflow.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/department-split-draft.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/status-action-date.test.cjs", [], process.env, ["--test"]);
    run("scripts/tests/status-related-division.test.cjs", [], process.env, ["--test"]);
    run("features/organization-structure/scene3d-layout.test.cjs", [], process.env, ["--test"]);
    run("features/organization-structure/scene3d-label-resolution.test.cjs", [], process.env, ["--test"]);
    for (const config of ["playwright.roles.config.ts", "playwright.uc-ref-adm.config.ts", "playwright.runtime.config.ts"]) {
      run("node_modules/@playwright/test/cli.js", ["test", "--list", "--config", config]);
    }
  }

  // Keep verification builds separate from a running development server.
  const lockPath = join(root, ".next-build.lock");
  const lock = openSync(lockPath, "wx");
  try {
    writeFileSync(lock, String(process.pid));
    run("node_modules/next/dist/bin/next", ["build"], {
      ...process.env,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "build-only-placeholder",
      NEXT_DIST_DIR: ".next-build",
    });
  } finally {
    closeSync(lock);
    rmSync(lockPath);
  }
} catch (error) {
  console.error(`[gate:front] ${error.message}`);
  process.exitCode = 1;
}
