# Module Documentation — Legal & Investigation Intelligence (v1.0)

Per-module reference. For the shared mechanics (dispatch, contract, status vocabulary), see [Architecture](architecture.md). For external modules, see their [integration specs](integrations/).

## Prompt conventions (apply to all 9 implemented modules)

Every prompt:
1. States the model's role and **explicitly disclaims what it cannot do** (no external registry access, not a legal/medical authority, cannot assess authenticity) — sets honest boundaries before asking for output.
2. Lists which document categories are relevant *if present* — never assumes they exist.
3. Instructs: only report what the text explicitly supports; if something is missing or unclear, say so rather than guessing.
4. Requires every check/finding/factor/alert to cite its source document(s).
5. Demands a single, strict JSON response shape, "no other text."

`model_tier: "fast"` (Haiku) for every module — these are structured extraction/comparison tasks, not long-form narrative writing (which is why report generation itself uses `"best"`/Opus instead).

## 1. Timeline Intelligence

- **Question**: what dated events does the case contain, in order, and are any sequences impossible?
- **Input documents**: any — reads whatever `docsText` contains, extracts dates wherever found (FIR, panchnama, PM report, discharge summary, chargesheet, etc.).
- **Response shape**: `{ events: [{date, event, source}], anomalies: [{description, severity}], confidence }`.
- **Compute function**: `_computeTimelineIntelligence` (own implementation, not shared).
- **Empty state**: `"No dated events found in the provided documents."`
- **Distinct from**: nothing else checks dates as its primary lens.

## 2. Vehicle Intelligence

- **Question**: do vehicle facts (registration, permit, fitness, policy) agree across documents?
- **Input documents**: RC, Permit, Fitness Certificate, Insurance Policy, MVI/Mechanical Inspection Report, TP Vehicle Details, Spot Panchnama, FIR, Chargesheet.
- **Response shape**: `{ checks: [{item, result, source}], discrepancies: [{description, severity, source}], confidence }` (shared shape, see below).
- **Compute function**: `_computeVehicleIntelligence` → `_computeChecksAndDiscrepancies`.
- **Empty state**: `"No vehicle-related documents found to cross-check."`
- **Distinct from**: Cross Verification Summary (which checks the *incident narrative*, not vehicle facts specifically).

## 3. Person Intelligence

- **Question**: are the parties' identity/particulars (name, age, address, relation) consistent across documents?
- **Input documents**: Particulars of Deceased/Injured, Age Proof Documents, Income Proof & Employment Details, Marriage/Dependency Proof, Insured Statement, Driver Statement, Claimant Statement(s), 161 Eyewitness Statements.
- **Response shape**: checks/discrepancies (shared).
- **Compute function**: `_computePersonIntelligence` → `_computeChecksAndDiscrepancies`.
- **Empty state**: `"No party-identity documents found to cross-check."`
- **Distinct from**: does not restate the main narrative report's own age-mismatch red flags — produces a structured, referenced cross-check table rather than prose.

## 4. Medical Intelligence

- **Question**: do medical documents *agree with each other* on stated facts?
- **Input documents**: MLC & Medical/Injury Details, Discharge Summary, Medical Bills & Expenses, Disability Certificate, Postmortem Report.
- **Response shape**: checks/discrepancies (shared).
- **Compute function**: `_computeMedicalIntelligence` → `_computeChecksAndDiscrepancies`.
- **Empty state**: `"No medical documents found to cross-check."`
- **Hard boundary**: the prompt explicitly forbids offering a clinical/medical opinion — this module checks documentation consistency (dates, wording, amounts, percentages) only, never whether treatment was appropriate. This is a deliberate, load-bearing constraint, not an oversight.

## 5. Digital Evidence Intelligence

- **Question**: what visual evidence is *described* as existing, is it complete, and does it match other accounts?
- **Input documents**: Photographs/Visual Evidence descriptions, any CCTV/dashcam mentions.
- **Response shape**: checks/discrepancies (shared).
- **Compute function**: `_computeDigitalEvidenceIntelligence` → `_computeChecksAndDiscrepancies`.
- **Empty state**: `"No visual/digital evidence documentation found in the provided documents."`
- **Hard boundary**: the prompt explicitly states this system has no access to actual image/video/file data — no authenticity, tampering, or metadata claims are made. This module reasons over *text descriptions* of evidence only.

## 6. Cross Verification Summary

- **Question**: is the core incident narrative (what happened, where, how) told the same way across the documents that each independently describe it?
- **Input documents**: FIR, Spot Panchnama, DAR (Detailed Accident Report), Site Map/Police Sketch, Chargesheet — deliberately the "narrative" document cluster, not vehicle/person/medical documents.
- **Response shape**: checks/discrepancies (shared).
- **Compute function**: `_computeCrossVerificationSummary` → `_computeChecksAndDiscrepancies`.
- **Empty state**: `"No incident-narrative documents found to cross-check."`
- **Distinct from**: Vehicle/Person/Medical Intelligence, each of which owns a narrower factual domain. This module's domain is "the story of the accident itself."

## 7. AI Investigation Findings

- **Question**: how reliable is the evidence presented — corroborated or single-source, internally thin or well-supported?
- **Input documents**: any.
- **Response shape**: `{ findings: [{observation, significance, source}], confidence }` — **own shape**, not checks/discrepancies (an evaluative judgment about evidence quality isn't the same kind of statement as a pairwise document comparison).
- **Compute function**: `_computeAIInvestigationFindings` (own implementation).
- **Empty state**: `"No notable evidence-quality findings beyond what's already in the report narrative."`
- **Hard boundary**: the prompt explicitly forbids speculating about intent, fraud, or guilt, and forbids restating the main narrative report's own findings/observations/conclusion — this is a different lens (evidence reliability), not a duplicate.

## 8. Risk Assessment

- **Question**: what document-evidenced fraud/risk indicators are present, and what's the overall level?
- **Input documents**: any.
- **Response shape**: `{ riskLevel: "low|medium|high", factors: [{factor, weight, source}], confidence }` — **own shape**. `riskLevel` is folded into `summary`/`details` text, not a new contract field (the frozen contract has no dedicated score field, and v1.0 adds none).
- **Compute function**: `_computeRiskAssessment` (own implementation).
- **Empty state**: distinguishes `riskLevel: "low"` (genuinely assessed as low, still reported) from an *undetermined* level (`"No risk level could be determined from the provided documents."`, when the model's `riskLevel` value doesn't validate against `low|medium|high`) — these are not conflated.
- **Hard boundary**: never a fraud determination — surfaces factors an investigator would want to weigh, never infers motive or guilt.

## 9. Investigator Alerts

- **Question**: what standard investigative steps or documents appear to be missing or incomplete?
- **Input documents**: any.
- **Response shape**: `{ alerts: [{alert, priority, checkedIn}], confidence }` — **own shape**. `checkedIn` (not `source`) grounds each alert in what was actually reviewed and found silent — an absence claim needs a different kind of evidence than a presence claim.
- **Compute function**: `_computeInvestigatorAlerts` (own implementation).
- **Empty state**: `"No procedural gaps identified from the provided documents."`
- **Distinct from**: AI Investigation Findings (evaluates what *exists*); this module flags what's *missing*, framed as actionable follow-ups.

## 10–12. External modules (integration-ready, not implemented)

| Module | Spec |
|---|---|
| Court Case Intelligence | [court-case-intelligence-spec.md](integrations/court-case-intelligence-spec.md) |
| Litigation Intelligence | [litigation-intelligence-spec.md](integrations/litigation-intelligence-spec.md) |
| Insurance Intelligence | [insurance-intelligence-spec.md](integrations/insurance-intelligence-spec.md) |

All three currently resolve as `status: "Not Performed"` placeholders — no logic beyond the standard `_emptyModuleRecord()`.

## Quick reference: which modules share `_computeChecksAndDiscrepancies`

Vehicle, Person, Medical, Digital Evidence, Cross Verification Summary — 5 of the 9 implemented modules. Each supplies only its own prompt builder and two message strings (`emptyMessage`, `tooLongMessage`); the parsing, formatting, `references` deduplication, and record assembly are shared, not duplicated. See [Developer Guide](developer-guide.md) for how to decide which pattern a new module should follow.
