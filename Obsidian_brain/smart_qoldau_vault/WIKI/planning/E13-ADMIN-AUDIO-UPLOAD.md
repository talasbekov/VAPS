# Admin content audio upload — minimal vertical-slice plan

**Goal:** Let `CONTENT_EDITOR` and `SUPERADMIN` upload and replace MP3 audio for draft meditation/music items from the existing admin editor, without accepting a storage key from the browser or weakening the private-content/premium boundary.

**Source and current state:** Task 6 of `/home/erda/Музыка/Obsidian_brain/smart_qoldau_vault/WIKI/plans/2026-08-26-план-E13-контент-и-самопомощь.md` specifies `POST /v1/admin/content/:id/audio`. The implementation already has `StorageService.putContentObject`, `deleteContentObject`, and a private `S3_BUCKET_CONTENT`; the missing pieces are that route/service behavior and the editor control. `ContentAdminService.create()` currently requires `payload.audioKey`, and `ContentEditorPage` exposes a manual private key field.

## Chosen lifecycle and contract

1. The editor creates an `MEDITATION` or `MUSIC` item as a **draft**, with `payload: {}` and `published: false`. This is the one narrowly allowed incomplete content shape. Article and breathing creation stay unchanged.
2. The editor is redirected to `/content/:id/edit`. It selects an MP3 and submits `multipart/form-data` field `file` to:

   `POST /v1/admin/content/:id/audio` → `200 ContentItem`

   The endpoint is protected by the existing `AdminJwtGuard`, `RolesGuard`, and `CONTENT_EDITOR | SUPERADMIN` role list. It has no request field for a key; it derives a new server-side key `content/<content-item-uuid>/<random-uuid>.mp3`, writes with `Content-Type: audio/mpeg`, and replaces `payload` with `{ audioKey: key }`.
3. The edit form displays upload state, not the key. A selected file replaces the existing audio through the same endpoint. Once an audio item has an attached file, the existing save/publish flow can publish it.
4. A new audio item cannot be created published, and `PATCH { published: true }` verifies the persisted audio payload has a nonempty `audioKey`. `POST`/`PATCH` payloads for audio must not accept `audioKey` from the browser. This removes the manual-key bypass while preserving already stored audio keys as valid persisted data.

This deliberately does not add presigned browser uploads, a public bucket, an object-key override, a migration, cover upload, transcoding, duration extraction, or a background orphan sweeper.

## Boundaries and proposed ingest policy

- Reuse the existing private content bucket; do not alter `StorageService`, S3 configuration, bucket policy, public media API, or premium checks. Client listening remains `GET /v1/content/:id/media`, which still runs `ContentService.assertAccess()` before issuing its 15-minute URL.
- Use memory-backed `FileInterceptor`, as the existing photo/document endpoints do. Proposed, explicit MVP bound: **25 MiB** (`25 * 1024 * 1024`). There is no existing audio cap; this is intentionally a dedicated limit, while document and photo endpoints demonstrate the required interceptor-side limit pattern. It supports roughly 25 minutes at 128 kbps without accepting unbounded files into Node memory.
- Accept **MP3 only** in this slice: claimed MIME must be `audio/mpeg`, and the buffer must begin with an MP3 ID3 header (`ID3`) or an MPEG audio frame-sync (`0xff` followed by a byte whose high three bits are `111`). Do not trust the MIME value alone; do not depend on the existing ESM-only `file-type` path, which `experts/file-signature.validator.ts` documents as Jest-incompatible. The stored extension and S3 content type are fixed to `.mp3`/`audio/mpeg` after this check.
- Invalid/missing/wrong-kind files return the existing `400 VALIDATION_FAILED`; multer’s interceptor limit reaches the existing global `413 FILE_TOO_LARGE` mapping. No new externally visible error code is needed.

## File map

| File | Change |
| --- | --- |
| `backend/src/content/content-admin.controller.ts` | Add documented multipart `POST ':id/audio'`; reuse existing admin guards/roles. |
| `backend/src/content/content-admin.service.ts` | Add draft/publish payload rules and `uploadAudio`; inject existing `StorageService`; delete uploaded/replaced audio on best-effort cleanup. |
| `backend/src/content/audio-file.validator.ts` | New small synchronous MP3 signature/MIME validator, modeled on `experts/file-signature.validator.ts`. |
| `backend/src/content/audio-file.validator.spec.ts` | New direct tests for ID3/frame-sync acceptance and MIME/header rejection. |
| `backend/test/content-admin.e2e-spec.ts` | Add route, role, validation, draft/publication, and replacement coverage; clean test objects from MinIO. |
| `backend/src/content/content-admin.service.spec.ts` | New mocked unit tests for S3/DB ordering and cleanup failure paths that an HTTP test cannot deterministically produce. |
| `admin/src/lib/api.ts` | Do not synthesize `Content-Type: application/json` when `init.body` is `FormData`; retain Authorization and the existing one-time 401 refresh/retry behavior. |
| `admin/src/lib/api.test.ts` | Prove multipart requests retain Authorization and omit a manually set JSON content type. |
| `admin/src/lib/content.ts` | Add `uploadContentAudio(id, file)` using `FormData` and `apiFetch`; retain CRUD APIs. |
| `admin/src/lib/content.test.ts` | Cover the multipart wrapper and unchanged CRUD wrappers. |
| `admin/src/routes/ContentEditorPage.tsx` | Replace the audio-key input/help copy with draft/upload/replace controls and the two-step audio creation flow. |
| `admin/src/routes/ContentEditorPage.test.tsx` | Cover draft creation with `{}`, selected MP3 upload, replacement, publish gating, and surfaced API failure. |

No Prisma schema/migration, storage service, client app, auth/session, payment, Redis, or cover-upload file changes are required.

## Backend task

### 1. Specify the new route before implementation

Extend `backend/test/content-admin.e2e-spec.ts` with audio fixtures and tests. Add `StorageService` from the app in the fixture only for cleanup: collect `payload.audioKey` from test content, call `deleteContentObject(key)` before direct Prisma cleanup, and then delete the test rows. This keeps a direct test cleanup from accumulating objects.

Add these executable cases:

1. An editor creates a valid audio draft with `payload: {}`, `published: false`; it is not client-visible.
2. `POST /v1/admin/content/:id/audio` with `.attach('file', mp3Buffer, { filename: 'calm.mp3', contentType: 'audio/mpeg' })` returns 200, yields a nonempty generated `payload.audioKey` ending in `.mp3`, and the key is not the filename or any request-provided value.
3. An audio draft rejects `PATCH { published: true }` before upload with 400 / `VALIDATION_FAILED`; it can publish after a successful upload.
4. A second successful upload changes the persisted key. The service-level test below verifies deletion of the original key without making this HTTP test inspect MinIO internals.
5. A missing file and a non-MP3/suspicious-byte buffer get 400 / `VALIDATION_FAILED`; a 25 MiB + 1 byte attachment gets 413 / `FILE_TOO_LARGE`.
6. An article/breathing item rejects the audio route with 400 / `VALIDATION_FAILED`; a verification-only admin gets 403 on the new route.
7. A direct audio `POST` payload carrying `audioKey`, an audio `PATCH` carrying `payload`, and an audio create with `published: true` each get 400 / `VALIDATION_FAILED`. This is the regression guard for no arbitrary-key override.

Do not assert availability through a public URL. The content bucket is purposely private, and the existing premium e2e suite owns client-access behavior.

### 2. Add the controller and MP3 validator

In `content-admin.controller.ts`:

- Import `UploadedFile`, `UseInterceptors`, `ParseFilePipe`, and `FileInterceptor`, plus Swagger multipart decorators used by `experts/documents.controller.ts`.
- Define one local `MAX_AUDIO_BYTES = 25 * 1024 * 1024` shared by the interceptor and `MaxFileSizeValidator` (the interceptor protects memory; the pipe documents/rechecks the boundary).
- Add `@Post(':id/audio')`, `@HttpCode(200)`, `@Roles(...CONTENT_ROLES)`, `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))`, `@ApiConsumes('multipart/form-data')`, and an API body declaring only binary `file`.
- Parse the UUID and pass the current admin ID and validated `Express.Multer.File` to `content.uploadAudio(...)`. Return its `ContentItem`, matching existing create/patch responses.

Create `audio-file.validator.ts` as a `FileValidator` equivalent to the existing document signature validator. It must return true only when `file.buffer` is nonempty, `file.mimetype === 'audio/mpeg'`, and either `buffer.subarray(0, 3)` is `ID3` or `buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0`. Its error message may name `audio/mpeg`; the global response contract remains `VALIDATION_FAILED`.

### 3. Implement persistence and failure semantics in `ContentAdminService`

Inject the existing `StorageService` into `ContentAdminService` and add `private readonly logger = new Logger(ContentAdminService.name)`, following the project’s existing service logger pattern.

Refactor payload checks into two concepts without weakening normal validation:

- `assertStoredPayloadShape(kind, payload)` retains today’s article/breathing checks and requires a nonempty string `audioKey` for a complete audio item. It validates stored state before publishing.
- Request handling treats audio specially: create accepts exactly `{}` only when `published !== true`; create rejects any request-supplied `audioKey`; patch rejects any `payload` for an audio kind. Existing stored keys are only changed by `uploadAudio`.

For `uploadAudio(adminId, id, file)`:

1. Fetch the item first. Return `CONTENT_NOT_FOUND` (existing 404) if absent; reject non-`MEDITATION`/`MUSIC` with `VALIDATION_FAILED` before calling storage.
2. Read the old key from the persisted payload; generate the new UUID key server-side. Call `storage.putContentObject(newKey, file.buffer, 'audio/mpeg')`.
3. Update only the content payload to `{ audioKey: newKey }`. On a database failure after the S3 write, attempt `deleteContentObject(newKey)`, log cleanup failure with item/key context, and rethrow the original database error. The old key and database row remain unchanged.
4. After a successful database update, delete the old key if one existed and differs. If that delete fails, log a warning and still return 200: the new item is correct and retrying cannot safely recover the old object without a tracking migration. This is the sole residual orphan case; it is observable in logs and intentionally does not trigger a schema/sweeper expansion.
5. Write an existing-style audit event such as `content.audio_uploaded` with `{ replaced: Boolean(oldKey) }`; do not put storage keys in the audit payload.

Update `remove()` after the database deletion to best-effort delete the item’s persisted audio key, logging rather than turning a completed deletion into an HTTP failure. This cleans files when an editor deletes content. It does not attempt `coverKey` cleanup, since cover storage has no uploader/ownership contract in this scope.

When `patch()` is asked to publish an audio item, validate the persisted complete payload before updating `publishedAt`. It must therefore reject an empty audio draft but continue to allow title/access/sort/publish changes after upload. Articles and breathing continue through their current payload-validation path.

### 4. Unit-test non-transactional S3/DB edges

Create `content-admin.service.spec.ts` with mocked Prisma, `StorageService`, clock, and audit service. Test exact ordering/observables:

- Storage put then failed DB update calls `deleteContentObject(newKey)` and rejects the DB error.
- Replacing an existing key updates Prisma before calling deletion of the old key.
- An old-key delete rejection does not reject the successful upload and is logged.
- `remove()` deletes the database row then requests deletion of its audio key; a deletion failure does not reverse/reject the completed remove.

## Admin task

### 5. Make the shared API client multipart-safe

In `admin/src/lib/api.ts`, detect `init.body instanceof FormData`. For form data, omit the default JSON `Content-Type` so the browser sets its multipart boundary; merge caller headers and Authorization exactly as today. Keep the same `init` on the existing one-time refresh retry, so upload calls receive the refreshed Authorization path rather than adding a separate upload/auth mechanism.

In `admin/src/lib/content.ts`, add:

```ts
export function uploadContentAudio(id: string, file: File): Promise<ContentItem> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch(`/admin/content/${id}/audio`, { method: 'POST', body: form });
}
```

The related tests assert that the same `FormData` instance is passed to `apiFetch`, and an `apiFetch` integration-style mock asserts `Authorization` exists but JSON `Content-Type` does not.

### 6. Replace the manual-key UI with the draft/upload/replace flow

In `ContentEditorPage.tsx`:

- Remove `audioKey` from `FormState`, `itemToForm`, and `payloadFor`; never render or send the private key.
- For a new audio item, make `payloadFor` return `{}`. Its primary submit creates a draft and navigates to that item’s edit route. It must not create/publish audio in one request. Disable or explain the publish checkbox while the item is new and has no uploaded audio.
- On the edit route derive `hasAudio` from the returned item only for UI state; do not show the value. Render `<input type="file" accept="audio/mpeg,.mp3">`, a clearly labeled “Загрузить аудио”/“Заменить аудио” button, progress/pending state, and success/error text. Call `uploadContentAudio(id, file)` only after a file has been selected; on success replace local item/form state from the response, clear the selected file, and enable the normal publish control.
- Existing audio items retain all non-media save fields. Their regular PATCH deliberately omits `payload`, so it cannot overwrite the uploaded key. Replacement is always the separate multipart action.
- If the upload fails, keep the saved draft and selected metadata visible on the edit route, show the server error, and allow retry. If draft creation fails, remain on the new page. These states avoid both a lost file reference and a false “published” success.

Add UI tests for: new meditation/music creates `{}` draft and routes to edit; the key input/help is absent; upload calls the new API with a selected MP3; successful upload enables publication; replacement uses the same endpoint; and a rejected upload is shown while the editor remains usable.

## Verification sequence

1. `cd backend && npm test -- --runInBand src/content/content-admin.service.spec.ts src/content/audio-file.validator.spec.ts`. The validator spec accepts an `audio/mpeg` ID3 buffer and an `audio/mpeg` frame-sync buffer, and rejects a false MIME, an empty buffer, and arbitrary bytes.
2. `cd backend && npm run test:e2e -- content-admin`.
3. `cd admin && npm test -- --runInBand src/lib/api.test.ts src/lib/content.test.ts src/routes/ContentEditorPage.test.tsx`.
4. Run the full affected suites before handoff: `cd backend && npm test && npm run test:e2e`; `cd admin && npm test`.

No deployment, shared database, live service, or provider configuration is part of this plan.


## Root implementation clarifications (2026-09-18)

- Existing accepted UI request authorizes this original E13 gap. 25 MiB MP3-only is an explicit initial implementation limit, shown in the UI; not a claim of codec validation or duration extraction. Check ID3/frame metadata plausibility rather than accepting only a three-byte prefix. No new transcoder/parser dependency without demonstrated need.
- Concurrent upload/replace/delete must never leave a database reference to a deleted new object or lose another successful replacement. Use an existing suitable transactional/conditional update pattern; test two simultaneous replacements and deletion overlap. Clean up a new object only when confirmed unreferenced; preserve it on ambiguous database outcome and report a cleanup warning.
- Legacy manually supplied keys may be shared. Do not delete arbitrary legacy objects on replace/remove. Only delete objects whose ownership is established by this upload contract; otherwise retain and warn, never delete another material audio. Cover objects remain outside scope.
- Upload success must preserve unsaved title/summary/other form edits; update media state independently. Prevent overlapping save/upload interactions. Show successful write vs failed refresh/audit honestly rather than prompting a duplicate upload.
- Update HelpPage audio instructions after the uploader exists; retain cover-upload limitation. Existing publish-toggle bypass is blocked server-side until audio exists.
- All integration fixtures use disposable PostgreSQL/MinIO with unique namespace and cleanup, never shared development services. No full historical backend e2e repetition unless justified by actual dependency changes; relevant content/premium/upload tests plus affected lint/unit/build suffice.
