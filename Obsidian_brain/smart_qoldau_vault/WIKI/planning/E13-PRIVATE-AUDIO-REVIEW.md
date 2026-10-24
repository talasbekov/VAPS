# E13 private audio reachability — final cumulative independent review

## Verdict

**APPROVE** cumulative candidate `dfe6249893356941b16a79bbf932cd5a05873eeb`
against base `2236df554cee01ed43d281c48ba3262e25256574` (including
`7c45342ee3a14f4a09d5abd8074094d90d6a4e64` and
`6d78e0f889a95c2506d0f73703d58c1de17b24ca`). The checkout is detached at the
exact candidate and clean.

## P2 closure verified

The only new diff changes `infra/private-audio-proxy.spec.cjs` and
`infra/test-private-audio-proxy.sh`; production route/config/auth logic is
unchanged.

- The regression now signs `sq-other-e13/secret.txt` for both direct MinIO and
  the public edge. The direct control returned `200` with the exact secret;
  the same correctly signed edge request returned deterministic non-S3 `502`
  without the secret. This closes the prior unsigned-other-bucket gap.
- Plain and encoded traversal use the original signed content query but are
  asserted only for route selection, not falsely described as valid SigV4
  requests. The literal production route produced `[502, 502]` and no
  `x-amz-request-id`.
- The script makes a bounded mutation only inside its disposable rendered nginx
  container, widening the object route to a wildcard. The valid signed
  other-bucket edge request then returned `200` and the secret; both traversal
  requests reached MinIO (`400` with `x-amz-request-id`). This proves the
  production assertions are sensitive to precisely the wildcard regression at
  issue.

## Independent final verification

No unchanged backend suite/lint/build was repeated. I ran:

```text
sh -n infra/test-private-audio-proxy.sh
node --check infra/private-audio-proxy.spec.cjs
cd backend && npx prettier --check ../infra/private-audio-proxy.spec.cjs
infra/test-private-audio-proxy.sh
git diff --check 2236df5..dfe6249
```

All commands exited 0. The real disposable Compose proxy emitted:

```text
invalid_bucket_rejected_by_entrypoint=true
stock_entrypoint_envsubst=true
{"signedGet":200,"ranges":[206,206],"unsigned":403,"tampered":403,"expired":403,"head":405,"put":405,"delete":405,"listing":404}
healthy_proxy_logs_contain_signature=false
non_bearer_proxy_logging_active=true
upstream_failure_status=502
upstream_failure_proxy_logs_contain_signature=false
{"directInternalOtherBucket":200,"signedOtherBucketThroughEdge":502,"mutatedSignedTraversalRouteStatuses":[502,502],"mutatedSignedTraversalReachedMinio":false,"wildcardNegativeControl":false}
{"directInternalOtherBucket":200,"signedOtherBucketThroughEdge":200,"mutatedSignedTraversalRouteStatuses":[400,400],"mutatedSignedTraversalReachedMinio":true,"wildcardNegativeControl":true}
wildcard_route_negative_control_detected=true
```

Prior independent evidence remains valid: focused backend test set passed 4
suites/33 tests; affected lint and Nest build passed. P0 (stock nginx
entrypoint/template activation) and P1 (signed query suppression on upstream
failure while ordinary routes still log) were independently verified in the
previous cumulative run.

## Isolation / limits

The test used only a unique `qoldau-e13-proxy-test-<pid>` Compose project,
project-scoped network/volume, ports `18080`/`19000`, and a temporary signed URL
file. Its trap ran `down -v --remove-orphans`; post-run checks found no matching
containers, networks, volumes, or listening ports. No shared database, Redis,
MinIO data, account, live configuration, deployment, image tag, or migration
was touched.

Production Caddy, physical-device/tunnel/TLS playback, broad historical tests,
E29/Redis reviews, and all DB rollout/migration activity remain out of scope.
User DB approval remains `PENDING`.
