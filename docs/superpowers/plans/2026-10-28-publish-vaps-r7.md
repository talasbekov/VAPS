# Publish accepted Smart Josparlau R7 to VAPS

> Execute inline. Required independent export/security/evidence review is read-only; no implementation delegation.

**Authorization:** User explicitly requests uploading all latest Smart changes to https://github.com/talasbekov/VAPS. Publish the reviewed source to its main history and the accepted Linux installer as a release asset. This does not deploy to production or update local installed data.

**Scope:** Preserve VAPS `Backend/PersonnelStatus/*` mapping, its independent history, existing CI, and every unrelated file. Do not apply the Ko9n backend/frontend normalization. Publish current committed application/deployment/tests/public documentation and reviewed public implementation plans. Preserve dirty AGENTS/vault notes locally; exclude credentials, backups, runtime data, generated bundles/dependencies and external vault.

## Work

- [ ] Freeze latest VAPS main and accepted local R7/source evidence; review and commit only safe public plan changes.
- [ ] Prepare immutable export with a separate Git index, explicit managed-file ownership and refusal of unexpected upstream changes; inspect credential findings without reading local runtime secrets.
- [ ] Verify exact source/export hashes and unrelated-file preservation; run appropriate fresh checks on an isolated export snapshot and obtain independent read-only review.
- [ ] Push a dedicated branch without force, open a PR, confirm CI and merge the reviewed commit with a head lease. Reconcile a moving base before merging.
- [ ] Upload the unchanged accepted R7 installer/checksum/instructions to a GitHub Release; verify server size/digest and published URLs.
- [ ] Record publication/commit/PR/release/check results in existing canonical notes, preserving working data and all unrelated repository files.

## Constraints

- Source applications and accepted installer bytes remain unchanged by publication. Existing accepted native/build checks are inherited only when their exact source hashes match; distinguish fresh checks from carried evidence.
- Use `.local-review/publish-vaps-r7-20261028` for local evidence and the workspace `.build` for any export test snapshot. Do not switch the active source worktree to the export branch or delete old worktrees/builds.
- Use the existing VAPS exporter ownership rules. Never force-push, overwrite unrelated main changes or commit `.env`, database/media backups, local accounts, authentication traces, dependencies or the external vault.
- GitHub credentials are obtained only through the configured Git credential helper and kept in memory for this authorized repository. No credential values enter logs, manifests, patches or release assets.
- User's explicit upload request authorizes publication and integration; no repeated confirmation menu is required. The upload becomes concrete and reviewable before the final push/merge/release actions.
