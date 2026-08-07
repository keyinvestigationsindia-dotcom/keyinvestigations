# Medical Intelligence Layer — the Health Claim-Specific Adapter

**Status: Proposal, revised three times. Not approved, not implemented, no code written.** Depends on [architecture-assessment.md](architecture-assessment.md) (the claim-agnostic common infrastructure — combined-PDF intake, batching, reconciliation, review, confirmed documents, provenance, Document Timeline) for confirmed documents as input. This document covers what happens *after* confirmation, specifically for medical-document-heavy claims.

**This is one of several claim-specific adapters, not a special case.** Architecture-assessment.md §8c registers it alongside [tp-investigation-layer.md](tp-investigation-layer.md) (TP) and named-but-undesigned adapters for OD/Theft/PA-GPA/WC. Everything in this document is specific to Health; nothing in it belongs in, or should be assumed by, the common intake layer — see architecture-assessment.md §1a for the layering rule this document is required to respect.

**Revision history**: v1 (initial two-layer model) → v2 (all four §7 open questions resolved against the actual current codebase — compatibility map, Investigation Summary reuse, claim-type deferral, persistence design — plus a relationship-graph model for the Medical Event layer) → v3 (relocated Document Timeline out of this document to architecture-assessment.md §7; migrated the persistence design to the shared `investigation_events`/`investigation_event_links` — architecture-assessment.md §8b — tagged `source_adapter = 'health'`) → **v4, this version** (closes REQUIRED item 2 from `FINAL-ARCHITECTURE-AUDIT.md`: added `admission` as a 10th `eventType` and `diagnosed_during` as the corresponding relationship edge, since the Patient Treatment Timeline chain grew a leading node the vocabulary hadn't caught up to; points §6 at the new export design in architecture-assessment.md §8d). Every resolution below was checked against the real current code (`report.html`, `js/ai-service.js`) and a live probe of the real Supabase project, not assumed — see inline citations.

## 1. Why This Is a Separate Document From the Intake Pipeline

The intake pipeline (page rendering, batching, classification, review, storage) is the same regardless of claim type. What happens with *confirmed* documents differs materially for medical content — a discharge summary isn't just "a category to fill in," it contains dozens of individually dated, individually sourced clinical facts (medicines, tests, procedures, billing line items) that a single flat category field can't hold apart. This document is that modeling work.

**Explicit instruction driving this design**: *"Do NOT make Treatment, Medicine, Test, Procedure and Billing separate document categories merely to achieve Health Claim intelligence. Treat these as investigation/intelligence dimensions derived from the confirmed source documents."* — i.e., these five things are not what gets classified in Pass 1; they're what gets *extracted and grouped* afterward.

## 2. Two-Layer Model

```mermaid
flowchart LR
    subgraph A["Layer A — Document Taxonomy"]
        direction TB
        A1[Admission Record]
        A2[Case Sheet]
        A3[Doctor Notes]
        A4[Prescription]
        A5[Medicine Chart]
        A6[Lab Report]
        A7[Radiology]
        A8[Procedure Notes]
        A9[Pharmacy Bill]
        A10[Hospital Bill]
        A11[Discharge Summary]
        A12[Follow-up / Current-Treatment Record]
    end
    subgraph COMPAT["Compatibility Layer"]
        MAP["Maps each Layer-A type\nto an EXISTING docCategories key\n(unchanged contract)"]
    end
    subgraph B["Layer B — Medical Intelligence Model"]
        direction TB
        B1[Normalized Medical Events]
    end
    A --> COMPAT
    COMPAT --> DC[("Existing docCategories\nfeeds existing Legal Intelligence modules,\nunchanged")]
    A --> B1
    B1 --> TL["Three-tier timeline — §4"]
```

### 2a. Layer A — Document Taxonomy (what Pass 1 classifies against, for medical bundles)

The classification target set for medical documents, distinct from and finer-grained than the 4 coarse existing medical categories:

| Layer A type | Typical content |
|---|---|
| Admission Record | Admission date/time, presenting complaint, initial assessment |
| Case Sheet | Ongoing clinical record maintained during the stay |
| Doctor Notes | Physician observations, daily rounds |
| Prescription | Medicines prescribed, dosage, duration |
| Medicine Chart | Medicines actually administered, by date/time (distinct from *prescribed* — the gap between the two is itself a common verification point) |
| Lab Report | Test ordered, result, reference range |
| Radiology | Imaging study and findings |
| Procedure Notes | Surgical/procedural record |
| Pharmacy Bill | Itemized medicine billing |
| Hospital Bill | Itemized room/service/procedure billing |
| Discharge Summary | Course of treatment, diagnosis, condition at discharge |
| Follow-up / Current-Treatment Record | For claims where treatment is still ongoing at the time of investigation |

This list is a starting taxonomy, not exhaustive — it should be treated as extensible the same way the Legal Intelligence module registry is (§6 notes the parallel).

### 2b. Compatibility Layer — RESOLVED (was risk 15.1 / open question §7.1)

**Inspected directly, not guessed**: the actual current field lists for all 5 medical-adjacent `DOC_CATEGORIES` entries in `report.html` (lines 140–236), the current `_buildMedicalIntelligencePrompt` text (`js/ai-service.js:529–547`), and — critically — `buildDocsText()` (`report.html:373–381`), which is what every downstream module (Medical Intelligence, Timeline Intelligence, and indirectly the Investigation Decision Engine) actually reads. It serializes each included category as `--- {category.title} ---` followed by `{field.label}: {value}` lines. That serialization is the real constraint the mapping has to respect — it determines what section header and field vocabulary the existing prompts see, not just which bucket a value is stored in.

The 5 existing medical-adjacent categories and their exact fields:

| `docCategories` key | Fields | Shape |
|---|---|---|
| `mlcMedical` | hospital, admissionDate, dischargeDate, natureOfInjuries, narrative | Clinical/narrative |
| `dischargeSummary` | hospital, admissionDate, dischargeDate, diagnosis, treatment, conditionAtDischarge, narrative, remarks | Clinical/narrative |
| `medicalBills` | hospitalName, totalAmount, billsPeriod, billBreakdown, ambulanceCharges, followUpCosts, narrative, remarks | **Billing** — every non-narrative field is a money/amount/period fact |
| `disabilityCert` | certificateNo, issuedBy, disabilityPercentage, disabilityType, bodyPart, narrative, remarks | MACT-specific, not part of Layer A |
| `pmReport` | dateTime, causeOfDeath, narrative | MACT-specific, not part of Layer A |

`disabilityCert` and `pmReport` are MACT-death/injury-specific, not general health-claim taxonomy — they're outside Layer A's scope and unaffected by this map.

Looking at the actual field shapes resolves the original either/or ambiguity: **`medicalBills`'s fields are uniformly billing-shaped** (amount, period, breakdown, charges) — there is no field there that fits a lab result, a medicine list, or a clinical note. The honest, evidence-based split is therefore binary — billing fact vs. non-billing fact — not "billing vs. clinical-detail" as originally framed:

| Layer A type(s) | Maps to existing `docCategories` key | Why |
|---|---|---|
| Admission Record, Case Sheet, Doctor Notes | `mlcMedical` → `narrative` | Clinical narrative; `hospital`/`admissionDate`/`dischargeDate` fit Admission Record directly, the rest falls to `narrative` (no dedicated field exists for ongoing clinical notes anywhere in the current contract) |
| Prescription | `mlcMedical` → `narrative` | **Deliberately not `medicalBills`** — prescribed-but-not-yet-billed is a clinical fact, not a billing fact. Keeping it out of the billing bucket is what preserves the *prescribed vs. billed* distinction the existing coarse contract can express at all |
| Medicine Chart | `mlcMedical` → `narrative` | Administered medicine is also clinical, not billing — same reasoning, and keeps it distinct from Prescription's *source group* even though both land in the same category (distinctness of prescribed vs. administered is preserved at the Layer B event level, §2c, not by the coarse category) |
| Lab Report, Radiology, Procedure Notes | `mlcMedical` → `narrative` | Clinical findings; no billing amount involved |
| Pharmacy Bill, Hospital Bill | `medicalBills` → `billBreakdown` / `totalAmount` / `billsPeriod` | Genuinely billing-shaped — canonical fit |
| Discharge Summary | `dischargeSummary` | Exact 1:1 match; `diagnosis`/`treatment`/`conditionAtDischarge` fit discharge content directly |
| Follow-up / Current-Treatment Record | `mlcMedical` → `narrative` | Closest existing fit, but **named honestly as imperfect** — no existing category has an "ongoing treatment" concept. This is a real gap the compatibility layer papers over, not a clean match |

**Named limitation, not hidden**: because Admission Record, Case Sheet, Doctor Notes, Prescription, Medicine Chart, Lab Report, Radiology, Procedure Notes, and Follow-up records all collapse into the single `mlcMedical.narrative` free-text field, **the compatibility-mapped `docCategories` output alone cannot preserve which Layer-A type or which confirmed document group a given sentence of narrative came from once several such documents are merged in.** That provenance is not lost overall — it's carried by Layer B (§2c/§2d) instead, which is exactly why Layer B has to exist as separate, structured data rather than "the compatibility map is enough." Nothing here changes `DOC_CATEGORIES` or `_buildMedicalIntelligencePrompt` — this is a lookup used when writing into existing buckets, not a schema change.

`AIService.autoFillDocument` continues to run exactly as it does today, per confirmed group, writing into these existing category buckets — Medical Intelligence and every other existing module continue reading `docCategories`/`docsText` exactly as they always have, unaware that a richer taxonomy or a second extraction pass exists.

### 2c. Layer B — Normalized Medical Event Model (persisted in the shared `investigation_events` table — architecture-assessment.md §8b)

A **new, dedicated extraction pass, run after document confirmation, separate from and in addition to** the existing `autoFillDocument` call (per the explicit instruction: *"The Medical Timeline must NOT simply be an incidental side effect of autoFillDocument"*).

Every Health-adapter event is one row in architecture-assessment.md §8b's shared `investigation_events` table, with `source_adapter = 'health'`. Shown here as the JSON shape an extraction call would produce before being written as a row — field names match that shared table exactly, including the two that were generalized this revision (`actor`, `location` — see note below):

```json
{
  "eventId": "evt_0091",
  "eventType": "admission | diagnosis | investigation | treatment | medicine | procedure | clinicalProgress | billingItem | dischargeEvent | followUp",
  "description": "Tab. Augmentin 625mg, twice daily",
  "date": "17/03/2026",
  "time": "09:00",
  "actor": "Dr. R. Sharma",
  "location": "City Hospital, Ahmedabad",
  "statusNote": "stable",
  "amount": null,
  "sourceDocumentGroupId": "grp_0007",
  "sourcePages": [14],
  "confidence": "high",
  "extractionStatus": "extracted"
}
```

Changes from v1/v2, all required by resolutions to date:
- **`eventType`** covers the full 10-node chain — **closes REQUIRED item 2, FINAL-ARCHITECTURE-AUDIT.md §6**: `admission`, `diagnosis`, `investigation`, `treatment`, `medicine`, `procedure`, `clinicalProgress`, `billingItem`, `dischargeEvent`, `followUp` — one event type per node in **Admission → Diagnosis → Investigation/Test → Treatment → Medicine → Procedure → Clinical Progress → Billing → Discharge → Follow-up/Current Treatment**. `admission` is new this revision — the chain grew a leading node since the vocabulary was first built against an earlier 9-node version of this same requirement; §4c's own narrative text already used "admission" as the timeline's start anchor, so the vocabulary was the part lagging behind, not the design. This is the Health adapter's own vocabulary for the shared table's generic `event_type` column (architecture-assessment.md §8b) — `billingItem` is deliberately shared wording, since other adapters (e.g. a future OD adapter) will have billing events too and a cross-adapter "all billing events on this draft" query should work without caring which adapter wrote them.
- **`sourcePages` (array, not singular)** — a single clinical fact (e.g. one bill line item, or a lab panel reported across a spread) can legitimately span or repeat across more than one page.
- **`extractionStatus`**: `"extracted" | "investigator_confirmed" | "investigator_edited" | "investigator_rejected"` — makes this event's place in the "AI proposes, human confirms" boundary explicit, matching the same boundary already enforced for `legal_intelligence` and `intake_review_sessions`.
- **`actor`/`location`/`statusNote`** (renamed this revision from `doctor`/`facility`/`clinicalStatus`): the underlying shared table (architecture-assessment.md §8b) uses adapter-neutral column names, since a TP event's equivalent fields hold an investigating officer/witness and a police station/court, not a doctor and a hospital. For Health-adapter rows specifically, `actor` always means the treating/examining doctor and `location` always means the facility — nothing about the Health adapter's own behavior changes, only the shared column's name.

Unchanged: `date`/`time` preserved as written in source, never reformatted at extraction time; `sourceDocumentGroupId`+`sourcePages` give source-document and page-level provenance for every event; `amount` populated only for `billingItem` events.

### 2d. Layer B — Relationship Graph (new this revision — resolves the additional architecture check)

**The Patient Treatment Timeline must be an evidence-linked clinical journey, not merely a sorted list of dates** — a flat, date-ordered list of Medical Events cannot express that a specific billing line item relates to a specific procedure, or that a specific medicine was given *for* a specific diagnosis. That requires edges between events, not just timestamps on them.

Relationships are modeled as a **separate structure from the events themselves** — not a single `parentEventId` column on each event — because the required chain is a graph, not a tree: one diagnosis commonly leads to multiple tests; one billing item can relate to both a procedure and a medicine; a discharge can follow multiple parallel treatment threads (e.g. an orthopedic issue and an unrelated infection treated in the same admission). A single parent pointer can only express one tree; real bundles routinely need more than one. This is a row in the shared `investigation_event_links` table (architecture-assessment.md §8b) — the Health adapter contributes the `relationshipType` vocabulary below; the table itself is common infrastructure, shared with every other adapter.

```json
{
  "linkId": "lnk_0037",
  "fromEventId": "evt_0091",
  "toEventId": "evt_0140",
  "relationshipType": "diagnosed_during | diagnosed_via | treated_with | medicated_with | procedure_for | progress_of | billed_as | discharged_after | followed_up_by",
  "confidence": "high",
  "evidence": "Medicine chart entry for Augmentin (17/03) cites admission diagnosis of cellulitis on the same page range."
}
```

- `relationshipType` names the exact edges in the required chain (Admission→Diagnosis→Test→Treatment→Medicine→Procedure→Progress→Billing→Discharge→Follow-up). **`diagnosed_during` added this revision** — closes the same gap as the `admission` eventType above: §2d's own stated purpose is to name every edge in the required chain, and a 10-node chain has 9 edges, not 8. Without it, this section would claim completeness while silently missing the one new edge the chain itself just gained.
- A link carries its **own** `confidence`, independent of either endpoint event's confidence — a relationship can be explicitly stated in the source or inferred from proximity/context, and those are not the same certainty.
- `evidence` is free text explaining why the link was drawn — same "every observation cites what it's based on" discipline already used for Pass 1b's seam evidence array (architecture-assessment.md §5a) and for every existing Legal Intelligence module.
- The Patient Treatment Timeline (§4c) becomes: Medical Events ordered by date, **traversed along these edges** to render the clinical narrative (e.g. "diagnosed with X → tested via Y → treated with Z → billed as W"), not just listed chronologically.

## 3. The Extended Pipeline (as specified)

```mermaid
flowchart TD
    A[Confirmed Documents\narchitecture-assessment.md §6] --> DT[("Document Timeline\narchitecture-assessment.md §7\ncommon infrastructure — NOT produced here")]
    A --> B[Medical Information Extraction\nNEW, dedicated pass — not autoFillDocument]
    B --> C[Normalized Medical Events + Links\nLayer B, §2c/§2d]
    C --> E[Medical Event Timeline\nindividual events ordered chronologically]
    DT --> F[Patient Treatment Timeline\ngraph traversal over DT + events — §4c]
    E --> F
    C --> G["Treatment/Medicine/Test/Procedure/Billing Mapping\nevents grouped BY TYPE — §5"]
    G --> H[Cross-Document Verification\nevent-level — §5]
    H --> I[Discrepancies / Red Flags]
    I --> J[Health findings]
    F -.enriches docsText + evidence/references.-> K[("Existing Timeline Intelligence,\nMedical Intelligence modules\n— unchanged code, richer input")]
    J -.enriches evidence/references, same path.-> K
    K -.consumed automatically, next run.-> L[("Existing Investigation Decision Engine\n— unchanged code — §5")]
```
**Fixed this revision**: the diagram previously showed Document Timeline as something *derived from* Medical Events (`C --> D`), which had the dependency backwards — Document Timeline is a common-infrastructure input this adapter *receives*, not something it produces. It's now shown coming from Confirmed Documents directly, matching architecture-assessment.md §7.

## 4. Three-Tier Timeline Model

The explicit distinction required: **Document Timeline → Medical Event Timeline → Patient Treatment Timeline** are three different things, not three names for the same list.

### 4a. Document Timeline — relocated to architecture-assessment.md §7
**Moved out of this document this revision.** Confirmed document groups ordered by their own date turned out to have nothing medical about it — it's exactly as applicable to a TP bundle's FIR/chargesheet/court-document sequence as to a Health bundle's admission/discharge sequence. Keeping it here, in a Health-specific document, was itself an instance of the layering leak this revision's architecture check exists to catch (see architecture-assessment.md §1a). It's now common infrastructure, produced once, and every adapter — this one included — builds its own finer-grained timeline (4b/4c below) on top of it.

### 4b. Medical Event Timeline
Every individual Medical Event (§2c), ordered chronologically. One document (a medicine chart) can contribute many points to this timeline (one per administration), which is exactly the granularity the Document Timeline can't provide.

### 4c. Patient Treatment Timeline
The synthesized, report-facing reconstruction — the Medical Event Timeline organized into a coherent treatment narrative with explicit start/end anchors: **admission → diagnosis → treatment course (medicines/tests/procedures in sequence) → discharge**, or **admission → treatment course → "ongoing as of [latest confirmed record date]"** for claims where treatment is still active, per the explicit requirement to handle both cases. This is the artifact an investigator or the report actually reads — the other two tiers are its inputs, not separately-presented outputs (though both remain queryable for provenance/drill-down).

**Resolved this revision**: this is explicitly a **graph traversal, not a sorted list** — the narrative is built by walking the `relationshipType` edges from §2d in date order (**admission → its linked diagnosis** → diagnosis's linked tests → linked treatments → their linked medicines/procedures → linked billing → discharge/follow-up), so the rendered journey shows *why* events are connected, not only *when* they happened. An event with no edges at all (an orphan) is itself a signal worth surfacing to the investigator (see §5's missing-supporting-evidence check), not silently dropped from the narrative. The chain's leading node, `admission`, is what "explicit start... anchor" in the paragraph above now resolves to as a real `eventType` rather than only a narrative phrase — closes REQUIRED item 2, FINAL-ARCHITECTURE-AUDIT.md §6.

## 5. Treatment/Medicine/Test/Procedure/Billing Mapping and Cross-Document Verification

**Mapping**: Medical Events grouped by `eventType` — `{medicines: [...], investigations: [...], procedures: [...], billingItems: [...]}`. This is a view over Layer B, not new data.

**Cross-Document Verification (event-level)** — the genuinely new analytical capability this whole layer exists to enable, checking across these groups rather than across whole documents. **Resolved this revision**: the graph (§2d) plus per-event provenance is sufficient to support all 9 verification types named in the architecture check, none requiring new fields beyond what §2c/§2d already define:

| Verification type | How the schema supports it |
|---|---|
| Prescribed vs. billed | `medicine`-type events sourced from Prescription vs. `billingItem` events, joined via a `billed_as` edge; a medicine with no such edge is flaggable |
| Billed vs. administered/documented | Three-way comparison across `medicine` events sourced from Prescription (prescribed), Medicine Chart (administered), and `billingItem` (billed) — distinguishable because each retains its own `sourceDocumentGroupId` |
| Treatment vs. diagnosis | `treated_with` edges from a `diagnosis` event; a `treatment` event with no inbound edge is flaggable |
| Procedure vs. supporting record | `procedure_for` edges; a `procedure` event expects a linked `investigation` or `clinicalProgress` event as support |
| Medicine vs. treatment duration | Compare `date`/`time` spans of linked `medicine` events against their linked `treatment` event's own span |
| Duplicate/extra billing | Group `billingItem` events by (description, amount, date) within one investigation; multiple rows with distinct `sourcePages` is the signal |
| Date inconsistencies | Compare `date` across events joined by an edge (e.g. a `billed_as` edge where the billing event predates the medicine event it bills for) |
| Missing supporting evidence | An event with zero edges where the chain would normally expect one (e.g. a `procedure` with no `procedure_for` link) |
| Treatment-sequence inconsistencies | Walk `progress_of`/chain edges in date order; flag a sequence that violates expected ordering (e.g. a `dischargeEvent` dated before a `treatment` event it links to) |

This is materially more precise than the *existing* Medical Intelligence module (which checks whether documents broadly agree — diagnosis wording, overall dates, disability percentage — not line-item medicine-by-medicine reconciliation). **It is a new capability, not a replacement of Medical Intelligence.** This table describes what the shared persistence design (architecture-assessment.md §8b) makes *possible to compute*; the compute logic itself is a future module, not built in this round.

**Discrepancy shape** (modeled on, but distinct from, the existing checks/discrepancies pattern — evidence-based, cites its sources, same discipline, different granularity):
```json
{
  "verificationId": "ver_0014",
  "type": "billed_not_administered",
  "description": "Injection X billed on 18/03 has no corresponding entry in the medicine chart for that date.",
  "severity": "high",
  "relatedEventIds": ["evt_0140", "evt_0141"]
}
```
No field here or anywhere in §2c/§2d/architecture-assessment.md §8b represents a fraud determination — `severity` is descriptive metadata on an observation ("high/medium/low"), not a verdict. This mirrors every existing module's discrepancy shape (e.g. Medical Intelligence's own `discrepancies[]`) exactly on purpose — evidence-based observations for the insurer/investigator to weigh, never automatic declarations.

**Investigation Summary — RESOLVED (was open question §7.2)**: does **not** reuse the pattern by becoming a second synthesis module. Reread against the actual `_computeInvestigationDecisionEngine` code (`js/ai-service.js:793–901`): it already loops `modules` generically — `_formatModulesForSynthesis` names zero specific `module_id`s, by design (its own comment: *"so a future 11th document-based module is included automatically"*) — so registering a second, separate synthesis module (e.g. `medicalInvestigationSummary`) would produce a **second, competing top-level conclusion** sitting next to the Decision Engine's own output. That is the "completely separate summary architecture" the instruction explicitly rejected, just wearing the same code shape.

The integration point is one layer earlier instead: Layer B's discrepancies and treatment-timeline findings become richer `docsText` input to the **existing, unmodified** `medicalIntelligence` and `timelineIntelligence` modules (already recommended in §6, item 2 below), and separately, their distilled findings populate those two modules' own `evidence`/`references` fields — fields that already exist, unmodified, in the frozen 12-field contract, e.g. `{label: "Injection X billed 18/03 — no matching medicine-chart entry", fileRef: "grp_0007 p.14"}`. Because the Decision Engine already reads every module's `summary`/`details`/`references` generically, richer Medical/Timeline Intelligence output flows into its synthesis automatically, on its very next run — **zero changes to `_computeInvestigationDecisionEngine`, `_formatModulesForSynthesis`, `_buildInvestigationDecisionEnginePrompt`, `_SYNTHESIS_MODULE_IMPLEMENTATIONS`, or `getLegalIntelligence`'s dispatch loop.** Medical-specific findings and full provenance are not lost in this compression — the complete Layer B graph with full `sourcePages`/`eventId`/edge detail still persists separately (architecture-assessment.md §8b) and drives its own dedicated "Patient Treatment Timeline" report view (§6), so the enrichment path feeds the existing synthesis a cited, distilled version while the full structured version remains independently queryable. This same reasoning is reused verbatim, adapter-for-adapter, in [tp-investigation-layer.md](tp-investigation-layer.md) §5 for TP — not a coincidence, since nothing about this argument is Health-specific either, only its inputs are.

## 6. How This Surfaces — Recommended Design

Two things happen with this layer's output, not one, satisfying both "build the dedicated new capability" and "don't replace the existing modules":

1. **New, dedicated data**: Medical Events, the three-tier timeline, and event-level verification findings are stored as their own structured data — as rows in the shared `investigation_events` / `investigation_event_links` tables (architecture-assessment.md §8b, `source_adapter = 'health'`), additive only, same non-destructive pattern as every other extension in this project — and available to a **new, dedicated report view** ("Patient Treatment Timeline") — a genuinely new capability, not hidden inside existing modules.
2. **Enrichment of existing modules, unchanged code**: the Patient Treatment Timeline and verification findings are *also* serialized into the `docsText` a health-claim draft sends to the existing `getLegalIntelligence()` call. Timeline Intelligence's existing prompt already asks for "every explicitly dated event" — richer, structured, provenance-tagged input makes its *existing, unmodified* logic produce a materially better result. Same for Medical Intelligence. **Zero code changes to either module** — this is enrichment of their input, not a rewrite of their behavior, which is exactly the "don't replace existing modules" instruction applied as literally as possible.

This mirrors the registry-based extensibility already proven for the 13-module Legal Intelligence Engine: a new capability plugs in by producing better input, not by modifying what already works.

**Export design** (how the Patient Treatment Timeline itself — not just its enrichment effect on other modules — appears in Word/PDF/Text exports) is defined once, generically, at architecture-assessment.md §8d, not redefined per adapter.

## 7. Resolution Log (was "Remaining Open Questions")

### 7.1 Where Prescription/Medicine Chart/Lab Report/etc. land in the compatibility map — RESOLVED, §2b
Binary split by whether the Layer-A type carries a billing fact, grounded in the actual field shapes of all 5 existing medical `docCategories` entries plus `buildDocsText()`'s serialization. See §2b for the full table and reasoning.

### 7.2 Does the Investigation Summary (§5) reuse the Investigation Decision Engine's pattern, or is it a new synthesis step? — RESOLVED, §5
Neither literally, nor a new synthesis step. Enrichment of Medical/Timeline Intelligence's own output (existing `evidence`/`references` fields) is the integration point — the Decision Engine already consumes it automatically, unmodified. See §5 for the full reasoning, grounded in the actual `_computeInvestigationDecisionEngine` code.

### 7.3 `report.html` has no "Health Claim" claim type today — DEFERRED (explicit decision, not an open question)
Confirmed by direct code read: the claim-type dropdown currently offers only `["MACT Death Claim", "MACT Injury Claim", "TPPD Claim"]` — no "Health Claim" option exists, even though the broader KEY Investigations platform's `claim_types` table already includes `health` as a type. **Explicit decision**: this layer stays claim-type-agnostic — it applies to any claim with medical documents (a MACT injury claim included), not gated behind a "Health Claim" type. Whether "Health Claim" becomes its own first-class investigation type with a dedicated report structure is a separate, larger product decision, out of scope here. `report.html`'s claim-type dropdown and behavior are not touched by this proposal.

### 7.4 Storage location for Medical Events (§2c) — RESOLVED, architecture-assessment.md §8b
Originally resolved (prior revision) as two Health-only tables, `medical_events`/`medical_event_links`. **Superseded this revision**: building TP's adapter (§8 below, and [tp-investigation-layer.md](tp-investigation-layer.md)) with its own duplicate pair of tables would have been exactly the "don't duplicate the pipeline per claim type" problem, one layer below where it was originally flagged. Generalized into shared `investigation_events`/`investigation_event_links` tables, tagged `source_adapter = 'health'` for this adapter's rows — full schema now lives in architecture-assessment.md §8b, since it's common infrastructure, not a Health-specific design. §2c/§2d above document the Health adapter's own `eventType`/`relationshipType` vocabulary for those shared columns.

## 8. Persistence — Where This Document's Design Now Lives

**Relocated this revision.** What used to be a full standalone schema here (`medical_events`/`medical_event_links`) is now the Health adapter's contribution to a shared design: see architecture-assessment.md §8b for the table definitions (`investigation_events`, `investigation_event_links`, RLS, auditability via `extraction_status`+`superseded_by`) and §8c for the adapter registry this document is one row of. §2c and §2d above are what this document still owns: the Health-specific `eventType` vocabulary (9 values, one per node in the required clinical chain) and `relationshipType` vocabulary (8 edge types) that populate those shared tables' `event_type`/`relationship_type` columns when `source_adapter = 'health'`.

---

**No code will be written until this document's, [tp-investigation-layer.md](tp-investigation-layer.md)'s, and [architecture-assessment.md](architecture-assessment.md)'s open items are addressed or explicitly deferred.**
