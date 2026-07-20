# Legal & Investigation Intelligence — Developer Guide (v1.0)

Read [Architecture](architecture.md) first. This document is the practical "how do I work on this code" reference.

## File map

| File | Role |
|---|---|
| `js/ai-service.js` | All Legal Intelligence logic lives here: registry fetch, module dispatch, every prompt, every compute function. This is the **only** file that changes when adding a new document-based module. |
| `report.html` | The renderer: `LegalIntelligenceSection`, `ModuleCard`, `formatDateDMY`, the export helpers (`legalIntelligenceRowsHtml`, `legalIntelligenceTextLines`), draft persistence wiring. Does not change when a module is added. |
| `supabase/migrations/20260719000001_legal_intelligence.sql` | Adds `report_drafts.legal_intelligence` (jsonb). |
| `supabase/migrations/20260719000002_legal_intelligence_modules.sql` | Creates and seeds `legal_intelligence_modules` (the registry). |
| `docs/legal-intelligence/` | This documentation set. |

## How to add a new document-based module (the proven path — 9 modules built this way)

1. **Confirm the registry row exists.** If the module wasn't in the original 12, add one row: `INSERT INTO legal_intelligence_modules (module_id, module_label, sort_order, description) VALUES (...)`. No code deploy required for this step alone — the module will start appearing as a placeholder immediately.
2. **Decide the response shape.** Does the module fit the "cross-check documents, flag discrepancies" pattern (checks/discrepancies)? Reuse `_computeChecksAndDiscrepancies`. Does it need its own question (a timeline, a score, a findings list, an alerts list)? Write a dedicated compute function, modeled on `_computeTimelineIntelligence` or `_computeRiskAssessment`.
3. **Write the prompt builder** (`_build<Module>Prompt(docsText)`), following the conventions in [Module Documentation](module-documentation.md) → "Prompt conventions."
4. **Write the compute function** (`_compute<Module>({ docsText }, { onStatus })`), returning the 12 content fields (everything except `moduleId`/`moduleLabel`, which `getLegalIntelligence()` merges in from the registry row). If reusing `_computeChecksAndDiscrepancies`, this is a 5-line wrapper.
5. **Register it**: add one line to `_MODULE_IMPLEMENTATIONS`. This is the entire "activation" step — nothing else changes.
6. **Write tests** (see [Testing Guide](testing-guide.md)) — normal case, a flagged/discrepancy case, zero-data empty state, malformed JSON, wrong-type JSON, backend error, and an independence check (this module failing doesn't affect others).
7. **Verify `report.html` has zero diff.** If it doesn't, something is wrong — the renderer should never need to change for a new module. `git diff --stat report.html` should be empty.
8. **Commit, push, confirm live** — fetch the deployed `js/ai-service.js` and grep for the new function name.

## Coding conventions used throughout

- **Never fabricate.** Every prompt explicitly tells the model to say "not stated" / "unclear" rather than guess, and to cite only what the source text supports.
- **Defensive parsing, always.** `Array.isArray(parsed.x) ? parsed.x : []` on every array field from AI output — a malformed or off-spec response must degrade to an empty/placeholder state, never throw past the module boundary.
- **`try/catch` per module inside `Promise.all`**, not around the whole dispatch loop — this is what makes module independence real, not just documented.
- **`status` is always `"Pending Verification"` from a compute function.** No module sets `"Completed"` — that's a future human-review workflow.
- **`references` is derived, never asked for directly** — build it by collecting and deduplicating the `source` (or module-specific equivalent, e.g. `checkedIn`) fields the model already had to provide per item. This avoids a second, easy-to-desync "list your sources" instruction.
- **`evidence` stays `[]` unless there's a real file/URL.** Do not populate it with placeholder or synthetic links — see [Architecture §6](architecture.md#6-design-principles-binding-for-all-future-modules), principle 4.
- **Dates in prompts**: instruct the model to preserve the source's own date format verbatim (`"as written in source, do not reformat"`) rather than asking it to normalize — normalization is a display concern, handled once, centrally, by `formatDateDMY` in the renderer, not scattered across every prompt.

## Renderer internals (for when you do need to touch `report.html`)

- `formatDateDMY(iso)` — the **only** place ISO timestamps become `dd/mm/yyyy` for humans. Stored data stays ISO always (machine-parseable, shared with Bima Anveshak). Used by `ModuleCard` (on-screen) and `legalIntelligenceRowsHtml` (Word/PDF export). The Text export intentionally does not include `asOf` at all — it only prints `summary`/`details`.
- `Array.isArray(data?.modules)` guards (in `LegalIntelligenceSection`, `legalIntelligenceRowsHtml`, `legalIntelligenceTextLines`) — protect against a corrupted or malformed stored record. Without them, a non-array `modules` value crashes the entire app (not just this section) since nothing wraps the render tree in an error boundary. Keep these guards if you ever touch this code.
- `buildDocsText(docCategories)` — the single shared function that flattens ticked, filled-in document categories into the plain text every module (and the main narrative report) reads from. Defined once, near `initialDocCategories`; do not re-implement this inline anywhere.

## What never needs to change for a new module

- `legal_intelligence_modules` table schema.
- `report_drafts.legal_intelligence` column.
- `ModuleCard`, `LegalIntelligenceSection`.
- `legalIntelligenceRowsHtml`, `legalIntelligenceTextLines`.
- `LEGAL_STATUS_STYLE` (the 4-value status vocabulary is fixed).
- `formatDateDMY`.

If a change you're making touches any of the above for a routine new module, stop and reconsider — that's very likely scope creep into architecture territory, which is frozen (see [Architecture](architecture.md)).
