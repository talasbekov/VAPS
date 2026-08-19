---
name: docker-compose-p-flag-still-collides-on-generic-name
description: "An explicit `-p` flag for docker compose only helps if the name is actually unique — reusing the generic default (e.g. \"deploy\") still collides across projects"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2315ff41-73b0-40b3-937e-6201d41a4ca0
---

Explicitly passing `docker compose -p <name>` does NOT by itself prevent cross-project collisions — it only helps if `<name>` is genuinely unique to the project. Passing `-p deploy` (matching the directory name, which is what compose would have inferred anyway) still collided with a second, unrelated project whose own deploy dir is *also* named `deploy` (`/home/erda/Музыка/AshyqQala.kz/deploy/`).

**Why:** After [[project_docker_port_foreign_container]]'s 12.1 incident (containers only), a second, worse incident happened during Story 12.3's live install.sh testing: `docker compose -p deploy down -v` deleted `deploy_db_data`, a real volume belonging to AshyqQala.kz's `db` service (postgis). This time `-v` was used, so data was actually destroyed (not just stopped containers). Recoverable only because that volume's entire content was reproducible from git-tracked migrations+seed fixtures (`docker compose --profile app up` from AshyqQala.kz's own repo rebuilt it from scratch, verified 17 tables + row counts restored) — a project with real unbacked-up data would not have been so lucky.

**How to apply:** For VAPS deploy-stack testing (Story 12.x live runs), always use a name that includes "vaps" explicitly, e.g. `-p vaps-story-12-3` or `-p vaps-deploy`, never the bare directory-derived name even when passed explicitly. Before any `docker compose ... down -v` (or plain `down` if uncertain), run `docker volume ls`/`docker ps -a` first and sanity-check that every resource about to be removed is actually yours. Multiple unrelated projects on this machine default to generic directory names (`deploy`, `deploy-caddy`) — see also [[project_docker_port_foreign_container]] for the sibling incident on ports.
