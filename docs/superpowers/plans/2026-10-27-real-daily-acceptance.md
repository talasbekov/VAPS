# Real-backend daily expense acceptance

Continue the authorized non-OM workflow plan, Task 4, on a new empty synthetic
PostgreSQL database. Use actual JWT/NextAuth, Django, Redis, production Next and
nginx images. Never connect to working application data or install a release.

- [x] Record immutable images, owned resource labels and existing container metadata.
- [x] Migrate a new tmpfs database through operations 0154; seed three restricted
  identities, two departments, a directorate with a child division, two own
  employees, one foreign employee and one own vacancy.
- [x] Read the real roster and verify seven denied writes/foreign reads with 403.
- [x] Reproduce the confirmation-count defect: a directorate's direct row says
  one person, but submission saves its subtree of two. Browser attempt3 records
  the incorrect confirmation. An earlier selector failure used the fixture label
  instead of the native catalog label; preserve that evidence too.
- [x] Add a permanent regression, fix only the confirmation count, verify red/green.
- [x] Freeze the exact changed frontend and build a separate verified runtime image.
- [x] Complete browser cancellation, confirmation, pinned summary composition and
  explicit sending to duty through real APIs; verify persisted actors and scope.
- [x] Review, record evidence and remove only owned synthetic Docker resources.

Ruling: exact strength-report rows remain direct-division figures. Only the count
passed into the submission confirmation must include descendants, matching the
existing backend `build_division_snapshot(..., subtree=True)`. No backend or role
access change is needed. A new frontend image is acceptance-only; the delivered
27 October `.sh` remains the previously verified artifact and lacks this follow-up.

Evidence: `.local-review/real-daily-acceptance-20261027/`. Setup attempt1 migrated
successfully but lacked reference rights; its resources were removed and evidence
retained. Canonical permission codes and native status catalog were then seeded.
The department fixture uses the recognized `DEPARTMENT_EXPENSE_OFFICER` role with
exactly `status.view` and `daily_report.generate`, no global rights or forces grants.

Acceptance: `.local-review/real-daily-acceptance-20261027/acceptance.json`.
The frozen frontend gate passed 1074/1074 and production build in Docker with
network disabled. Verified image: `sha256:1926eee31e08df5991e0792326613746b0550ecbdb9c4e6e65393cb35b54b9b2`.
Backend source matched 1342 previously accepted files; no backend change.

Final browser attempt4 selected 31 October through the calendar, saved VACATION
for one own employee, cancelled without submission, confirmed a subtree of two,
assembled the department version, opened its pinned child composition and sent
explicitly. Seven real scope/permission denials returned 403; duplicate sending
returned 409. A read-only database audit verified two version1 submissions, the
actors and preserved snapshots. There were 70 successful UI business reads/writes,
four successful business POSTs and no browser JavaScript errors. Code review had
no findings. This is synthetic-domain acceptance, not a real duty officer session.

All six owned containers (including the finished preparation container), the
network and three new volumes were removed. The 14 pre-existing containers kept
their IDs/images/start times/mounts/ports. Cleanup initially compared the entire
running-container set too strictly: another Digital Twin session added five
containers. The owned removal had already finished; a separate read-only check
confirmed it, without retrying deletion or touching that unrelated session.
Prior setup/selector/regression failures remain recorded.

The 27 October delivered `.sh` still has SHA256
`74f170129cdf68c02a2e55115c17927cda0d25f9c8353bf80ad25a940380f932` and does not
contain this follow-up correction. Production and local installed stacks were not
updated. Keep the accepted source snapshot and evidence; package source follow-ups
separately after the next authorized integration check.
