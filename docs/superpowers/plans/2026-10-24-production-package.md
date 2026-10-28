# Production update package Implementation Plan

> Use superpowers:executing-plans for this bounded delivery task; independent review covers the migration allowance and final archive.

**Goal:** One offline ZIP of the accepted Smart application for the existing production LAN stack, retaining its own database and configuration.

**Architecture:** Reuse exact accepted Linux/amd64 backend/frontend and verified LAN proxy images. Package the existing guarded updater, extending only its reviewed migration allowance through operations0147. No database dump, local environment, demo data, data-import payload, infrastructure replacement or automatic production execution.

**Tech Stack:** Python standard library, Docker images, existing Django migration evidence/updater.

**Spec:** User request24.10: one file for production transfer; production database must remain production. Existing deployment contract in deploy/lan/update-with-migrations.py.

## Constraints and review focus

- Existing production settings, named volumes, users, role assignments, uploads and business rows remain authoritative.
- Only pending reviewed migrations run; unknown/older plans fail before stopping services.
- Migration0146 adds assistant tables;0147 adds calculation and unassigned role metadata, preserving custom role collisions.
- Actual old-backup preflight also requires employees0008, an AlterModelOptions-only label migration; permit it explicitly without weakening unknown-step rejection. The earlier blocked rehearsal/package is retained as evidence.
- Use accepted images with verified source/content identity; no gratuitous rebuild or application source changes.
- Archive and actual restored-copy rehearsal must be verified before delivery. No contact with production required.
- Retain backups, accepted artifacts and previous rejected cleanup targets.

## Work

- [x] Add regression coverage for0146/0147 allowed order, missing/unknown graph rejection and current release policy; observe failure, then extend the exact allowance.
- [x] Refresh update instructions for24.10, remove old data-import steps from current delivery instructions; run deployment tests and independent review.
- [x] Verify accepted images and source evidence, assemble one ZIP with manifest/checksums and exact migration graph, excluding data and local configuration.
- [x] Restore an existing pre-update local backup in isolated PostgreSQL; execute actual packaged transition checks and assert original rows/assignments preserved. Check current-schema path and tampered/unsupported package rejection where appropriate.
- [x] Verify final ZIP entries/hashes/images, record evidence and canonical handoff, deliver path plus short server commands. Production installation is not executed by this task.

Delivery complete: ZIP418533604bytes, SHA256ed2dc3ba99dcf6efdedfe92cbae05a1307e0d62476d53095389fd526040432d7.148Linux tests; real packaged migration/restore/collision checks passed. No production deployment.
