# TP Investigation Layer — the Third Party / MACT Claim-Specific Adapter

**Status: Proposal, revised once. Not approved, not implemented, no code written.** Depends on [architecture-assessment.md](architecture-assessment.md) (the claim-agnostic common infrastructure) for confirmed documents, provenance, and the Document Timeline. This document covers what happens *after* confirmation, specifically for TP-liability and MACT investigation content.

**Revision history**: v1 (initial) → **v2, this version** (points §6 at the new export design in architecture-assessment.md §8d — closes part of REQUIRED item 3 from `FINAL-ARCHITECTURE-AUDIT.md`; no change to this adapter's own eventType/relationshipType vocabulary, which was unaffected by that audit's findings).

**One of several claim-specific adapters, not a special case.** Registered in architecture-assessment.md §8c alongside [medical-intelligence-layer.md](medical-intelligence-layer.md) (Health) and named-but-undesigned adapters for OD/Theft/PA-GPA/WC. This document covers `tp` and `mact` — the platform's two real `claim_types` (`supabase/migrations/20260509000003_multitenant.sql:127-153`) that share the same investigation document universe (FIR, Panchnama, chargesheet, vehicle documents, court process) even though they proceed through different legal fora.

## 1. Why This Document Exists, and Why It's Different From Health's

Health needed an entirely new taxonomy (medical-intelligence-layer.md §2a) because nothing like one existed in `DOC_CATEGORIES`. **TP does not** — this application's 36 existing categories (`report.html:89-362`) were already built for MACT/TP investigation; Health was the retrofit, not TP. Direct inspection of the full category list confirms `fir`, `spotPanchnama`, `dar`, `siteMap`, `photographs`, `inquestPanchnama`, `pmReport`, `statement161`, `chargesheet`, `otherPolicePapers`, `ivDriver`, `vehicleRC`, `permit`, `fitness`, `policy`, `pucCert`, `tpVehicle`, `tpInsurance`, `tpRiderDL`, `mcr`, `rtoVerification`, `prevClaimHistory` all already exist, pre-dating this proposal entirely.

So the genuinely new work here is narrower than Health's: **Layer A barely needs a compatibility map — it's close to an identity map already.** What's actually missing, same as Health, is Layer B: a normalized, dated, cross-linkable event model, because today each category is a flat form with free-text `narrative` fields, not individually dated, individually sourced facts that can be checked against each other programmatically.

**A second, non-obvious finding drives §5**: several existing categories already carry a hand-written `analysisHint` describing exactly the kind of cross-document check this layer exists to formalize — e.g. `fir`'s hint about vehicle-number consistency across FIR/RC/Policy/Permit/Fitness, or `particulars`'s hint about age/DOB consistency across Petition/FIR/PMR/Aadhar. These aren't proposed here as new ideas; they're **already-specified, already-shipped instructions** this layer turns from prose (read once, applied inconsistently by whichever AI call reads that one category) into a structured, queryable graph (checked systematically, every time, across however many documents actually got confirmed).

## 2. Layer A — Mostly Already `DOC_CATEGORIES` (Compatibility Map)

| User-named TP document type | Existing `docCategories` key | Fields | Fit |
|---|---|---|---|
| FIR | `fir` | firNo, filedBy, filedAgainst, delayReason, narrative | Exact match — and its existing `analysisHint` already flags vehicle-number mismatches across documents (§5) |
| Complaint | `fir` (if it's the FIR-triggering complaint) or `otherPolicePapers` (if separate, e.g. an RTO complaint) | — | **Named honestly as ambiguous, not forced** — "complaint" isn't a distinct category in the existing taxonomy; which of the two fits depends on what the specific document actually is |
| Spot Panchnama | `spotPanchnama` | dateTime, narrative | Exact match |
| MLC | `mlcMedical` | hospital, admissionDate, dischargeDate, natureOfInjuries, narrative | Exact match — same category Health's adapter also maps to (§6 — this is the medical/TP overlap point) |
| Postmortem | `pmReport` | dateTime, causeOfDeath, narrative | Exact match |
| Inquest Panchnama | `inquestPanchnama` | dateTime, narrative | Exact match |
| Witness statements | `statement161` | witnesses, witnessAnalysis, narrative | Exact match — **not a gap**; this category exists today with its own eyewitness-vs-arrived-after classification hint |
| Chargesheet | `chargesheet` | status, chargesheetedDriver, sections, narrative | Exact match |
| RC | `vehicleRC` (own/insured vehicle) or `tpVehicle.regNo`/`.ownerName` (third-party vehicle) | — | **Party-dependent** — see the asymmetry note below |
| DL | `ivDriver` (own driver) or `tpRiderDL` (third-party driver — its own dedicated category) | — | Party-dependent, both exist |
| Permit | `permit` (own vehicle) or `tpVehicle.permitDetails` (third-party, folded in) | — | Party-dependent |
| Fitness | `fitness` (own vehicle) or `tpVehicle.fitnessDetails` (third-party, folded in) | — | Party-dependent |
| Policy | `policy` (own vehicle) or `tpInsurance` (third-party — its own richer dedicated category: policyNo, insurer, policyPeriod, policyType, idv, coverNote) | — | Party-dependent |
| Hospital records | `mlcMedical` / `dischargeSummary` / `medicalBills` | — | **Identical to Health's own resolved map** (medical-intelligence-layer.md §2b) — direct reuse, not a new decision |
| Court documents | `claimPetition` (the petition itself only) | petitionNo, court, petitioners, respondents, causeOfAction, reliefClaimed, sectionsInvoked, remarks | **Real, named gap** — orders, judgments, and hearing records beyond the petition itself have no existing category. Consistent with Court Case Intelligence being a separately-deferred Legal Intelligence module (`docs/legal-intelligence/integrations/court-case-intelligence-spec.md`) — not a coincidence; the same gap shows up from both directions |
| Photographs | `photographs` | scenePhotos, vehicleDamage, injuryPhotos, otherEvidence, remarks | Exact match |

**Asymmetry worth naming, not hiding**: the existing taxonomy splits the *insured* vehicle's documents into four separate categories (`vehicleRC`, `permit`, `fitness`, `policy`), each with its own fields, but bundles almost all of the *third-party* vehicle's equivalent documents into one `tpVehicle` category (regNo, vehicleType, ownerName, driverName, dlDetails, insuranceDetails, permitDetails, fitnessDetails, damageDetails) — except insurance and driver DL, which get their own dedicated `tpInsurance`/`tpRiderDL` categories. This isn't something to fix here (out of scope — no `DOC_CATEGORIES` changes), but Layer B's event extraction needs to know it: IV-side and TP-side facts won't arrive at the same document-group granularity, so TP-side events will more often be extracted from one shared source group instead of four separate ones.

Not itemized above but present and relevant: `dar` (Detailed Accident Report), `siteMap`, `deathCertificate`, `legalHeir`, `particulars`, `ageProof`, `incomeProof`, `marriageProof`, `insuredStatement`, `driverStatement`, `claimantStatement`, `pucCert`, `mcr`, `rtoVerification`, `prevClaimHistory` — all already exist, all already TP-shaped, none need a compatibility decision since Pass 1 classification would target them directly by name (the same 1:1 relationship `fir`/`spotPanchnama`/etc. have).

## 3. Layer B — Normalized TP Investigation Event Model

Same shape discipline as Health (medical-intelligence-layer.md §2c/§2d): a dedicated extraction pass, separate from `autoFillDocument`, writing rows into the **same shared tables** — architecture-assessment.md §8b's `investigation_events`/`investigation_event_links` — tagged `source_adapter = 'tp'`. No new tables; this adapter contributes vocabulary, not schema.

```json
{
  "eventId": "evt_2210",
  "eventType": "firRegistration",
  "description": "FIR No. 118/2026 registered at Naranpura PS against driver of GJ-01-XX-1234",
  "date": "12/03/2026",
  "time": null,
  "actor": "Naranpura Police Station",
  "location": "Ahmedabad",
  "statusNote": null,
  "amount": null,
  "sourceDocumentGroupId": "grp_0002",
  "sourcePages": [1, 2],
  "confidence": "high",
  "extractionStatus": "extracted"
}
```

**`eventType` — a working set, extensible the same way Health's is (not exhaustive)**: `firRegistration`, `spotInspection`, `witnessStatement`, `medicolegalExamination`, `postmortemExamination`, `inquestProceeding`, `chargesheetAction`, `documentVerification` (RC/permit/fitness/policy/PUC checks — covers `rtoVerification`'s own fields directly), `licenseVerification`, `courtProceeding`.

**The medical/TP overlap is deliberate, not an oversight**: a MACT injury or death claim genuinely has both TP-investigation content (FIR, chargesheet, DL) *and* medical content (MLC, discharge summary, medical bills) in the same bundle. For the medical portion, this adapter does **not** invent a second medical-event model — it reuses the Health adapter's own `eventType` vocabulary (`diagnosis`, `treatment`, `medicine`, `procedure`, `billingItem`, `dischargeEvent`, etc., medical-intelligence-layer.md §2c) and writes those rows with `source_adapter = 'health'`, even inside a `tp`/`mact` claim. **Adapters are composable per event, not mutually exclusive per claim** — a single draft's `investigation_events` rows can legitimately carry a mix of `source_adapter` values, and that's the intended design, not a gap.

**`relationshipType`** — grounded directly in the six existing `analysisHint`s (§5), not invented abstractly: `same_vehicle_as`, `same_person_as`, `claimed_vs_verified`, `licensed_for`, `named_in`, `filed_against`.

## 4. TP Investigation Timeline (three-tier, building on common infrastructure)

Same three-tier pattern as Health (medical-intelligence-layer.md §4), reusing the **already-common** Document Timeline (architecture-assessment.md §7) rather than redefining it:

- **Document Timeline** — inherited unchanged from architecture-assessment.md §7. Not redefined here, same as Health no longer redefines it.
- **TP Investigation Event Timeline** — every Layer B event (§3) ordered chronologically; one document (e.g. a chargesheet naming several accused/sections) can contribute multiple points.
- **TP Investigation Timeline** (synthesized, report-facing) — the event timeline organized into the investigation's actual sequence: **accident → FIR → spot investigation/panchnama → MLC/postmortem → witness statements → inquest (death cases) → chargesheet → court proceedings**, running alongside a parallel, non-chronological **vehicle/documentation verification thread** (RC/permit/fitness/policy/DL validity, checked *as of* the accident date, not as of today — a permit that lapsed the week after the accident is a different finding from one that had already lapsed before it). Graph traversal over `relationshipType` edges (§3), same as Health's Patient Treatment Timeline (medical-intelligence-layer.md §4c) — an evidence-linked journey, not a sorted list, for the same reason.

## 5. TP Verification — Grounded in Existing `analysisHint`s, Not Invented

Six checks already specified in production prose today, each now expressible as a graph query over Layer B instead of a one-off instruction read by whichever single-category AI call happens to process that document:

| Existing hint (verbatim source) | What it already says | Layer B mechanism |
|---|---|---|
| `fir.analysisHint` | *"If the vehicle registration number written in the FIR differs from the number on other documents... note the exact mismatched numbers"* | `same_vehicle_as` edges between events carrying a stated vehicle number (from FIR, RC, Policy, Permit, Fitness); mismatch across linked events is the check |
| `particulars.analysisHint` | *"Carefully compare the age/DOB values given for Petition, FIR, PMR-or-MLC, and Aadhar... record both values rather than picking one"* | `same_person_as` edges between events carrying a stated age/DOB; mismatch across linked events |
| `incomeProof.analysisHint` | *"Compare the income figure in the petition with the salary certificate/proof provided. Note any discrepancy clearly."* | `claimed_vs_verified` edge between a petition-derived income event and a proof-derived event |
| `tpRiderDL.analysisHint` | *"If DL class does not match the vehicle driven, flag it as a red flag"* | `licensed_for` edge between a DL event and a vehicle event; class/vehicle-type mismatch is the check |
| `prevClaimHistory.analysisHint` | *"Previous claims or accidents involving the same vehicle or claimant are a key fraud indicator"* | **Named as a genuinely harder, out-of-scope-for-now case** — this needs identity-matching *across separate drafts/investigations*, not just across events within one draft's `investigation_events` rows. Everything else in this table is a within-draft join; this one isn't, and pretending otherwise would overstate what the schema in §3 actually supports today |
| `statement161.analysisHint` | *"classify each person based ONLY on what they explicitly say... reach the spot afterward"* | Stays a single-document classification task (already handled at extraction time by the existing hint) — not a cross-document Layer B relationship, correctly out of scope for the graph |

Same discipline as Health (medical-intelligence-layer.md §5): every one of these produces an evidence-based observation, never a fraud declaration — identical discrepancy shape (`{verificationId, type, description, severity, relatedEventIds}`), identical "no field anywhere is a verdict" constraint.

## 6. How This Surfaces

**Identical resolution to Health's (medical-intelligence-layer.md §5's "Investigation Summary — RESOLVED"), not a new decision.** No second synthesis module. TP findings enrich the **existing, unmodified** `vehicleIntelligence`, `personIntelligence`, `timelineIntelligence`, and `crossVerificationSummary` modules' `docsText` input and populate their existing `evidence`/`references` fields — the Investigation Decision Engine (`js/ai-service.js:833-901`) picks this up automatically on its next run, same generic loop, zero code changes. The full Layer B graph remains separately queryable via `investigation_events`/`investigation_event_links` (`source_adapter = 'tp'`) for its own dedicated timeline view. **Export design** for that view (how it appears in Word/PDF/Text exports) is defined once, generically, at architecture-assessment.md §8d — identical pattern to Health's, not redefined here.

## 7. Status and Open Items

Not yet decided, listed honestly rather than assumed:
- The exact `eventType`/`relationshipType` sets above are a working set grounded in the six analysisHints and the named document types — not claimed complete; a real TP bundle will likely surface event types not listed here (e.g. around inquest proceedings specifically), same "extensible, not exhaustive" caveat Health's Layer A carries.
- Cross-draft identity matching for `prevClaimHistory`-style prior-claim/accident detection is named as out of scope for this document's schema (§5) — it would need a separate, materially harder design (fuzzy matching on claimant/vehicle identity across an entire tenant's claim history), not assumed solvable by extending `investigation_event_links`.
- Court-documents gap (§2) is real and intersects with the already-deferred Court Case Intelligence integration spec — worth resolving both together if either is picked up, not independently.
- No migration, extraction pass, or verification compute logic is built. This document designs what's *possible*, matching the same scope boundary as medical-intelligence-layer.md.

---

**No code will be written until this document's, medical-intelligence-layer.md's, and architecture-assessment.md's open items are addressed or explicitly deferred.**
