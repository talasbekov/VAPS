Execute the story-automator review workflow for story {{story_id}}.

{{skill_line}}{{workflow_line}}{{instructions_line}}{{checklist_line}}Story file: _bmad-output/implementation-artifacts/{{story_prefix}}-*.md

BEFORE finding issues: verify the story's own File List section against `git diff --name-only` (from the story's declared baseline commit) plus `git status --porcelain` (uncommitted work). Flag and reconcile any mismatch — extra files in the diff not in File List, or File List entries with no matching diff — before proceeding. Do this from the actual git state, not from the Dev Agent Record's claims (AI-3, epic-9 retro: File List/checkbox drift not caught before review, two epics running).

Review implementation, find issues, fix them automatically. {{extra_instruction}}
