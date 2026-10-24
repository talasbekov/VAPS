# Smart Qoldau — browser-reachable private audio on the local `:8080` stand

## Scope and non-decision

This is a **read-only implementation plan**, not a rollout command or an
authorization to deploy.  It addresses only the already-identified path from
an authenticated `GET /v1/content/:id/media` to a browser-reachable private
object.  It does not change the accepted uploader, database/migrations,
content schema, bucket privacy, account/session/paywall protocol, documents,
avatars, or dependencies.  The DB/migration/live-update decision remains
separate and is intentionally not re-opened here.

The target commit in this worktree is `2236df5` (`feat(content): add admin
audio uploader`).  The earlier local-rollout assessment says that a full
backend update is not currently authorized because the shared database lacks
three target-main migrations; this plan is for a future **isolated disposable
stand** or separately authorized deployment only.

## Evidence and the actual gap

| Evidence | Consequence |
| --- | --- |
| `backend/src/content/content.controller.ts:92-102` protects `GET /v1/content/:id/media` with `JwtAuthGuard`; `backend/src/content/content.service.ts:150-170` calls `assertAccess()` before it returns a URL. | The existing route is the correct authorization boundary.  A second app-level media authorization route is unnecessary. |
| `backend/src/content/content.service.ts:250-261` makes a non-Premium caller of a Premium item fail with `403 PREMIUM_REQUIRED`; `:264-273` hides drafts. | Access checks must stay before minting the bearer URL. |
| `backend/src/storage/storage.service.ts:37-45` constructs the S3 client with `S3_ENDPOINT`; `:158-163` presigns that exact client. | With stand `S3_ENDPOINT=http://minio:9000` (`infra/docker-compose.prod.yml:95-113`), the returned URL names Docker-internal `minio`, which a browser/mobile device cannot resolve. |
| `infra/docker-compose.stand.yml:17-25` exposes only nginx on host `8080`; `infra/nginx.stand.conf:8-50` has API/admin/web routes but no MinIO route. | `localhost:8080` currently cannot serve a signed content object. |
| `backend/src/storage/storage.service.ts:128-132` creates the content bucket without a public-read policy, whereas `:58-77` deliberately gives only the avatar bucket public read. | Making the content bucket public, or adding a catch-all S3 proxy for documents/avatars, violates the established boundary. |
| `backend/src/storage/storage.service.ts:155-163` and `backend/README.md:214-224` deliberately require direct object delivery and a 15-minute URL. | A Nest relay would put audio bytes back through Node and contradict the current scalability design. |
| `app_client/lib/features/content/ui/player_screen.dart:46-51`, `app_client/lib/features/content/data/content_repository.dart:21-23`, and `packages/shared/lib/api/sq_api_content.dart:46-54` treat `url` from the existing endpoint as opaque and hand it directly to the player. | The mobile client needs no contract or auth change if the returned signed URL becomes externally reachable. |

## Chosen minimal design: externally addressed S3 signer plus a bucket-scoped edge route

Keep the existing authenticated `GET /v1/content/:id/media` exactly as the
single authorization/minting endpoint.  Add a second **S3 client used only for
presigning content reads**, configured with a new explicit
`S3_CONTENT_PUBLIC_ENDPOINT` (for the local stand:
`http://localhost:8080`).  It uses the same credentials, region and
`forcePathStyle: true` as the internal S3 client.  `putContentObject`, deletes,
bucket checks, documents and avatars continue to use internal `S3_ENDPOINT`.

Expose only path-style requests for the one configured content bucket through
the edge, for example:

```
Browser/player
  -> GET /v1/content/:id/media + JWT (backend checks published + Premium)
  <- { url: http://localhost:8080/sq-content/<key>?X-Amz-..., expiresAt }
  -> GET /sq-content/<key>?X-Amz-... [Range: bytes=...]
  -> nginx (preserves URI, Host, query, Range) -> minio:9000
  <- MinIO verifies SigV4 and streams the private object / range response
```

This is the explicit external-signing variant, not an authenticated backend
relay.  It preserves the current 900-second TTL, private bucket, direct
S3/MinIO streaming and native Range seeking; it adds no new API route and does
not give the browser S3 credentials.

### Why the other candidate is rejected

An authenticated Nest relay could reuse `assertAccess()` on every byte request,
but it would need streaming/back-pressure, range parsing/forwarding, response
header handling and a separate expiry/cache policy.  It also conflicts with
the explicit existing rationale that audio must not traverse Node
(`storage.service.ts:155-157`).  It is therefore more code, less scalable and
not the minimal compatible fix.

### SigV4 invariant (do not simplify this away)

SigV4 includes the request `Host` and canonical URI in the signature.  Thus
the signed public endpoint must be the URL the browser requests, and the proxy
must deliver **that same Host and URI** to MinIO:

- Sign `http://localhost:8080/sq-content/<key>`, not
  `http://minio:9000/...`.
- Proxy the bucket path without a URI rewrite: nginx uses
  `proxy_pass http://minio:9000;` **without** a trailing slash.
- Forward `Host $http_host` (Caddy: `Host {http.request.host}`), not the
  upstream `minio:9000` host.
- Do not mount MinIO under a synthetic prefix such as `/media/` and strip it:
  signing `/media/sq-content/key` while MinIO verifies `/sq-content/key`
  invalidates the signature.

The narrow route is for the configured `S3_BUCKET_CONTENT` value (`sq-content`
in the current defaults, `backend/src/config/env.validation.ts:31-35`).  If an
operator changes that bucket name, the route matcher and the explicitly signed
endpoint must be changed atomically in the same isolated deployment; a
catch-all `/{bucket}/` proxy is not an acceptable shortcut.

## Exact bounded changes for a later implementation task

1. **`backend/src/config/env.validation.ts`** — add
   `S3_CONTENT_PUBLIC_ENDPOINT` as a URI.  Make it explicit for any deployed
   environment that returns browser media URLs (at minimum the stand); a
   development-only fallback to `S3_ENDPOINT` is permissible only if covered
   by a test and clearly cannot reach a stand.  Do not repurpose
   `S3_PUBLIC_BASE_URL`: it is the avatar/CDN setting
   (`storage.service.ts:32-36`) and may point at a CDN that is not an S3 SigV4
   verifier.

2. **`backend/src/storage/storage.service.ts`** — retain the current internal
   `s3` client and create a private `contentSigningS3` client from
   `S3_CONTENT_PUBLIC_ENDPOINT`, using the identical credentials, `us-east-1`
   and path-style mode.  Change only `contentUrl()` to pass that client to
   `getSignedUrl`.  Keep the current `GetObjectCommand`, content bucket and
   `ttlSec = 900`; do not put a public bucket policy, add a relay, alter the
   content service, or touch document/avatars methods.

3. **`backend/src/storage/storage-content.spec.ts`** — construct with an
   intentionally different internal endpoint and public endpoint.  Assert that
   `contentUrl()` has the public host, `/sq-content/<key>` path and
   `X-Amz-Expires=900`, and never contains the internal `minio` host.  Retain
   the existing bucket-selection tests for put/delete.  A focused unit test
   should also prove default/custom TTL is unchanged.

4. **`infra/docker-compose.stand.yml`** — set backend
   `S3_CONTENT_PUBLIC_ENDPOINT` from `STAND_URL`, defaulting to
   `http://localhost:8080`.  `STAND_URL` already controls the public stand
   origin at lines 40-46.  This value is signed but is not contacted by the
   backend, so `localhost` is correct for a desktop browser using the local
   stand.  A physical phone must use a device-reachable HTTPS tunnel/base URL
   in `STAND_URL`, not its own `localhost`.

5. **`infra/nginx.stand.conf`** — add a route before the catch-all `/` route
   for only `/sq-content/`:

   ```nginx
   location ^~ /sq-content/ {
     proxy_pass http://minio:9000;
     proxy_http_version 1.1;
     proxy_set_header Host $http_host;
     proxy_set_header Range $http_range;
     proxy_set_header If-Range $http_if_range;
     proxy_buffering off;
     access_log off;
   }
   ```

   The no-trailing-slash `proxy_pass` and explicit Host are security/correctness
   requirements, not stylistic choices.  The default header forwarding already
   carries `Range`; retaining it explicitly makes seeking part of the proxy
   contract.  `proxy_buffering off` avoids turning a seek into a proxy-side
   full-object buffer.  Do not add a route to `expert-documents`, `sq-avatars`,
   the MinIO console, a bucket-list API, or a wildcard bucket prefix.  Disable
   access logging for this bearer-query route because the signed query string
   is a short-lived credential.

6. **Production/TLS parity, when separately deployed** — apply the same one
   bucket-only, no-rewrite route before the API catch-all in
   `infra/Caddyfile.prod`, with `header_up Host {http.request.host}` and no
   URI rewrite.  Configure `S3_CONTENT_PUBLIC_ENDPOINT` to the externally
   reachable API/media origin.  Preserve Caddy's existing query redaction
   (`infra/Caddyfile.prod:3-22`); the short-lived signature must not be added
   to logs.  This is a proxy/config change only, not a new public object
   policy.

## MIME, disposition, CORS, and client compatibility

- The accepted uploader writes MP3 with `Content-Type: audio/mpeg` (canonical
  E13 plan; `backend/src/storage/storage.service.ts:134-146` forwards the
  supplied object metadata).  The proxy must pass MinIO response headers
  unchanged, including `Content-Type`, `Content-Length`, `Accept-Ranges`,
  `Content-Range`, `ETag` and any `Content-Disposition`.
- Do not attach a download disposition.  For the audio uploader, no
  `Content-Disposition` (or explicit `inline`) lets the browser/player handle
  `audio/mpeg`; a later implementation may sign `ResponseContentType` and
  `ResponseContentDisposition=inline` only if it is covered by the real-MinIO
  acceptance checks.  It must not force `attachment`.
- At `localhost:8080` the returned URL is same-origin with the stand, so no
  CORS configuration is necessary for an HTML audio element.  Native Flutter
  is not constrained by browser CORS and continues to play the opaque URL.
  If a future web client uses a different media origin and JavaScript/WebAudio
  needs to inspect the response, configure MinIO **only for the content
  bucket** with the exact web origin, `GET, HEAD`, and the required range
  headers; this is a browser interoperability setting, never access control.
- No web/mobile source change is needed: the common client already consumes
  `{ url, expiresAt }`, and the app player passes `url` to `audio.play()`.
  A physical mobile acceptance run needs an HTTPS, device-reachable
  `STAND_URL`; do not weaken mobile transport settings to make HTTP localhost
  work.

## Isolated acceptance checks (bounded and non-shared)

Run these only in a disposable PostgreSQL/Redis/MinIO/stand namespace with
unique fixture IDs and cleanup.  Do not point e2e tests at the shared local DB
or existing MinIO volumes.

1. Create/publish a FREE MP3 and a PREMIUM MP3 through the accepted admin
   upload path.  From an authenticated eligible user, call
   `/v1/content/:id/media`; assert the URL host is the configured public stand
   origin, its path is exactly `/sq-content/<configured-content-bucket>/<key>`,
   it contains `X-Amz-Expires=900`, and it has no `minio` Docker hostname.
2. Browser test the returned URL in `<audio>`: play, seek to a later position,
   and resume.  Independently request two different byte ranges and require
   `206`, `Content-Range`, `Accept-Ranges: bytes`, audio MIME and matching
   partial bytes.  This proves the edge forwards Range instead of merely
   loading the first chunk.
3. Request the same object path without query signature: require MinIO `403`.
   Change one signed query character and require `403`; use a deliberately
   one-second test signature, wait past expiry, and require `403`.  This proves
   proxy reachability did not make the bucket public and did not bypass TTL.
4. With no JWT, require `401` from `/v1/content/:id/media`.  With an
   authenticated non-Premium user and a Premium item, require the existing
   `403 PREMIUM_REQUIRED` and verify that no `url` is returned.  A draft or
   nonexistent ID must retain `404 CONTENT_NOT_FOUND`.
5. Verify a Premium user can play after normal authorization, then independently
   load the already-minted URL until its short TTL expires; this documents the
   intended bearer-link window rather than inventing a new session protocol.
6. Run the existing storage/content unit and affected content/premium e2e
   suites plus a proxy config validation (`nginx -t` for stand; Caddy validate
   for TLS), all against that disposable environment.  Inspect proxy logs to
   confirm signed query strings are not retained.

## Explicit exclusions

No bucket-public policy; no broad S3/MinIO public port; no proxy for documents,
avatars, console or arbitrary buckets; no DB migration/write; no new package;
no relay; no auth/session/paywall change; no source/config/deploy action in
this read-only task.

## Root corrections and implementation boundaries

- Correct the acceptance URL typo: path is /<configured-content-bucket>/<key>, with the bucket appearing once.
- Expose object GET only (HEAD only if separately signed correctly); deny writes and bucket-root listing. Never assume a prefix matcher alone limits S3 operations. Include traversal/encoded-path and other bucket isolation checks.
- Scope first implementation to local stand nginx + backend signer/config + isolated tests. Production Caddy parity is a future separate deployment concern, not part of this local fix.
- Preserve compatibility for existing deployments without the new environment variable: optional public signer endpoint falls back to existing S3_ENDPOINT; stand explicitly supplies the public endpoint. Document fallback as preserving current behavior, not proving browser reachability. Reject malformed/non-http(s)/credential/query/fragment/path-prefixed endpoints; permit localhost HTTP for the local stand.
- Stand bucket route must match actual configured content bucket. Prefer a bounded validated template/config mechanism or fail clearly for unsupported custom stand bucket; no wildcard proxy and no silently mismatched bucket route.
- Do not alter existing auth/session/Premium contracts or expand sharing guarantees. Signed URLs remain temporary bearer links.
- Keep live config/DB/images unchanged while migration approval is pending. Implementation stays isolated; review required before main integration.
