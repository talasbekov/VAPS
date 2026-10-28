# Assistant AI connection and single-file production delivery

> Execution: parallel frontend/backend implementation; root integrates and verifies the release. Use test-driven-development and verification-before-completion.

**Goal:** Admin can configure and test the OM assistant's intranet model in Smart, and transfer the accepted update as one Linux .sh while retaining production data.

**Approved design:** Existing administration contains an AI connection screen/card. Provider disabled/OpenAI-compatible/Ollama, URL, model, masked key, Check connection and Save. Ordinary users do not manage connection settings. A new empty singleton table stores settings; no production endpoint/key is seeded. Existing local Ollama environment remains fallback before a saved setting exists. OpenAI-compatible provider uses chat/completions; responses are grounded through existing OM validation and permissions. Connection tests use the draft, never save or execute OM actions. Keys do not appear in responses/audit/errors; origin changes cannot silently reuse a saved key. Settings updates use a revision to prevent lost changes.

**Tech:** Django/DRF/PostgreSQL, Next.js, offline Docker images and guarded Python updater wrapped in self-extracting .sh.

## Work

- [x] Backend: red tests, singleton settings/API, redacted audit, permission and concurrency boundaries; OpenAI protocol alongside Ollama; focused API/provider tests.
- [x] Frontend: admin entry and compact form with loading/error/dirty/check/save states; role access, key preservation and check/save behavior tests.
- [x] Integration: review authorization, key handling, invalid/truncated/network responses; run appropriate full frontend/backend gates and browser checks on accepted source.
- [x] Extend reviewed migration graph allowance only for operations0148_assistant_connection; regression tests must reject missing/unknown migrations.
- [x] Freeze source and build offline backend/frontend images, retain accepted proxy; package exact graph and source hashes, no laptop DB/config/media.
- [x] Rehearse actual packaged migrations on isolated existing-data copy, preserve old row fingerprints; verify complete self-extracting .sh on Linux and independent review.
- [x] Record evidence and handoff; deliver one file and one command. Production install and real model connectivity are not claimed without a server run.

## Review focus

- Scoped department grants must not expose global connection settings or saved keys.
- A failed or stale connection check cannot be shown as a successful saved connection.
- Changing the model server must not silently send the old server's saved key to a new origin.
- Unavailable model or malformed JSON leaves manual OM work possible, without fabricated data.
- Updating existing installations preserves production settings and business data; missing new connection table is handled only by the reviewed migration.

Acceptance evidence: `.local-review/ai-connection-20261024`. Production installation and actual model connectivity remain operator steps, not completed claims.
