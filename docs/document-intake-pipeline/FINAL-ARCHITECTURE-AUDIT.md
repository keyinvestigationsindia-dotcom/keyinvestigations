# Document Intake Pipeline — Final Architecture Audit

**Independent re-verification of `architecture-assessment.md`, `medical-intelligence-layer.md`, and `tp-investigation-layer.md` against each other and against the actual current application code. Documentation-only — no application code, database schema, or migrations were touched to produce this audit.**

Method: every document was re-read in full, fresh (not from memory of writing it). Every load-bearing code claim was re-verified against `report.html`/`js/ai-service.js`/`supabase/migrations/` with `grep`/`Read`, not assumed. Supabase Storage availability was re-checked live. `git log`/`git status` were checked to confirm zero application-code commits have occurred during this entire proposal's lifetime.

## 1. Combined PDF Intake

| Requirement | Status | Evidence |
|---|---|---|
| One PDF can contain many documents | PASS | architecture-assessment.md §3 pipeline, Pass 1a/1b/1c |
| Support up to the configured 300-page ceiling | PASS | §3 diagram node A |
| 20-page batches are internal-only | PASS | §3 node C: "internal API constraint only"; grounded in the real `_filesToPayload` 20-image limit (`js/ai-service.js:164`, re-verified this pass) |
| A document may start in one batch and continue into another | PASS | §5a/§5b — the entire point of seam reconciliation + global consistency |
| No boundary tied to a batch boundary | PASS | Same |
| **No pages silently dropped or truncated** | **GAP FOUND** | See below |

**Finding**: §11's risk table still says *"Silent page loss on large bundles \| Resolved by design (v2 §5)"* — but this document was fully rewritten and renumbered in the layering-separation revision; **the current §5 is "Boundary Reconciliation," not the batching/ceiling content that lived at that number in v2.** The citation is stale. Following it today does not explain what happens to a bundle *over* 300 pages. The explicit, hard requirement from an earlier round of this thread — configurable ceiling, **no silent truncation beyond it, explicit rejection instead** — is no longer stated anywhere in the document's current body text, only implied by "up to configured ceiling" in one diagram label. Separately, the invariant that makes "no silent drop" checkable — every uploaded page must land in exactly one `document_groups` entry or `unrecognized_pages`, with counts summing to `page_count` — is never stated explicitly either, only inferable from §6's schema.

→ **REQUIRED BEFORE IMPLEMENTATION**: restate the over-ceiling rejection behavior and the page-accounting invariant as explicit text (§1 or §3), not a cross-reference to a section number that no longer holds that content.

## 2. Document Identification & Grouping

Page-level classification (Pass 1a), multi-page grouping, cross-batch seam reconciliation (§5a), `SAME_DOCUMENT`/`NEW_DOCUMENT`/`UNCERTAIN` with evidence+confidence (§5a output shape), global consistency check after local decisions (§5b) — **all PASS**, all present with concrete schemas, all re-read fresh this pass.

## 3. Human Review

All 9 named capabilities (page ranges, document type, confidence, inspect source pages, merge, split, retype, handle unrecognized, explicit confirm) — §9, backed by the server-side `intake_review_sessions` table (§6), not client state. `edit_log` is append-only with before/after snapshots — **auditable and reversible, PASS**. Nothing writes to `report_drafts.doc_categories` until `status = 'confirmed'` — confirmed against the real `AIService.autoFillDocument` call pattern.

## 4. Provenance

`investigation_events` carries `source_document_group_id`, `source_pages` (array), `confidence` as direct columns — 3 of 4 named requirements as explicit columns. The 4th, "relevant evidence," has no dedicated column on `investigation_events` itself — only on `investigation_event_links`.

**On inspection this is very likely a deliberate, correct choice** (an event's `description` + its source fields already constitute its evidence; a *link* is an inference about a relationship between two facts and needs its own justification beyond either endpoint), **but the documents never state this reasoning explicitly** — a reader applying the checklist literally would flag "evidence" as a missing column.

→ **IMPLEMENTATION DETAIL**: add one sentence to §8b stating why `evidence` lives on links, not events.

## 5. Common vs. Claim-Specific Architecture

Re-verified against the actual `DOC_CATEGORIES` array (`report.html:89-362`, still 36 entries, recounted this pass) and the actual `claim_types` seed data (`supabase/migrations/20260509000003_multitenant.sql:127-153`, re-read this pass: `motor_od`, `motor_theft`, `health`, `mact`, `tp`, `non_motor` — unchanged). All eight sub-points **PASS**:
- Intake, grouping, review, provenance, Document Timeline are claim-agnostic (architecture-assessment.md §1a states the rule; §7 relocates Document Timeline out of the Health-specific document where it previously, incorrectly, lived).
- Shared investigation event contracts are claim-agnostic — `investigation_events`/`investigation_event_links` (§8b) are one schema, not per-claim-type duplicates; confirmed by direct inspection, no `medical_events` or `tp_events` tables exist anywhere in any document.
- Health, TP, OD, Theft, PA/GPA, WC are registered as peer rows in `claim_intelligence_adapters` (§8c), not special-cased in code anywhere.
- No duplicated Combined PDF pipelines — exactly one `intake_review_sessions`, one `investigation_events`, one `investigation_event_links` table in the entire proposal.

**Minor gap**: `investigation_events.source_adapter` is typed plain `text`, not constrained by `references claim_intelligence_adapters(id)` — nothing stops a typo'd adapter tag from being silently inserted once this becomes a real migration. → **IMPLEMENTATION DETAIL**.

## 6. Health Claim Intelligence

The pipeline chain (medical-intelligence-layer.md §3 mermaid) matches the required sequence with one correct, deliberate deviation: Document Timeline is drawn as a parallel input from Confirmed Documents, not a sequential step after Medical Events — this is **more correct** than a literal reading of the checklist's chain, and matches the already-documented fix ("Document Timeline is a common-infrastructure input this adapter *receives*, not something it produces").

**Real gap found**: the checklist's required chain for this round is **Admission → Diagnosis → Investigation → Treatment → Medicines → Procedures → Clinical Progress → Billing → Discharge → Follow-up/Current Treatment** — 10 nodes, with **Admission** newly leading the chain. The current `eventType` vocabulary (§2c) has exactly 9 values — `diagnosis, investigation, treatment, medicine, procedure, clinicalProgress, billingItem, dischargeEvent, followUp` — matching an *earlier* round's 9-node chain (which did not include Admission as its own node). **There is no `admission` eventType today**, even though §4c's own narrative text uses "admission" as the timeline's start anchor. This isn't a mistake in the earlier work — the required chain genuinely grew a node between rounds — but it's a real, precise, checkable gap against the current requirement.

→ **REQUIRED BEFORE IMPLEMENTATION**: add `admission` as a 10th `eventType` value in §2c, matching the same convention as the other nine.

Graph-not-list requirement (§2d, §4c): **PASS**, re-verified — the relationship-link table and the "traversed along these edges" language are both present and consistent.

## 7. TP Investigation Intelligence

Every named document type (FIR, complaint, Spot Panchnama, MLC, Postmortem, Inquest Panchnama, witness statements, chargesheet, RC, DL, permit, fitness, policy, hospital records, court documents, photographs) is addressed in tp-investigation-layer.md §2's compatibility table, re-verified this pass against the actual `DOC_CATEGORIES` field lists (re-read `report.html:89-362` in full this audit, not from memory) — including honest, non-forced treatment of the two genuine gaps (complaint, court documents beyond the petition itself). **PASS.**

Accident/Police/Vehicle/Legal Investigation Timeline, evidence-linked, feeding cross-verification/discrepancies/the Investigation Decision Engine — §4, §5, §6, all present and internally consistent. **PASS.**

## 8. Existing System Compatibility

| Existing system | Status |
|---|---|
| `docCategories` | Unmodified — confirmed, still 36 entries, recounted this pass |
| `autoFillDocument` | Reused unchanged — call sites and signature confirmed unchanged this pass |
| Timeline Intelligence, Medical Intelligence | Enrichment-only via `docsText` + `evidence`/`references` — mechanically confirmed this pass: `refreshLegalIntelligence()` (`report.html:933-941`) builds `docsText` fresh from `docCategories` on every call and passes it straight to `getLegalIntelligence()`, so any enrichment strategy that lands in `docCategories`/`docsText` flows through with zero changes to either module |
| Cross Verification, Investigator Alerts, Risk Assessment | **Partially unaddressed in the docs, though mechanically sound** — see below |
| Investigation Decision Engine | Compatible, re-verified against the actual `_computeInvestigationDecisionEngine`/`_formatModulesForSynthesis` code this pass — no change needed, confirmed generic |
| Report generation/export behavior | **Gap — see below** |

**Finding A**: `_MODULE_IMPLEMENTATIONS` (re-confirmed at `js/ai-service.js:767`, unchanged) dispatches the **same shared `docsText`** to all nine document-based modules, not per-module inputs — re-verified via `getLegalIntelligence`'s dispatch loop (`js/ai-service.js:980-993`). This means enriching `docsText` benefits *every* document-based module generically, including Investigator Alerts and Risk Assessment — but neither adapter document's §6 names these two explicitly (medical names Timeline/Medical Intelligence; TP names Vehicle/Person/Timeline/CrossVerificationSummary). Substantively fine; not stated as explicitly as it should be given the checklist names both directly. → **IMPLEMENTATION DETAIL**.

**Finding B**: neither document designs how the new dedicated "Patient Treatment Timeline" or "TP Investigation Timeline" report views would render in the existing `downloadAsWord`/`downloadAsPDF`/`downloadAsText` export functions. The *existing* Legal Intelligence section's exports already improve for free via the `docsText` enrichment path (no gap there) — but the *new* dedicated views' own export story is genuinely undesigned. → **REQUIRED BEFORE IMPLEMENTATION OF THE DEDICATED VIEWS** specifically (does not block the core intake/enrichment pipeline, which has no export-design dependency).

## 9. Data Model

Audited `intake_review_sessions`, `investigation_events`, `investigation_event_links`, `claim_intelligence_adapters`, persistence, provenance, confidence, extraction status, audit history — no duplicated or conflicting contracts found (this is the main thing last round's generalization was for, and it holds). Two completeness gaps, both cosmetic:
- RLS is stated explicitly for `investigation_events`/`investigation_event_links` (§8b) but only implied by precedent for `intake_review_sessions` (§6) and `claim_intelligence_adapters` (§8c) — same `SECURITY DEFINER`/`draft_id → report_drafts.user_id` pattern presumably applies, and `claim_intelligence_adapters` presumably gets the same "public read" policy as `claim_types`/`legal_intelligence_modules` (confirmed both use `FOR SELECT USING (true)` in the real migrations), but neither is spelled out for the two newer tables. → **IMPLEMENTATION DETAIL**.
- `investigation_events.review_session_id` → `intake_review_sessions.id` is nullable, but no document states the intended lifecycle rule (rows should only be written once the owning session reaches `confirmed`) as an explicit constraint. → **IMPLEMENTATION DETAIL**.

## 10. Storage & Security

Re-verified live this pass, not reused from a prior round: `GET https://mqsohzqbsupsathxphgd.supabase.co/storage/v1/bucket` with the app's own public anon key → `HTTP 200`, body `[]`. Storage is provisioned and reachable; zero buckets exist. Not verifiable from a static site with only an anon key: plan-tier quota, bucket-creation permission — named explicitly as an implementation prerequisite (§2, §11), not assumed available. Server-side/authenticated/no-public-URL/configurable-TTL/cleanup design (§4) — **PASS**, tiered TTL with an explicit trade-off, not a placeholder.

## 11. Implementation Readiness — Full Classification

**BLOCKER**: none found.

**REQUIRED BEFORE IMPLEMENTATION**:
1. Restore an explicit "reject bundles over the configured ceiling; no silent truncation" statement plus the page-accounting invariant, replacing the stale `(v2 §5)` citation (§1).
2. Add `admission` as a 10th Health `eventType` value (§6).
3. Design export rendering for the two new dedicated timeline views before building them (§8) — scoped to those views only, not the core pipeline.

**IMPLEMENTATION DETAIL** (7 items, none architectural, all normal engineering decisions to make while building):
4. Clarify why `evidence` lives on links, not events (§4).
5. Add an FK from `investigation_events.source_adapter` to `claim_intelligence_adapters.id` (§5).
6. State RLS explicitly for `intake_review_sessions` and `claim_intelligence_adapters` (§9).
7. State the intended `review_session_id` → `confirmed` lifecycle rule (§9).
8. Name Investigator Alerts and Risk Assessment explicitly as enrichment beneficiaries, or state the general "all nine modules share `docsText`" rule once instead of naming a subset per adapter (§8).
9. Fix `medical-intelligence-layer.md` §7.4's ambiguous "§8 below" self-reference (means architecture-assessment.md §8, reads as this document's own §8).
10. Align the two documents' line-citations for `_computeInvestigationDecisionEngine` (medical cites `793-901`, TP cites the more precise `833-901`).

**FUTURE ENHANCEMENT**:
11. `report.html`'s existing `typeMap` (line 617) only maps 3 of the 6 real `claim_types` (`mact`, `motor_od`, `tp` — missing `health`, `motor_theft`, `non_motor`). **Newly found this audit**: linking a real Health/Theft/Non-Motor claim into the Report Drafter today silently leaves `claimType` at its previous value (typically the default "MACT Death Claim") instead of reflecting the actual type. This is a **pre-existing gap in the current shipped app**, unrelated to and not blocking this proposal — the Health/TP adapters are correctly claim-type-agnostic and don't read `caseData.claimType` for their own logic — but it's directly relevant background for the already-deferred "Health Claim claim type" product decision, so it's named here rather than left for someone to rediscover later.
12. OD/Theft adapters (named, not designed) and PA/GPA/WC (not even real `claim_types` yet) — already correctly scoped as future work in the registry, not a defect.
13. Cross-draft identity matching for prior-claim/accident pattern detection (tp-investigation-layer.md §7) — already explicitly named out of scope by that document itself.

## 12. Final Verdict

### A. APPROVED FOR IMPLEMENTATION

No blocker was found in either the common infrastructure or either claim-specific adapter. The layering principle holds under direct inspection (one intake pipeline, one shared event schema, adapters as registry rows, not code branches) and every load-bearing claim about the *existing* application — `DOC_CATEGORIES`, `buildDocsText`, `autoFillDocument`, the module dispatch maps, the Investigation Decision Engine's generic loop, `report_drafts`' schema, Supabase Storage's live state — was re-verified against the real code and database during this audit, not assumed from earlier rounds.

Approval is **conditional on closing the 3 REQUIRED BEFORE IMPLEMENTATION items** above first (§11) — each is a small, precisely-scoped content gap (a stale cross-reference, a missing enum value, an undesigned export path for two new views), not a design flaw, and none requires revisiting the architecture itself.

**Recommended phase sequence (not executed — listed only)**:
- **Phase 0** (docs): close the 3 REQUIRED items.
- **Phase 1** (common infrastructure): `intake_review_sessions`, `investigation_events`, `investigation_event_links`, `claim_intelligence_adapters` migrations (registry seeded with all 6 rows); Storage bucket + policies; Pass 1a/1b/1c; review screen UI; Pass 2 via unchanged `autoFillDocument`. Delivers value standalone — a combined-PDF-to-`docCategories` pipeline, independent of any adapter.
- **Phase 2** (Health adapter): extraction pass, `source_adapter='health'` events/links, Patient Treatment Timeline, `docsText` enrichment.
- **Phase 3** (TP adapter): same shape, `source_adapter='tp'`.
- **Phase 4** (verification compute logic): the 9 Health + 6 TP verification checks as real queries over the graph — explicitly not built by either adapter document, this is where that happens.
- **Phase 5** (dedicated views + exports): the two new timeline views and their Word/PDF/Text rendering, per whatever Phase 0 designs.
- **Phase 6** (future, separate approval): OD, Theft, then PA/GPA/WC once those claim types exist.

---

**End-of-audit confirmations**:
- Application code modified: **No.**
- Database schema/migrations modified: **No** — `supabase/migrations/` contains the same 8 files as before this audit; none created, none altered.
- Implementation started: **No** — `git log`/`git status` re-checked this pass; the last commit touching `report.html`, `js/ai-service.js`, or `supabase/migrations/` predates this entire Document Intake Pipeline proposal.
- Final architecture verdict: **A — Approved for implementation, conditional on the 3 REQUIRED BEFORE IMPLEMENTATION items in §11.**

---

## Addendum — Closure of the 3 REQUIRED BEFORE IMPLEMENTATION Items

*Appended, not edited into the findings above — the audit findings stand as the record of what was found on that pass; this addendum records what changed afterward.*

All three closed, documentation-only, in a single follow-up round:

1. **300-page ceiling** — architecture-assessment.md gained a new §1b restating the full requirement in explicit text (configurable ceiling, explicit rejection over it, never silent truncation, 20-page batch is internal-only and orthogonal to the ceiling, raising the ceiling later is a config change grounded in the fact that no pipeline stage hardcodes a page/batch count) — no longer only a cross-reference to a section number that had gone stale. §11's risk-table row was fixed to point at §1b instead of the stale `(v2 §5)` citation.
2. **Health `eventType` — admission** — medical-intelligence-layer.md §2c gained `admission` as a 10th `eventType`; §2d gained `diagnosed_during` as the corresponding 9th relationship edge (a 10-node chain has 9 edges, not 8 — needed for §2d's own claim of naming every edge to still be true); §4c's traversal description now starts from admission explicitly.
3. **Export design** — architecture-assessment.md gained a new §8d defining, generically for any adapter, how a dedicated timeline view appears in Word/PDF/Text exports (placement, appears-only-when-populated, per-row shape covering date, stage, description, source provenance, confidence, plus a discrepancy list) — design only, no export code written. Both adapter documents' §6 now point to it instead of leaving the question open.

Verified before and after this closure round: `git diff --stat report.html js/ai-service.js supabase/` empty both times. `report.html`'s pre-existing `typeMap` gap (originally item 11 in §11's FUTURE ENHANCEMENT list) was deliberately left untouched, as instructed — it isn't required for any of the three items above.

**Updated implementation-readiness status**: all 3 REQUIRED BEFORE IMPLEMENTATION items are closed. 0 BLOCKER, 0 REQUIRED remain open. The 7 IMPLEMENTATION DETAIL and 3 FUTURE ENHANCEMENT items from §11 are unchanged and, by their own classification, do not gate implementation. **Verdict: A — Approved for implementation**, no longer conditional.
