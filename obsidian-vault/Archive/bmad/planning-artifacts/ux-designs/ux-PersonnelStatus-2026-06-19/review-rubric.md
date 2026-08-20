# Review — Rubric Walk · VAPS · PersonnelStatus spine pair

Reviewed: `DESIGN.md`, `EXPERIENCE.md`, `.decision-log.md`, `.working/extracts/*.md`, `.working/*.excalidraw`, `.working/color-themes-1.html`.
Date: 2026-06-19. Role: rubric walker (contract-for-downstream-consumers check).

## Overall verdict

A strong, source-disciplined spine pair: every EXPERIENCE token reference resolves to a DESIGN token, every load-bearing component has both a visual and a behavioral spec, all canonical sections are present and in order, and the inheritance from the five extracts and the decision-log is faithful and verbatim where it matters. A consumer can source-extract this cleanly. The one real defect is a **stale, internally-contradictory teal/cyan gap flag**: the decision-log records the collision as resolved and the DESIGN frontmatter applies the resolved hexes, yet both the DESIGN GAPS comment and the EXPERIENCE Open Questions still describe it as open with the obsolete value — a consumer reading the prose will believe a resolved decision is still live. Everything else is adequate-to-strong; remaining findings are low-severity polish.

---

## 1. Flow coverage (EXPERIENCE.md) — [strong]

Two Key Flows, each with a named protagonist (Капитан Дамир / DIVISION_OPERATOR; Подполковник Ержан / ОРГД), numbered steps, an explicitly labelled **Climax**, and a **Сбой** (failure path). They map directly to the two canonical user journeys in the sources: UJ-1 «Утреннее обновление» (extract-prd §2 / decision-log "Top jobs" #1) → Flow 1; UJ-2 «Расход для руководства» (extract-prd §2 / decision-log #3) → Flow 2. The two excalidraw wireframes (flow-daily-grid, flow-rashod) are 1:1 with these two flows, including the soft-409 / hard-422 / MARKS_INCOMPLETE beats. Protagonists were committed provisionally in the decision-log (Frame decisions) and carried verbatim.

Findings:
- **[low]** Several jobs from the decision-log "Top jobs" list have no dedicated flow: #4 forward status planning (calendar), #6 при-/откомандирование approval workflow, #7 employee card, #8 audit view (decision-log "Top jobs" 4/6/7/8). This is defensible — the spine scopes the pilot to E8–E11 and the daily ritual is the climax surface — but a consumer planning the secondment-approval or calendar stories has no flow to extract. *Fix:* add a one-line note in Key Flows that planning/secondment/audit flows are deferred past the pilot surface (the IA table already lists the surfaces), so the omission reads as intentional rather than missing.

## 2. Token completeness (DESIGN.md) — [strong]

Every color token in the frontmatter carries a hex, and every load-bearing color has an explicit light + dark pair (chrome 6+6, primary 2+2, светофор 4+4, conflict 4+4). Categorical status colors are light-only by deliberate design (Mantine Badge `variant="light"` generates the dark tint from the base swatch — documented in the GAPS comment, lines 243). Typography / rounded / spacing correctly use `note:` fields instead of literals, per the UI-system-inheritance pattern in the spec (design-md-spec.md lines 48-49) — appropriate because the sources mandate "inherit Mantine defaults." Every `{path.to.token}` prose reference in DESIGN resolves to a defined frontmatter token.

Findings:
- **[low]** No explicit contrast-ratio targets are stated for the load-bearing combos (solid-fill 422 status text on saturated fills; светофор dot on dark `bg-dark`; grid-focus ring). The spine delegates contrast to "inherits Mantine AA defaults; brand overrides verified" — but several status fills (e.g. `status-vacation` orange.8 `#e8590c` with white fg, `status-command` pink.6 `#e64980` with white fg) are brand-mapped, not stock Mantine variant pairings, so the inherited-AA guarantee does not automatically cover them. *Fix:* add a one-line note naming the solid-fill 422 fg/bg pairs as the combos requiring an explicit AA check (the white-on-pink.6 pairing is the riskiest).
- **[low]** `status-competition` and `status-attached` share the identical hex `#66a80f` (lime.8). The decision-log (Finalize, line 149) acknowledges this as intentional and contextually distinguished (tint cell vs «+N» badge). Acceptable, but a token consumer doing a flat color-uniqueness check will flag a duplicate; the rationale lives only in the log, not in DESIGN. *Fix:* one inline comment on the second token noting the deliberate overlap.

## 3. Component coverage (both spines) — [strong]

All 13 DESIGN component tokens (button-primary, button-secondary, status-cell-tint/solid/neutral, status-badge-plus-n, svetofor-dot, conflict-dialog-hard/soft, grid-focus, readiness-panel, watermark-draft, iin-mask) have a visual spec in DESIGN.Components. The behaviorally-load-bearing ones all have a real behavioral rule in EXPERIENCE.Component Patterns / State Patterns / Interaction Primitives: status cells (семья → tint/solid/neutral), svetofor-dot (cascade + text-dual), ConflictDialog (409 soft overridable vs 422 hard blocking), grid-focus (Enter↓/Tab→/Esc, focus-return), readiness-panel (named laggards + «Напомнить»), iin-mask (default-masked + audit). Every `{components.*}` reference in EXPERIENCE (grid-focus×2, status-cell-* , svetofor-dot, conflict-dialog-*, readiness-panel×2, status-badge-plus-n, iin-mask) resolves to a defined DESIGN component token. No orphan references in either direction.

Findings:
- **[low]** `button-primary` / `button-secondary` and `watermark-draft` have a DESIGN visual spec but no dedicated behavioral entry in EXPERIENCE.Component Patterns — they appear only as button labels in Voice & Tone and as a draft-document treatment. Acceptable (buttons inherit Mantine behavior; watermark is a print artifact), but a strict component-coverage consumer sees a visual-spec-without-behavioral-spec for three tokens. *Fix:* none required; optionally note these as "inherits Mantine / print-only, no behavioral delta."

## 4. State coverage (EXPERIENCE.md) — [strong]

The State Patterns table walks the full error/lifecycle surface and ties each to a registry code from extract-architecture §4 / extract-master-spec §8.6: Loading (Skeleton), Empty (grid + journal, both with canon copy), 400/401/403/404-class, 409 soft (overridable → ConflictDialog), 409 structural (MARKS_INCOMPLETE, non-overridable), 422 hard, 423 locked, 500, Blocked (ФИНАЛ gate), Generating (PENDING→RUNNING→SUCCESS/FAILED), Conflict, View-only (откомандирован / VIEWER / ОРГД), «Уточняется» (PENDING_CLARIFICATION). This covers every state the prompt asks for (empty, cold-load, focus, error, permission-denied, blocked, generating, view-only) and adds the domain-specific ones. The permission-denied / view-only distinction (403 route-gate vs restricting-status view-only) is correctly separated, matching FR-16 + the route-guard model in extract-architecture §1.

Findings:
- **[low]** Cold-load is covered generically ("Loading | везде | Skeleton-строки") but the grid — the hardest surface and the one with a virtualization budget — has no state row distinguishing first-paint skeleton from the virtualized-scroll loading of off-screen rows. Source (extract-architecture §7) makes ≤N-DOM-nodes@5000-rows load-bearing. *Fix:* optional — add a grid-specific cold-load / lazy-row note if the dev needs it; the Responsive section already carries the virtualization rule, so this is not a hard gap.
- **[low]** `423 ASSIGNMENT_VERSION_LOCKED` is marked "(S2)" Stage-2 yet kept in the pilot State Patterns table; harmless inclusion, but a pilot-scoped consumer may wonder why a Stage-2 lock state is in-scope. *Fix:* none needed; the "(S2)" tag already disambiguates.

## 5. Visual reference coverage — [adequate]

Per the context note, the visual artifacts live in `.working/` and have not yet been promoted to `mockups/`/`wireframes/` or inline-linked from the spines — that promotion is the next Finalize step, so absence of links is a pending action, not a failure. On the question that matters (do the right screens have artifacts): the two most load-bearing pilot screens both have wireframes — flow-daily-grid covers screen №1 (the blind-entry grid, with преднабор, 409/422 conflicts, bulk-select, «Сдать день», светофор tree sidebar) and flow-rashod covers the расход/отчёт screen (selector, готовность panel with named laggards, async generation, исх.№ chain). The palette artifact (color-themes-1.html, the V4 source) is present. The wireframe text content is fully consistent with the spines (Enter↓/Tab→/Esc grammar, «по … включ.», «+N», view-only, watermark ЧЕРНОВИК, DAILY_MARK_ESCALATION).

Findings:
- **[low]** Two of the three "load-bearing screens" named in the sources have wireframes; the **светофор tree** (Подразделения) has no standalone wireframe — it appears only as a sidebar widget inside flow-daily-grid and as the готовность list inside flow-rashod. The decision-log calls out "three load-bearing screens (grid, расход+светофор, ОМ-чеклист)"; the ОМ-чеклист is correctly out-of-pilot, but the tree screen as its own surface (`/organization`, cascade, "только отстающие") is thin on visual reference. *Fix:* at promotion time, consider a dedicated tree wireframe or explicitly note the tree is covered as a composite-in-context rather than a standalone screen.
- **[low]** (Pending, not a failure) Neither spine inline-links any visual artifact. EXPERIENCE.IA even states "нечего наследовать из вайрфреймов" — once promoted, that sentence and a "→ Composition reference:" line (as in the shadcn example, experience-example-shadcn.md line 29) should be reconciled. *Fix:* add the inline `→ Composition reference:` links during promotion and soften the "nothing to inherit" line to "first-created here, see wireframes."

---

## 6. Bloat & overspecification — [strong]

Density is appropriate to a штаб tool and to the contract role; the spine resists the obvious bloat traps. DESIGN specifies only deltas over Mantine (note-fields for type/rounded/spacing rather than restated literals), explicitly bans custom chrome ("каждый кастомный токен оплачивается весом"), and keeps the palette near-stock. EXPERIENCE specifies only the behavioral delta and repeatedly defers to "Mantine as-is." No invented micro-interactions, no speculative components.

Findings:
- **[low]** The categorical-status color table is duplicated three places at near-full fidelity: DESIGN frontmatter (with hex), DESIGN.Colors prose table, and the decision-log table. The DESIGN prose table restates семья + swatch + style that the frontmatter already encodes. Mild redundancy; defensible as the human-readable rationale layer the spec calls for, but it is the one place a future edit could drift (frontmatter changed, prose table not). *Fix:* none required; if trimming, let the prose table cite families+rule and drop the per-row swatch column that duplicates frontmatter.

## 7. Inheritance discipline — [thin]

Mostly excellent: EXPERIENCE `sources:` frontmatter lists nine real source paths (PRD + 3 reconcile + use-cases + brainstorm + architecture + epics) that match the extract provenance; DESIGN carries `surface`/`project` and `design_ref` is correctly `./DESIGN.md` from EXPERIENCE. Glossary terms (личный состав, лист, расход, сдать, отстающие, в строю, светофор, дрейф) are verbatim across spines, extracts, and decision-log. Component names are identical across DESIGN frontmatter, DESIGN.Components prose, and EXPERIENCE references. Every EXPERIENCE `{...}` token resolves to a DESIGN token. The reason this category is downgraded is a single but real **contradiction across the pair plus the log** on the teal/cyan decision.

Findings:
- **[high]** **Stale, self-contradictory teal/cyan gap.** The decision-log Finalize entry (line 148) records the collision as **resolved** → teal.8 `#099268` / cyan.8 `#0b7285`, and the DESIGN frontmatter (lines 63-64) **applies exactly those resolved hexes** with an inline "разведена 2026-06-19" comment. But the DESIGN GAPS comment (lines 242) and EXPERIENCE Open Questions (line 213) both still describe the collision as **open**, both still cite the obsolete shared value `#0c8599`, and EXPERIENCE even hands it to the finalizer as a live action ("флаг для финализатора DESIGN.md"). A downstream consumer reading the prose will treat a resolved, already-applied decision as unresolved, and the cited hex contradicts the frontmatter that is the actual contract. *Fix:* delete the teal/cyan bullet from DESIGN's GAPS comment and from EXPERIENCE Open Questions (or rewrite both as "resolved 2026-06-19: teal.8 #099268 / cyan.8 #0b7285"); they are now decoration on a closed decision.
- **[low]** Decision-log "Светофор" entry (line 87) records "не сдано/блок = `red.6` (#fa5252/#e03131)" — i.e. it left two candidate hexes for red. DESIGN committed `light-red: #e03131` labelled "red.7", not red.6. The value is a defensible pick but the swatch-name annotation (red.7) diverges from the log's red.6 label. Cosmetic, but a consumer cross-checking swatch names against the log will see a mismatch. *Fix:* align the swatch-name comment (red.6 vs red.7) between log and DESIGN; pick one.
- **[low]** `status-leave-by-report` hex `#ae3ec9` is labelled "grape.7" and the GAPS comment (line 245) records a manual typo-fix for it. The value resolves and is internally consistent now; flagging only because it was a hand-correction outside the extract chain — verify `#ae3ec9` is actually Mantine grape.7 if swatch-name fidelity matters downstream. *Fix:* none if the hex is correct; this is a provenance note.

## 8. Shape fit — [strong]

DESIGN follows the canonical section order exactly: Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts (design-md-spec.md lines 23-30). Frontmatter carries name/description/colors/typography/rounded/spacing/components per spec. EXPERIENCE has the required defaults (Foundation, IA, Voice & Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) and earns its triggered sections: Responsive & Platform (justified — hard hardware/bundle constraints), Open Questions (justified — carries the live product ambiguities forward), Inspiration & Anti-patterns is **omitted** which is reasonable for an internal tool with no competitor-lift story. The GAPS HTML comments at the end of both files are a sound provenance device.

Findings:
- **[low]** EXPERIENCE invents no unwarranted sections, but it omits the "Inspiration & Anti-patterns" section that the shadcn EXPERIENCE example carries (experience-example-shadcn.md line 104). Defensible (the spine's anti-patterns live inline in Voice/Interaction/Foundation — "конкурент не Excel, а телефонный звонок", banned infinite-scroll-equivalents, no celebratory copy), so the content is present, just not sectioned. *Fix:* none required; if a consumer expects the section, the rejected-alternatives are already capturable from Foundation + Voice & Tone.

---

## Mechanical notes

- **Token resolution:** all 20 unique `{...}` references in EXPERIENCE resolve to DESIGN tokens (12 color + 8 component; the lone `{path.to.token}` is the spec-syntax literal in EXPERIENCE's header blockquote, not a real ref). Verified by extraction against DESIGN frontmatter keys.
- **Component parity:** 13/13 DESIGN component tokens present in both frontmatter and Components prose; all behaviorally-load-bearing ones have an EXPERIENCE behavioral rule.
- **Light/dark pairs:** chrome, primary, светофор, and conflict tokens all carry `-dark` companions; categorical status tokens are intentionally light-only (Mantine variant generates dark tint) — documented.
- **Sources frontmatter:** EXPERIENCE `sources:` (9 paths) matches the five-extract provenance and the decision-log "Candidate sources." DESIGN has no `sources:` block (it inherits via the shared workspace + `design_ref` from EXPERIENCE) — acceptable for the DESIGN shape but note it relies on EXPERIENCE for source traceability.
- **Visual artifacts:** 2 wireframes (daily-grid, rashod) + 1 palette HTML present in `.working/`; not yet promoted/linked (pending Finalize step, per context). Светофор-tree lacks a standalone wireframe.
- **Open Questions integrity:** EXPERIENCE Open Questions faithfully carry the live product ambiguities from the extracts (ops_daily_submissions vs legacy story 1.12; hard/soft deploy-config; autosave vs beforeunload E10 divergence; missing pilot error codes DAY_ALREADY_SUBMITTED/TOMORROW_BLOCKED/BUSINESS_DATE_OUT_OF_WINDOW; FR-27 cabinet; polling cadence; aria/target-size) — all real, none invented. The only OQ entry that should NOT be there is the teal/cyan one (finding 7-high), which is resolved.
- **Severity tally:** critical 0 · high 1 · medium 0 · low 13.
