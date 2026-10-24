# Smart Qoldau E30 — opt-in TLS proxy report

## Accepted design

The pilot edge is a separate `infra/docker-compose.tls.yml` overlay. The base
`infra/docker-compose.prod.yml` remains unchanged and still publishes no host
ports. Applying the overlay adds one Caddy 2.10.2 service on the existing
`edge` network and publishes only TCP 80, TCP 443, and UDP 443.

The operator must provide three DNS hostnames. The overlay fails Compose
interpolation when any hostname is empty; no domain or credential is supplied
by the repository.

Routing follows the applications' existing contracts without path rewriting:

- `WEB_HOSTNAME` sends normal traffic to `web:3000`.
- `WEB_HOSTNAME/socket.io/` sends Socket.IO transport traffic to
  `backend:3000`. The application namespace remains `/ws`; it is not an HTTP
  route and must not be used as the reverse-proxy matcher.
- `API_HOSTNAME` sends all paths to `backend:3000`, preserving `/v1`.
- `ADMIN_HOSTNAME` sends all paths to `admin:80`; the admin container's own
  nginx SPA fallback continues to handle deep links.

Caddy's `/data` and `/config` are named volumes. `/data` persists the ACME
account, private keys, and certificates across container replacement. Access
and reverse-proxy error logs replace the entire request URI query with
`?REDACTED`. Logged redirect `resp_headers.Location` values apply the same
policy, while the actual client-visible 308 Location and upstream request keep
the original query. Logs go to stdout/stderr and are bounded by Docker's
`json-file` rotation at three 10 MiB files, matching the production container
policy.

Caddy does not add a request-body ceiling. The existing backend remains the
authority: 5 MiB for expert photos and 10 MiB for expert documents. Adding a
second edge limit would either reject valid multipart overhead or change the
API's established oversized-upload response.

Postgres, Redis, MinIO, and the MinIO console are never attached to the proxy
and remain unpublished. LiveKit and TURN are outside this slice.

## Operator runbook

1. Copy the three keys from `infra/.env.tls.example` into the private
   `infra/.env` used by the production Compose stack. Set hostname-only values
   with no scheme, port, path, wildcard, quotes, or credentials.
2. In the deployment shell, read and export only the three hostnames. Do not
   `source` the private `.env`, because it also contains credentials:

   ```bash
   cd infra
   read -r -p 'Web hostname: ' WEB_HOSTNAME
   read -r -p 'API hostname: ' API_HOSTNAME
   read -r -p 'Admin hostname: ' ADMIN_HOSTNAME
   export WEB_HOSTNAME API_HOSTNAME ADMIN_HOSTNAME
   : "${WEB_HOSTNAME:?WEB_HOSTNAME is required}"
   : "${API_HOSTNAME:?API_HOSTNAME is required}"
   : "${ADMIN_HOSTNAME:?ADMIN_HOSTNAME is required}"
   ```

3. Align the existing production values:
   - `SITE_URL` = the HTTPS URL of `WEB_HOSTNAME`;
   - `PUBLIC_API_BASE_URL` = the HTTPS URL of `API_HOSTNAME`, ending in `/v1`;
   - `ADMIN_ORIGINS` includes both exact HTTPS origins of `ADMIN_HOSTNAME` and
     `WEB_HOSTNAME` (comma-separated, no wildcard).
   `PUBLIC_API_BASE_URL` is embedded at build time in both admin and web browser
   bundles (`NEXT_PUBLIC_API_BASE_URL` for web). Rebuild both images when it changes.
   Guest ticket creation calls the public API directly; SSR keeps the private
   runtime `API_BASE_URL`. Other BFF traffic retains its existing identity limits.
4. Create DNS A/AAAA records for all three names pointing at the pilot host.
   If AAAA is present, IPv6 must reach that host too.
5. Allow inbound TCP 80 and 443. Allow UDP 443 for HTTP/3. Do not publish any
   application or data-service port directly.
6. Validate hostname syntax and uniqueness, provision the actual Caddyfile in
   the pinned Caddy image with networking disabled, then resolve Compose:

   ```bash
   ./scripts/tls-proxy-preflight.sh
   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
     --env-file .env config --quiet
   ```

7. **PUBLIC DEPLOYMENT NO-GO:** do not continue until a separate security
   review has approved an exact backend trusted-proxy boundary and spoofing
   tests prove that direct/untrusted `X-Forwarded-For` cannot select `req.ip`.
   The accepted backend now supports explicit `TRUSTED_PROXY_IPS`, defaulting
   to no trusted peers. The operator must reserve and verify the exclusive,
   static backend-facing Caddy IP and its recreation behavior before enabling it.
   Dynamic peer discovery, broad CIDRs, trusting web, or invented IPs do not satisfy
   this gate. See [[E30-TRUSTED-PROXY-RUNBOOK]].
8. After that external gate passes, build the environment-specific admin and web
   images, then start the intended stack
   with both files:

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
     --env-file .env build admin web
   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
     --env-file .env up -d
   ```

9. Confirm the variables are still exported, then check certificate issuance
   and routing with the operator-owned names:

   ```bash
   : "${WEB_HOSTNAME:?export WEB_HOSTNAME before smoke}"
   : "${API_HOSTNAME:?export API_HOSTNAME before smoke}"
   : "${ADMIN_HOSTNAME:?export ADMIN_HOSTNAME before smoke}"
   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
     --env-file .env logs --tail=200 proxy
   curl --fail --show-error --silent "https://$WEB_HOSTNAME/"
   curl --fail --show-error --silent "https://$API_HOSTNAME/v1/health"
   curl --fail --show-error --silent "https://$ADMIN_HOSTNAME/"
   ```

   Then perform an authenticated browser smoke that waits for Socket.IO's
   `ready` event, because an unauthenticated raw upgrade proves transport
   routing but not application authorization or Redis-backed subscriptions.

10. Back up `caddy_data` with the same operator policy as other stateful named
   volumes. Never copy private keys into the repository. Renewal is automatic;
   keep TCP 80/443 reachable and monitor `proxy` logs for ACME errors.

Rollback must target only the overlay service; a base-only `up` leaves the
proxy orphan running. These commands stop/remove the proxy container without
`--volumes`, verify certificate volumes remain, and require TCP 80/443 plus
UDP 443 to be free:

```bash
PROXY_CONTAINER="$(docker compose \
  -f docker-compose.prod.yml -f docker-compose.tls.yml \
  --env-file .env ps -q proxy)"
: "${PROXY_CONTAINER:?proxy container is not running}"
CADDY_DATA_VOLUME="$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' \
  "$PROXY_CONTAINER")"
CADDY_CONFIG_VOLUME="$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}' \
  "$PROXY_CONTAINER")"
: "${CADDY_DATA_VOLUME:?proxy /data volume was not found}"
: "${CADDY_CONFIG_VOLUME:?proxy /config volume was not found}"

docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
  --env-file .env stop proxy
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
  --env-file .env rm --force proxy

if docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml \
  --env-file .env ps -aq proxy | grep -q .; then
  echo 'ERROR: proxy container still exists' >&2
  exit 1
fi
docker volume inspect "$CADDY_DATA_VOLUME" "$CADDY_CONFIG_VOLUME" >/dev/null
if { ss -H -ltn; ss -H -lun; } \
  | awk '$4 ~ /:(80|443)$/ { found=1 } END { exit(found ? 0 : 1) }'; then
  echo 'ERROR: a process still owns port 80 or 443' >&2
  exit 1
fi
```

Do not delete `caddy_data`; retaining it avoids needless re-issuance and CA
rate limits.

## Verification performed

- `bash infra/scripts/tests/tls-proxy.test.sh`: resolves base + overlay against
  synthetic env; verifies only Caddy publishes ports, proxy sees only `edge`,
  named certificate volumes exist, and every service retains bounded logging.
- The same test starts a uniquely named disposable fixture with dynamically
  allocated localhost HTTPS, project-scoped labels/networks/volumes, and local
  `.localhost` certificates. It checks web, `/v1`, admin deep-link routing,
  a real HTTP/1.1 `101` WebSocket upgrade at `/socket.io/`, a real automatic
  HTTP-to-HTTPS `308`, and unpublished upstream ports. Query sentinels reach
  HTTP and WebSocket upstreams, and the 308 client receives its complete
  query-bearing HTTPS Location; no sentinel remains in any proxy log field.
  Parsed evidence covers redacted successful access logs, reverse-proxy error
  logs, and the logged `resp_headers.Location` value.
- Negative preflight cases cover schemes, ports, paths, wildcards, userinfo,
  invalid DNS labels, IP addresses, and case-insensitive duplicate names. The
  positive case runs the pinned Caddy image's real `caddy validate` command
  with container networking disabled.
- The fixture executes the documented proxy-only stop/remove sequence, proves
  the proxy is absent and its dynamic HTTPS port is closed, verifies both
  Caddy volumes remain, and confirms unrelated upstreams keep running.
  It does not start the production stack or migrations.
- `bash infra/scripts/tests/docker-compose-prod-logging.test.sh`: existing base
  Compose topology/logging regression remains applicable.
- `bash -n infra/scripts/tls-proxy-preflight.sh` and
  `bash -n infra/scripts/tests/tls-proxy.test.sh`: shell syntax checks.

The fixture's Compose project, containers, network, and named volumes are
removed by an EXIT trap, including failure paths.

## Remaining gates and explicit limitations

- No DNS, firewall, deployment, public ACME issuance, or real credentials were
  changed or exercised. Those remain operator gates.
- **NO-GO for public deployment:** the backend currently has no explicit
  Express `trust proxy` configuration,
  while IP-based throttles and rejected-webhook logs read `req.ip`. Behind any
  container reverse proxy, those paths can observe the proxy peer rather than
  the original client even though Caddy correctly sends forwarded headers.
  This slice does not change business/auth code as required. A separate review
  must approve the exact trusted-proxy boundary and spoof tests before the
  public stack is started. Do not trust arbitrary public `X-Forwarded-For`
  values or broad private-network ranges.
- Certificate backup/restore, centralized log shipping, alerts, LiveKit/TURN,
  and the other E30 outcomes are separate slices and are not claimed here.

## Acceptance — 2026-09-17

Configuration-only APPROVE: `/tmp/qoldau-tls-proxy-review/followup2-report.md`, with prior four findings closed by followup. Sources789bd0e/e4ccf00/a079fa8 integrated as079dc85/b7c29fe/731c3e3. Main731c3e380ad3849d2746b0299fa635864626089f equals reviewed tree. Main TLS integration, production logging regression and shell syntax passed; `/tmp/qoldau-tls-main-check.log`, `/tmp/qoldau-tls-main-logging.log`; fixture cleanup empty. No deploy/public ACME/DNS changes. Trusted-proxy public deployment NO-GO remains. Query redaction is the tested contract; it does not claim arbitrary path/header data anonymization.

## Trusted-proxy gate update — 2026-09-17

Default-off exact-IP implementation and spoof tests are now accepted; see WIKI/planning/E30-TRUSTED-PROXY-RUNBOOK.md. Before public deployment/enabling, stable exclusive Caddy IP reservation, actual observed peer and recreation behavior must still be verified on the target topology. Current dynamic Compose addresses do not satisfy this gate. BFF per-browser attribution remains unresolved. Earlier statements that no Express configuration exists describe the pre-E30 state.
