# Smart Josparlau: current source, 17 October 2026

The current Django and Next.js applications are in:

- Backend/PersonnelStatus/Personnel-Records
- Backend/PersonnelStatus/PersonalRecordFront

This publication copies the accepted offline workspace from source commit
9e696eb5fb1405a90b5a7f65993767925a00babc, retaining VAPS history and its other modules.
The source GitLab layout uses PersonnelStatus/; this repository keeps its existing Backend/PersonnelStatus/ layout.

Included changes cover the unified duty journal, employee status and post links,
multi-object security events, compact event/object navigation, the offline Astana
map, role-based officer workspace, and the read-only Digital Twin snapshot API.
The guarded offline updater includes the narrow PostgreSQL CHECK roundtrip fix.

- [Digital Twin API](digital-twin-api.md)
- [Offline Astana map](offline-astana-map.md)
- [Officer workspace and integration](officer-workspace-and-digital-twin-2026-10-16.md)
- [Server update and repair commands](server-update-2026-10-17.md)

Offline packages and application images are distributed separately. Database
dumps, local credentials/configuration, review recordings, and the external
Obsidian vault are not included in this publication.

Publishing this branch does not update a running installation. The production
update still requires its repair file and the guarded check/apply procedure;
a successful server deployment has not yet been confirmed.

The source application blobs are preserved byte-for-byte. The provenance manifest
is .sync/vaps-smart-josparlau.json. Before publication the 78 updater unit checks
ran on Windows: 77 passed, with one Bash-only check skipped. Earlier Docker
rehearsals and UI checks are described in the linked technical notes; they are
not a replacement for the pending production update.
