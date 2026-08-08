# Phase 1 Implementation Plan — Common Claim-Agnostic Combined PDF Intake Foundation

**Status: Plan only. No code written, no migrations created, no files modified.** Written against `FINAL-ARCHITECTURE-AUDIT.md`'s verdict A (approved for implementation) and the three approved architecture documents. Scope is exactly what was requested: the common intake pipeline only — upload through confirmed document groups ready for `docCategories`. Health-specific Medical Intelligence, TP-specific Investigation Intelligence, and the `investigation_events`/`investigation_event_links`/`claim_intelligence_adapters` tables that serve them are explicitly Phase 2+ and not designed further here.

Everything below was checked against the actual current repository before being written — file paths, line numbers, and function names are citations, not descriptions from memory.

## 0. New Grounding This Round (not previously established in the architecture docs)

Two facts materially shape this plan and weren't nailed down before:

- **The AI backend is a separate service and repo.** `js/ai-service.js:8` — `AI_ENGINE_BASE_URL = "https://bima-ai-service.onrender.com"`. All AI calls go through `_request(endpoint, body)` (`js/ai-service.js:19-43`), which POSTs there with a Supabase session bearer token. This is `bima-anveshak-ai`, a separate repository this session has not opened. Anything about that service's server-side behavior below is stated as unverified, not assumed.
- **The existing endpoints are generic, not narrow.** `/ki/vision` accepts `{images, prompt, max_tokens, model_tier}` and returns parseable JSON — already reused for wildly different purposes (`autoFillDocument`'s field extraction, `autoFillCaseHeader`'s header extraction). This means Pass 1a/1b classification is very likely a **new prompt against an existing endpoint**, not a new backend route — see §5.

## 1. Exact Files/Modules to Create or Modify

**New:**
- `supabase/migrations/<timestamp>_intake_review_sessions.sql` — one table (§4).
- `js/intake-service.js` — new file, not added to `js/ai-service.js`. Kept separate because intake is a materially different lifecycle (multi-step, stateful across a review session, page-rendering-heavy) than `ai-service.js`'s current shape (one-shot request/response methods), and because a new file has zero diff against the 13 already-shipped, frozen Legal Intelligence modules — the same "additive, not invasive" discipline used everywhere else in this proposal. Owns: unbounded (up to ceiling) page rendering, Storage upload, batching, Pass 1a/1b/1c prompt-building and dispatch, `intake_review_sessions` CRUD.
- New React components inside `report.html` (not a new HTML page — justified in §6): `CombinedPdfUpload`, `IntakeReviewScreen`, `DocumentGroupCard`, `UnrecognizedPagesPanel`, `PageInspector`.

**Modified:**
- `report.html` — new state (`intakeSession`, `intakeSessionLoading`, `intakeSessionError`), a new "Upload Combined PDF" entry point alongside the existing per-category upload grid, a new review-screen render branch, and — the only integration point that matters — a Confirm handler that calls the existing `autoFillDocument` per confirmed group and writes into the existing `docCategories` state exactly as manual entry does.

**Not touched:** `js/app.js`, `js/ai-service.js` (see §3 on why, and §2 on the one place reuse was considered and rejected for Phase 1), `admin.html`/`qc.html`/`agent.html`/`dashboard.html`/`login.html`, any `supabase/migrations/` file other than the one new one.

**Explicitly not created** (per the stated exclusions): `investigation_events`, `investigation_event_links`, `claim_intelligence_adapters` migrations; any Health or TP adapter code; any export-rendering code for the §8d design.

## 2. Existing Functions/Contracts That Can Be Reused

- `sb`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (`js/app.js:4-6`) — used as-is by `intake-service.js`.
- `autoFillDocument({category, files}, {onStatus})` (`js/ai-service.js:934-941`) — reused **unchanged** for Pass 2 final extraction. This is the single most load-bearing reuse in the whole design: intake's entire job is to hand this function exactly the input shape it already accepts.
- `DOC_CATEGORIES` (`report.html:89-362`) — read-only reference for Pass 1a's classification vocabulary, so classification output aligns 1:1 with what `autoFillDocument` and every downstream reader already expect.
- `buildDocsText` (`report.html:373-381`) — not called by intake, but intake's output (populated `docCategories`) is exactly what it already consumes; zero changes needed there for intake's output to flow correctly.
- The `report_drafts`-FK pattern and `DRAFT_COLUMNS` persistence convention (`report.html:386`) — `intake_review_sessions.draft_id` follows it exactly.
- RLS/`SECURITY DEFINER` helper pattern (e.g. `supabase/migrations/20260719000002_legal_intelligence_modules.sql:26`) — reused verbatim for the new table's policy.
- React 18 + Babel Standalone, no build step (`report.html:8-10`, mounted at `report.html:1384`) — new components follow the same authoring convention as the existing `ModuleCard`/`LegalIntelligenceSection`.
- **Considered, not reused as-is**: `_request`/`_parseJsonContent` (`js/ai-service.js:19-58`). Reusing them would mean either exporting them from `ai-service.js` (a trivial, additive change) or importing the whole file. For Phase 1, the recommendation is to **duplicate** the ~25-line transport helper into `intake-service.js` instead, so `js/ai-service.js` has zero diff, not even an additive one — see §3 and §14 for why a zero-diff `ai-service.js` is worth the small duplication this phase.
- **Considered, not reused as-is**: `_pdfFileToImages`/`_filesToPayload` (`js/ai-service.js:78-166`). Their *behavior* (pdf.js rendering, image conversion) is the right approach, but their *limits* (`Math.min(pdf.numPages, 20)`, `images.length > 20`) are exactly the constraint intake exists to lift. Phase 1 needs a new, separate renderer in `intake-service.js` with no such cap (bounded only by the configured ceiling) — not a modified version of the existing function, which must keep its existing behavior for its existing callers (§3).

## 3. Existing Functions/Contracts That Must Remain Untouched

- `_MODULE_IMPLEMENTATIONS`, `_SYNTHESIS_MODULE_IMPLEMENTATIONS`, `getLegalIntelligence()`'s two-pass dispatch (`js/ai-service.js:767-777, 903-905, 980-1021`) — zero changes, per explicit instruction.
- All 13 Legal Intelligence modules' compute functions and prompts.
- `DOC_CATEGORIES`' shape — Phase 1 writes into it via the same `autoFillDocument` call manual entry already uses; never adds, removes, or renames a category or field.
- `_pdfFileToImages`'s and `_filesToPayload`'s existing behavior, for their existing callers (`autoFillDocument`, `autoFillCaseHeader`) — unchanged, because those callers still legitimately want single-category-upload-scale limits.
- `report_drafts`' existing columns — the new table's `draft_id` is an additive FK, not a schema change.
- Every existing page's auth guard — `report.html:28-38` (confirmed: allows `key_admin`, `key_qc`, `key_agent`, not `external`) stays as-is; the new capability lives inside it, no new guard needed.
- `ROLE_ROUTES`, `buildHeader()` (`js/app.js`).

## 4. Required Database Tables/Migrations

**Exactly one new table** — `intake_review_sessions`, matching architecture-assessment.md §6 verbatim:

```sql
intake_review_sessions
  id                uuid primary key
  draft_id          uuid references report_drafts(id)
  user_id           uuid references profiles(id)
  status            text    -- 'processing' | 'ready_for_review' | 'confirmed' | 'abandoned'
  page_count        int
  document_groups   jsonb   -- [{groupId, pageRange, documentTypeId, mappedDocCategory,
                             --   confidence, sourceImageRefs, status}, ...]
  unrecognized_pages jsonb
  edit_log          jsonb   -- append-only: [{timestamp, actor, action, before, after}, ...]
  created_at        timestamptz
  updated_at        timestamptz
  confirmed_at      timestamptz
```

RLS: `SECURITY DEFINER`-helper pattern, scoped `draft_id → report_drafts.user_id`, same boundary as every other table.

**Explicitly not created in Phase 1**: `investigation_events`, `investigation_event_links` (architecture-assessment.md §8b — serve Health/TP adapters specifically), `claim_intelligence_adapters` (§8c — the adapter registry; meaningless with zero adapters implemented). Building these now would be exactly the premature claim-specific work the phase boundary rules out.

## 5. Required API Endpoints

**Supabase**: none beyond PostgREST's auto-generated interface over the new table (`sb.from("intake_review_sessions")...`), identical to how every other table in this app is read/written. No custom backend route.

**AI Engine** (`bima-ai-service.onrender.com`): likely **zero new endpoints**. Pass 1a (per-batch classification) and Pass 1b (seam reconciliation) are vision+reasoning calls that fit the existing generic `/ki/vision` contract — a new prompt, not a new route, the same way every one of the 13 Legal Intelligence modules is "just" a new prompt against `/ki/completion`. Pass 1c is mostly deterministic (§8) and, if it needs an AI call at all for genuinely ambiguous cases, fits `/ki/completion` the same way.

**Honest limit**: this is the client-side contract, fully verifiable from this repo. Whether `bima-ai-service.onrender.com`'s server-side implementation has any per-prompt-type limit, rate-shaping, or cost gate that would need adjustment for classification calls at intake's volume (up to 15 Pass-1a + 14 Pass-1b calls per 300-page upload) is **not verifiable from within this repository** — that's `bima-anveshak-ai`, a separate codebase not opened this session. Flagged as a cross-repo dependency to confirm before relying on "no backend changes needed" as a final answer, not assumed away.

## 6. Required Frontend/Review-Screen Components

All new components live inside `report.html`, not a new HTML page — grounded, not just asserted: `report.html` already owns `docCategories` state and `DOC_CATEGORIES`, and intake's entire purpose is to populate that same state the way manual entry already does. A separate page would need a full Supabase round-trip to hand `docCategories` back, adding a persistence hop and a navigation into what should be one continuous investigator workflow. The existing auth guard (`report.html:28-38`) already covers the right roles — no new guard needed.

- **`CombinedPdfUpload`** — file picker; runs a client-side page-count check via pdf.js *before* any network call, so ceiling rejection is free and instant.
- **`IntakeReviewScreen`** — backed by one `intake_review_sessions` row; renders `document_groups` as `DocumentGroupCard`s and `unrecognized_pages` as a separate `UnrecognizedPagesPanel`; owns the Confirm action.
- **`DocumentGroupCard`** — page range, document type (retype dropdown sourced from `DOC_CATEGORIES`), confidence badge, "inspect source pages" (opens `PageInspector`), merge/split controls. Covers 6 of the 9 required review capabilities directly.
- **`UnrecognizedPagesPanel`** — surfaces pages with no confident group; forces explicit handling (assign to a group, or explicitly leave unrecognized) before Confirm is enabled.
- **`PageInspector`** — modal showing the actual rendered page image(s) for a group or page, fetched via a signed URL from the new Storage bucket.

Together these cover all 9 capabilities from architecture-assessment.md §9: review groups, page ranges, document type, confidence, inspect source pages, merge/split, retype, handle unrecognized, explicit confirm.

## 7. Required Storage Configuration

Per architecture-assessment.md §4 (resolved): one new **private** Supabase Storage bucket (e.g. `intake-page-renders`), no public access ever, signed-URL/authenticated reads only, project-level at-rest encryption, tiered TTL (no TTL while `processing`/`ready_for_review`, 7 days after `confirmed`, 3 days if `abandoned`).

**Verified, not assumed** (re-confirmed this session via a direct, unauthenticated-beyond-anon-key API probe): `GET https://mqsohzqbsupsathxphgd.supabase.co/storage/v1/bucket` → `HTTP 200`, `[]`. Storage is live and reachable on the real project; zero buckets exist yet. Creating the bucket itself (dashboard or `service_role` step, not application code) remains a prerequisite for end-to-end testing, not for writing the code.

**Not yet decided, flagged rather than assumed**: the cleanup mechanism enforcing the TTL (Supabase `pg_cron`, an external scheduled job, or something else) hasn't been confirmed available on this project's plan — a Phase 1 decision point, called out honestly rather than assumed solved.

## 8. Required AI Classification/Reconciliation Interfaces

Per architecture-assessment.md §5a/§5b, translated into concrete call shapes:

- **Pass 1a** (per batch, parallel): input = up to 20 page images + the `DOC_CATEGORIES` title vocabulary → output `[{pageIndex, documentTypeGuess, confidence, continuesFromPreviousPage}]`.
- **Pass 1b** (per seam, parallel): input = a local context window of already-uploaded images around one batch boundary → output the shape already specified in architecture-assessment.md §5a: `{seamId, verdict: SAME_DOCUMENT|NEW_DOCUMENT|UNCERTAIN, confidence, evidence:[{signal,observation}]}`.
- **Pass 1c**: primarily **plain JS logic** over already-extracted Pass 1a/1b JSON (page-numbering-sequence checks, document-type-drift checks) — not an AI-integration task by default. An AI call is a fallback path for genuinely ambiguous coherence questions only, per §5b's own cost note ("likely a single reasoning pass or none at all"). Worth being explicit that most of Pass 1c's engineering is deterministic code, not prompt design.

**A real compatibility risk found this round, not previously considered**: every existing AI call funnels through a single, module-level serial queue — `_aiQueue`/`_runQueued` (`js/ai-service.js:11-17`). `_runQueued` chains each call onto the *same* shared promise regardless of caller, so even the existing 9-module Legal Intelligence dispatch, despite being written with `Promise.all`, has its underlying HTTP calls serialized one-at-a-time by this queue today. If Pass 1a/1b calls are routed through the same unchanged queue, the "still parallel" cost model in architecture-assessment.md §10 would be silently defeated — up to 29 calls processed one at a time instead of concurrently, at exactly the scale (300-page bundles) where that matters most. This is a genuine Phase 1 decision, not resolved here: either (a) intake's Pass 1a/1b calls bypass the shared queue and call the transport directly (real parallelism, at the cost of higher instantaneous load on `bima-ai-service.onrender.com`), or (b) they go through it and Phase 1 accepts serialized, slower processing at high page counts, revisited only if testing shows it's a real problem. Flagged, not decided, here.

## 9. Data Flow: Upload → Confirmed Document Groups

1. Investigator selects a PDF. Client-side page-count check (pdf.js, no network call). If over the configured ceiling → explicit rejection naming both numbers; no `intake_review_sessions` row created, no AI calls made.
2. Within ceiling: create the session row (`status='processing'`), render all pages to images, upload each to the new Storage bucket, recording storage keys.
3. Slice into 20-page batches (client-side, deterministic, internal-only per §1b). Dispatch Pass 1a per batch (subject to §8's queue decision).
4. Dispatch Pass 1b per seam.
5. Client-side stitching (no AI call) combines Pass 1a classifications + Pass 1b verdicts into candidate `document_groups`.
6. Pass 1c: deterministic checks over the candidate groups; AI escalation only for ambiguous cases.
7. Write candidate groups + `unrecognized_pages` into the session row, `status='ready_for_review'`.
8. Investigator uses `IntakeReviewScreen`: inspect, merge, split, retype, resolve unrecognized pages — every action appended to `edit_log`, never a silent overwrite.
9. Confirm: `status='confirmed'`, `confirmed_at` set.
10. Pass 2: for each confirmed group, call the **unchanged** `autoFillDocument({category: group.mappedDocCategory, files: group's images})`.
11. `docCategories` populated exactly as manual entry would have produced it — everything downstream is unaware intake happened.

## 10. Integration With Existing `docCategories` Without Breaking Current Workflow

- Manual per-category upload is untouched and keeps working exactly as today — Combined PDF intake is an *additional* entry point, never a replacement.
- The only write path from intake into `docCategories` is step 10 above, using the exact function manual entry already calls — by construction, not by promise, `docCategories`' shape and every downstream reader (report generation, all 13 Legal Intelligence modules, exports) needs zero changes.
- A draft that never uses intake simply has no `intake_review_sessions` row — nothing requires one, matching the existing nullable-by-default posture of `report_drafts`.
- Mixed workflows (intake most documents, manually fill a couple more) work for free, since both paths converge on the same `docCategories` state — not a special case to design for.

## 11. Security/Privacy Considerations

- Reuses the existing `key_admin`/`key_qc`/`key_agent` guard (`report.html:28-38`) — confirmed investigator/staff-only, no client (`external`) access, matching that intake is never client-facing.
- Every Storage read goes through the same Supabase JWT the rest of the app already requires; no public URLs, ever.
- Rendered page images are an *extra* copy of potentially sensitive content (medical, FIR, postmortem, depending on the claim) beyond the original file — the tiered TTL exists specifically to bound this exposure window (§7).
- `edit_log`'s append-only design is a privacy-adjacent control as much as a UX one — who touched what, when, is always reconstructable.
- RLS scoped identically to every other table — no new authorization model.
- The AI Engine call sends page *images*, not just text, to a third-party-hosted service — not new in kind (existing `autoFillDocument` already does this per document), but intake sends far more images per action (up to 300 pages) than any existing single call — same trust boundary, materially larger volume through it, worth naming even though it isn't a new risk *category*.

## 12. Error Handling and Failure/Retry Behavior

- Ceiling check happens before any network call — cheapest possible rejection point, and the one place "no silent truncation" is enforced structurally rather than by convention.
- AI Engine calls reuse the existing retry contract (exponential backoff on 429/529/503, hard redirect-to-login on 401/no-session) — inherited, not reinvented (subject to §8's queue-bypass decision).
- Per-batch/per-seam failure isolation: if one Pass 1a/1b call fails after retries, its pages land in `unrecognized_pages` rather than crashing the whole session or silently vanishing — mirrors the existing per-module independence guarantee in `getLegalIntelligence()`.
- A `processing` session that never completes (browser closed, network drop) needs a defined recovery path. Recommend **resumable** (re-attempt only failed batches — already-uploaded images persist durably in Storage independent of the browser tab) over restart-from-scratch, but this is a genuine implementation-time decision, named here, not fully resolved.
- Confirm-time failure: per-group `autoFillDocument` calls need the same independence principle — one group's extraction failing shouldn't lose the confirmation state of the others; the review screen needs a per-group retry affordance, not an all-or-nothing confirm.
- Defensive rendering from day one: this project has already found and fixed a malformed-array crash in the Legal Intelligence renderer this session (`Array.isArray()` guards). The same posture — graceful degradation, never an uncaught throw — must apply to `document_groups`/`unrecognized_pages` rendering from the start, not retrofitted after an equivalent bug surfaces here too.

## 13. Testing Strategy

Reuses this project's own established convention (`tests/vm-harness.js`, Node `vm` sandbox, no login required) rather than inventing a new one. Split between fully-automatable pure-logic tests and a smaller manual/exploratory pass for anything that genuinely requires real AI calls or real scans.

| Required scenario | Approach |
|---|---|
| Documents spanning 20-page batch boundaries | Synthetic fixture: a known document's pages straddle batch N/N+1; assert Pass 1b stitching keeps it as one group |
| Poor-quality scans | Defensive-code test (garbled/low-confidence output still produces a valid, renderable group, never a crash) + a manual pass with real scanned samples — vision quality itself isn't unit-testable |
| Mixed document types | Fixture bundle spanning several `DOC_CATEGORIES` types; assert correct per-type grouping |
| Unrecognized pages | Fixture with a page matching no category well; assert it lands in `unrecognized_pages`, never force-classified |
| Incorrect classification | Assert the retype control updates `document_groups[].mappedDocCategory` and appends to `edit_log` |
| Merge/split corrections | Assert correct before/after `edit_log` entries and reversibility (undo = inverse of the last entry) |
| PDFs near 300 pages | Assert batch/seam counts match the documented cost model (§10 of architecture-assessment.md) at the boundary |
| PDFs exceeding the ceiling | Assert explicit rejection, zero session row created, zero AI calls made |
| No silent truncation | **The single most important invariant**: for every confirmed session, every original page index appears in exactly one `document_groups[].pageRange` or in `unrecognized_pages` — never neither. A hard automated assertion, not a spot-check |

## 14. Anything That Could Affect Existing Production Behavior

- `report.html` grows further from its current 1,401 lines — a maintainability note, not a behavior change.
- The new "Upload Combined PDF" entry point visibly changes the document-upload area's layout — a real, visible UI change, even though no *existing* control's behavior changes.
- `js/ai-service.js`: recommended **zero diff** (transport helper duplicated into `intake-service.js` rather than exported) — see §2/§3.
- **AI Engine call volume**: up to 15+14=29 calls for one 300-page intake vs. 1-2 for a manual per-category upload today — a real load/cost consideration for the shared backend, independent of whether the endpoint contract changes. Directly interacts with the `_aiQueue` finding in §8 — if intake shares the existing global queue, a large intake session could queue well ahead of a concurrent Legal Intelligence refresh (from the same or a different investigator, since the queue is module-scoped, not per-session) — worth resolving deliberately, not discovering after the fact.
- Supabase Storage used for the first time in this app's history — new infrastructure with its own cost/quota profile, previously flagged, restated here as a production-impact item specifically.
- **No changes** to `report_drafts`' existing columns, any existing RLS policy, any of the 13 Legal Intelligence modules, `DOC_CATEGORIES`, exports, or any other page's auth guard/role routing.

---

**No code will be written, no migration created, until this plan is explicitly approved to proceed.**
