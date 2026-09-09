# Protected Person Photo Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move protected-person photos out of public media, serve them only through an audited authorized endpoint, and enforce `catalog.view` together with the catalog grant's division scope.

**Architecture:** `OpsProtectedPerson.photo` will use a private filesystem storage rooted at `OPS_PRIVATE_STORAGE_ROOT`. The catalog will expose an API photo URL, while GET `/api/ops/protected-persons/{id}/photo/` checks the active catalog record, the caller's `catalog.view` grant, and any division scope derived from the protected person's linked event allocations; successful reads are audited before bytes are returned. A data migration moves existing public blobs, and the legacy `/media/protected-persons/photos/…` surface returns not-found.

**Tech Stack:** Django/DRF, Django migrations and `FileSystemStorage`, Pillow, pytest.

---

## Context and decisions

- The current `photo` field stores under `MEDIA_ROOT`; DEBUG and production media serving bypass DRF authorization.
- Existing document downloads already establish the private-root and audited-download pattern, including fail-closed scope handling.
- `catalog.view` remains the permission for protected-person records. Unscoped catalog grants retain global access. Scoped grants can read a photo only when at least one linked event allocation names a division inside the grant; a scoped grant cannot read a person with no verifiable event division.
- The response keeps `photoUrl` as a stable field, but it becomes the authorized API path rather than a public media path.
- No frontend behavior change is required beyond consuming the returned URL; direct image loads will carry the browser's existing authentication mechanism.

## Files to change

- Create `organization_management/apps/operations/protected_person_photo_storage.py` — private storage class.
- Create `organization_management/apps/operations/migrations/0115_protected_person_photo_private_storage.py` — field storage change and existing-blob migration.
- Modify `organization_management/apps/operations/models_gvo.py` — attach the private storage to `photo`.
- Modify `organization_management/apps/ops/gvo.py` — API URL generation, scope resolution, authorization, and audited byte lookup.
- Modify `organization_management/apps/ops/api/views.py` — GET photo action and permission boundary.
- Modify `organization_management/apps/operations/audit_service.py` — closed-world audit action for photo reads.
- Modify `organization_management/config/urls.py` — deny old public protected-person media paths before generic media serving.
- Modify `organization_management/apps/ops/tests/test_ops_gvo_catalog_refs.py` — RED/GREEN authorization, scope, private path, legacy URL, and audit coverage.
- Modify `organization_management/apps/operations/tests/test_audit_coverage.py` only if the closed-world audit coverage requires the new action to be exercised there.

## Steps

### Task 1: Add failing security regression tests

- [ ] Update the upload contract to expect `/api/ops/protected-persons/{id}/photo/`, not `/media/…`.
- [ ] Add a test that a catalog viewer receives the image bytes through the API and one `PROTECTED_PERSON_PHOTO_VIEWED` audit row.
- [ ] Add tests that anonymous users, authenticated users without `catalog.view`, and a scoped viewer outside the linked event division are denied.
- [ ] Add a positive scoped-view test for the linked event division, plus a fail-closed test for a scoped viewer when no event division can be established.
- [ ] Add a test that the old `/media/protected-persons/photos/<name>` URL does not serve the blob.
- [ ] Run the targeted tests and confirm they fail for the missing private route/authorization behavior rather than due to test setup.

### Task 2: Implement private storage and authorized delivery

- [ ] Add the private storage class and attach it to the model field without changing the upload validation or client filename hardening.
- [ ] Add the photo-read audit action to the closed action registry.
- [ ] Implement scope extraction from all three existing person-to-event relationships and `force_allocation[].departmentId`, with invalid/missing scope failing closed for scoped grants.
- [ ] Implement the API URL and service-level photo authorization; keep list/detail payloads free of public storage URLs.
- [ ] Add the GET action, serve the private file with safe content headers, and write the audit row before returning bytes.
- [ ] Add the migration that moves pre-existing protected-person files from `MEDIA_ROOT` to `OPS_PRIVATE_STORAGE_ROOT` and updates the stored name.
- [ ] Add the legacy media deny route before generic `static()` media serving.

### Task 3: Verify and finish

- [ ] Run the RED tests again and confirm all security regressions are GREEN.
- [ ] Run the full relevant backend gate under `scripts/pytest-lock.sh` and inspect the output.
- [ ] Run `git diff --check`, review the diff for only №1015 files, and perform a self-review against this plan.
- [ ] Record checks and decisions in the project vault with `Исполнитель: Кодекс Астра 6`.
- [ ] Commit only explicit №1015 files, push the branch, measure `next-server` RSS, and verify Plane state/comment.
- [ ] Move Plane №1015 to `Review`; do not move it to `On test` or `Done`.
