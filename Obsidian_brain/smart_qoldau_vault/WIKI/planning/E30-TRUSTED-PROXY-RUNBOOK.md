# E30 — exact trusted proxy peers

Status: accepted into main caaaa844180ba807d296b815728083b261f093e5 after independent APPROVE. Enabling remains gated on stable exclusive proxy IP ownership and actual source verification. No E29 code, admin session/auth semantics, production topology, Caddy configuration, migrations, or repository/vault documentation changed. CLAUDE.md remains absent/deleted as in base. No subagents or neighboring-task messages were created.

## Design and scope

The accepted base is 731c3e380ad3849d2746b0299fa635864626089f. Existing configureApp never configured Express trust proxy; guards (including IP fallbacks) and rejected-webhook logging consume req.ip, so Caddy's socket address became a shared client identity.

TRUSTED_PROXY_IPS is opt-in. Unset, empty, or whitespace-only means literal Express trust proxy=false. Otherwise it must be a comma-separated list of exact IPv4/IPv6 IP literals. Surrounding whitespace on each peer is allowed. CIDRs (including /32 and /128), aliases, DNS names, booleans, hop counts, empty members, ports, brackets, and IPv6 zone IDs are rejected. Node isIP validates literals; Express compiles only the resulting validated IP array. No dependencies added. Errors identify the configuration key without echoing its value.

Validation is shared by ConfigModule's Joi schema (early startup rejection) and configureApp (also protects alternate bootstrap/test entry points), before HTTP listening. Express checks the socket peer and walks XFF right-to-left until the first untrusted address; no automatic inferred peer or hop trust. IPv4-mapped IPv6 socket peers match exact IPv4 entries via Express/proxy-addr. No custom IP resolver, throttle implementation, webhook semantics, or authentication change.

Trust proxy also affects Express hostname/protocol. The pinned Caddy configuration overwrites untrusted X-Forwarded-For/Host/Proto. No application consumers of req.secure/protocol/hostname were found outside this new boundary and fixtures. HTTP/Caddy tests check spoofing of all three headers. A configured trusted peer is authorized to assert these values; this is not protection against compromise of that peer or the Docker host/network layer.

## Actual BFF boundary

Direct API path: client -> Caddy API hostname -> backend. E30 recovers the immediate client observed by Caddy and separates IP throttle buckets on this path.

Web BFF path: browser -> Caddy web hostname -> Next web -> backend at http://backend:3000/v1. web/lib/auth/proxy.ts callBackend constructs Content-Type and optional Authorization only; web/app/api/proxy/[...path]/route.ts similarly constructs headers; authorizedFetch sends Authorization. None forwards original XFF or a derived client IP. Therefore backend must continue seeing the web socket peer. E30 does not fix per-browser IP aggregation on BFF routes. Phone/user based trackers retain existing behavior. The no-XFF tests characterize this backend boundary; they are not claimed as a full Next BFF integration test. Do not add web's IP to trusted peers to try to solve it: there is no forwarded client identity to recover. Designing authenticated/sanitized BFF forwarding is a separate task.

## Exact operator configuration and open gates

Checked-in TLS overlay currently attaches Caddy/backend/web/admin to an edge network with dynamic container addresses. Merely inspecting today's Caddy address and storing it in TRUSTED_PROXY_IPS is unsafe across container recreation/address reuse. E30 does not change deployment topology or enable trust by default. infra/.env.tls.example and backend/.env.example leave the value blank. Backend already loads private infra/.env via production env_file; no compose interpolation change is needed to pass this key.

Before enabling in a pilot, operator must reserve a unique, stable Caddy address, ensure backend observes that exact peer, and exclude the reservation from dynamic reuse. For example ONLY AFTER checking that 172.30.254.0/24 is unused and suitable on the actual host, a separately reviewed private deployment override could use:

```yaml
services:
  proxy:
    networks:
      edge:
        ipv4_address: 172.30.254.2
networks:
  edge:
    ipam:
      config:
        - subnet: 172.30.254.0/24
          ip_range: 172.30.254.128/25
```

Then the exact private infra/.env backend setting is:

```dotenv
TRUSTED_PROXY_IPS=172.30.254.2
```

This is an illustrative operator plan, NOT a committed/applied production override or a safe universal subnet. The /24 and /25 above are network allocation only, NEVER application trust. The fixed .2 sits outside the dynamic allocation range. Verify resolved Compose, exclusive assignment, actual backend-observed source, no alternate/NAT peer, and source-address ownership across recreation before enabling. Changing an existing Docker network's IPAM requires planned recreation and is outside E30. If IPv6 is actually used, explicitly reserve/verify the exact IPv6 peer and include that address too; never infer it from the subnet. If any reservation or observation is uncertain, keep TRUSTED_PROXY_IPS empty.

Additional gates/limits:
- Independent review and integration by root; no push/deploy performed.
- Verify real host routing, reserved subnet/address, topology, and lifecycle; fixtures are not a production-network certification.
- Caddy is treated as the direct public ingress. A CDN/load balancer in front is another boundary: current Caddy ignores its supplied XFF and sees that intermediary. Do not extend trust implicitly.
- Trust peers must sanitize XFF and generate consistent address representations. Express preserves the selected forwarded client's textual representation; this change does not canonicalize all client strings or redesign throttle keys. The Caddy fixture verifies its actual IPv4 output, while the HTTP suite explicitly covers mapped IPv6 peers and forwarded values.
- IP allowlisting assumes trusted host/network administration; it is not cryptographic proxy identity or a defense against compromised trusted Caddy / privileged L2 attackers.
- BFF per-browser IP attribution remains outside E30 as detailed above.

## Evidence

No shared DB/Redis, public probes, secrets, migrations, or application deployment were used. Only official reference documentation was read on the web. Cached npm packages installed offline with lifecycle scripts disabled. Prisma client generated locally using read-only cached engine paths; no database connection/migration. Existing Prisma config/npm deprecation warnings remain unrelated.

RED evidence:
- /tmp/qoldau-e30-red.log: real Express getters + actual Nest IpThrottlerGuard before implementation: 24 failed / 6 passed (missing validation and shared proxy throttle identity).
- /tmp/qoldau-e30-schema-red.log: 9 failed / 1 passed before Joi validation (wrong key validation/acceptance).

Final commands (repository root unless noted):
1. In backend: `./node_modules/.bin/jest --runInBand bootstrap.trusted-proxy.spec.ts config/trusted-proxy.spec.ts common/webhooks/rejected-webhook.log.spec.ts` — 44 tests PASS; /tmp/qoldau-e30-unit-final.log.
2. In backend: `./node_modules/.bin/jest --config test/jest-e2e.json --runInBand --runTestsByPath test/trusted-proxy-http.e2e-spec.ts` — 30 tests PASS over real ephemeral loopback HTTP, with actual Nest IpThrottlerGuard/in-memory test storage and rejected webhook logger; /tmp/qoldau-e30-http-final.log. Explicit selection avoids all DB-dependent e2e suites. Untrusted source 127.0.0.2 and mapped socket ::ffff:127.0.0.1; default false, malformed startup config, trusted peer list, attacker prefix, chain stopping, no-XFF boundary, separate 200/429 buckets, direct XFF spoof attempts.
3. `bash infra/scripts/tests/trusted-proxy.test.sh` — PASS, /tmp/qoldau-e30-caddy-final.log. Uses unchanged checked-in Caddyfile.prod, cached caddy:2.10.2-alpine/node:22-alpine, real configureApp and actual IpThrottlerGuard. Own unique internal Docker network, no published ports, local .localhost TLS, read-only code/fixture mounts, no DB/secrets. Two concurrently alive client containers have distinct real IPs; each independently receives 200,200,429 through Caddy despite changing forged XFF. Also checks exact backend peer, Caddy's sanitized XFF/host/proto and direct untrusted access. The dynamically discovered Caddy IP is safe ONLY inside this single-lived, owned disposable fixture; it is not the operator deployment pattern.
4. In backend: `npm run build` — PASS, /tmp/qoldau-e30-build.log.
5. ESLint on the changed bootstrap/config/test TS files — PASS, /tmp/qoldau-e30-lint.log. `bash -n infra/scripts/tests/trusted-proxy.test.sh` and `git diff --check` — PASS.

Sandbox initially rejected Docker socket access and HTTP listen with EPERM (ordinary sandbox failure, not auto-review/cybersecurity denial). Following root's explicit clarification, scoped require_escalated runs for only owned loopback/disposable fixtures were approved and passed. No platform-review rejection was retried or bypassed. Initial Prisma cache utime hit EROFS; successful generation read the cached engines explicitly and wrote only ignored local node_modules output.

Cleanup: HTTP apps close in afterEach; Docker script EXIT cleanup removes only its unique Compose project containers/network/anonymous Caddy volumes and deletes its own /tmp fixture directory. Cleanup failure is reported as failure. Ignored local backend node_modules/dist remain for review/retesting; no shared resources were altered. Final exact resource-label check and commit identifiers follow below.

## Final handoff identifiers

- Commit: `ddb40f36cea811a10891c2821935e35b5a57b6a6` — `fix(backend): trust only explicitly configured proxy peers`.
- Exact parent: `731c3e380ad3849d2746b0299fa635864626089f`.
- Working tree: clean after commit. Nine changed code/config/test files; no repository docs, no CLAUDE restoration, no E29 integration.
- Final Caddy run: project `sq-e30-sq-e30-proxykc771l`, actual concurrent client IPs `172.18.0.4` and `172.18.0.5`, independent real throttle buckets PASS.
- Read-only Docker cleanup verification returned PASS for all three owned project labels (`sq-e30-sq-e30-proxym2v0ce`, `sq-e30-sq-e30-proxyv7onjj`, `sq-e30-sq-e30-proxykc771l`): zero containers, networks, or volumes remain.
- No missing live evidence remains for this bounded fixture scope. Outstanding gates are independent root review/integration and operator deployment IP reservation/source verification; BFF attribution remains explicitly out of scope.

## Root acceptance — 2026-09-17

Source ddb40f36cea811a10891c2821935e35b5a57b6a6 → main caaaa844180ba807d296b815728083b261f093e5. Independent APPROVE `/tmp/qoldau-trusted-proxy-review/report.md`:44unit/30HTTP/31extra/liveCaddyPASS. Combined main:224unit/36suites, lint, build,30HTTP and liveCaddy actual throttle PASS exit0. Logs `/tmp/qoldau-trust-main-{unit,lint,build,http,caddy}.log`. Tree equals reviewed source, clean; own fixture cleanup empty. No deploy/enabling/privateenv changes. Direct API boundary only; BFF browser attribution remains unresolved.
