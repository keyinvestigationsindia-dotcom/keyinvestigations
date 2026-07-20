# Technical Integration Specification — Litigation Intelligence

Status: **Integration-ready, not implemented.** Registry entry exists (`module_id: litigationIntelligence`, `legal_intelligence_modules` table). No mock or placeholder logic beyond the standard "Not Performed" record — see [Module Documentation](../module-documentation.md).

## 1. Purpose

Surface prior or ongoing litigation history — beyond the current claim's own case — involving the parties (claimant, insured, accused driver, vehicle owner), across civil and criminal matters. Where Court Case Intelligence checks "does this specific claim's case exist and what's its status," Litigation Intelligence asks the broader question: "what else has this party litigated, historically or currently."

## 2. Required External Data Sources

Same underlying constraint as Court Case Intelligence — no official public bulk API for e-Courts/NJDG. This module additionally needs **breadth of search** (across all case types and all court levels a party might appear in), which is harder for a single vendor to guarantee completely. Realistic sources, in order of practicality:

| Source | Status | Notes |
|---|---|---|
| The same licensed legal-tech vendor as Court Case Intelligence | **Recommended — reuse, don't duplicate** | Most vendors offering case-status lookup also offer a "litigant history" search against the same underlying data; a second, separate vendor contract is unlikely to be justified. |
| Vendor's civil + criminal case coverage breadth | Varies by vendor | Must be confirmed contractually — a vendor covering only certain states/court levels will produce an incomplete, not wrong, picture. `confidence`/`summary` must reflect this limitation, not overstate coverage (Section 14). |

## 3. Expected API Contract

Reuses the **same connector endpoint** as Court Case Intelligence (`POST /ki/court-case-lookup`) with a broader query mode, rather than a second endpoint — avoids duplicating the vendor-integration plumbing for what is fundamentally the same data source asked a wider question.

```
POST /ki/court-case-lookup
Body: { "parties": [...], "searchScope": "case_specific" | "full_history" }
```
`searchScope: "full_history"` is what Litigation Intelligence uses; Court Case Intelligence uses `"case_specific"`. Same auth, same router.

## 4. Request / Response JSON

**Request:**
```json
{
  "parties": [
    { "name": "Amit Patel", "role": "accused_driver", "dob": null, "address": "Ahmedabad, Gujarat" }
  ],
  "searchScope": "full_history"
}
```

**Response** — same envelope, `moduleId: "litigationIntelligence"`:
```json
{
  "schemaVersion": "1.1.0",
  "generatedAt": "2026-08-01T10:00:00.000Z",
  "modules": [
    {
      "moduleId": "litigationIntelligence",
      "moduleLabel": "Litigation Intelligence",
      "status": "Pending Verification",
      "summary": "1 party checked; 2 prior matters found for Amit Patel (accused_driver), unrelated to this claim.",
      "details": "Amit Patel: Case No. CIV/89/2022 (Civil, Ahmedabad District Court, disposed 2023) — property dispute, unrelated. Case No. MACT/301/2021 (MACT, Ahmedabad, disposed 2022) — named as accused driver in a separate motor accident claim.",
      "confidence": "medium",
      "source": "eCourts Connector v1 — [Vendor Name] (full-history search)",
      "asOf": "2026-08-01T10:00:00.000Z",
      "verifiedBy": null,
      "manualReview": false,
      "evidence": [
        { "label": "MACT/301/2021 — Ahmedabad MACT", "kind": "link", "url": "https://vendor.example/case/MACT-301-2021" }
      ],
      "references": ["CIV/89/2022", "MACT/301/2021"],
      "lastUpdated": "2026-08-01T10:00:00.000Z",
      "version": 1
    }
  ]
}
```

The second matter here — a prior, separate MACT claim naming the same accused driver — is exactly the kind of pattern this module exists to surface (repeat-party fraud patterns), distinct from Court Case Intelligence's narrower "is this claim's own case progressing normally" question.

## 5. Authentication Method

Identical to Court Case Intelligence (Section 5 of that spec) — same JWT pattern client-side, same server-held vendor credential.

## 6. DPDP Act and Legal Considerations

Everything in Court Case Intelligence's Section 6 applies here **with a stricter consent bar**, not a looser one: a full litigation history search is a broader intrusion into a third party's personal data than a single case-status check, so:

- The legitimate-interest justification must be documented per-party, not assumed globally — "checking whether this accused driver has a pattern of prior claims" is a defensible fraud-investigation purpose; "let's see everything about everyone in the file" is not.
- Results about **unrelated** litigation (the civil property dispute in the example above) should be handled carefully — it has no bearing on this claim and its inclusion should be justified only as "part of confirming the party's identity/history," not retained or referenced in the final report unless it's actually relevant.
- Recommend this module is used more selectively than Court Case Intelligence in practice — investigator-initiated per party, not a default "run for everyone."

## 7. Error Handling

Same categories as Court Case Intelligence (Section 7): no-match is a valid result, not an error; vendor timeout/auth failure degrades to placeholder; ambiguous matches are surfaced, never silently resolved. One addition specific to this module: **partial coverage** (vendor found results in some court systems but couldn't search others) must be stated explicitly in `summary`/`details`, not presented as if the search was exhaustive.

## 8. Retry Strategy

Identical to Court Case Intelligence (Section 8) — same connector, same cost-per-query caution against blind retries.

## 9. Refresh Policy

Same reasoning as Court Case Intelligence (Section 9): litigation history changes slowly, external cost per query — no automatic refresh, `asOf`-driven staleness hint, investigator-triggered re-check.

## 10. Database Mapping

No new column, no new table — standard `ModuleRecord`, `module_id = 'litigationIntelligence'`, already seeded in `legal_intelligence_modules`.

## 11. UI Behaviour

Same as Court Case Intelligence (Section 11): `ModuleCard` unchanged; needs its own explicit per-party trigger, not bundled into the free document-based Refresh. Given both modules share the same connector, consider a single combined "Run Court & Litigation Check" action in the UI that populates both module records from one vendor call — an implementation-time UI decision, not an architecture one (both still write independent `ModuleRecord`s).

## 12. Evidence Mapping

Same as Court Case Intelligence — real `evidence` entries with case URLs, populated for real (not `[]`).

## 13. References Mapping

`references`: all case numbers found across the full-history search, deduplicated.

## 14. Confidence Calculation

Same per-match name/DOB/address logic as Court Case Intelligence (Section 14), with one addition: if the vendor's coverage is known to be **partial** (Section 7), cap the module-level `confidence` at `"medium"` regardless of individual match quality — a confident match within an incomplete search is still an incomplete picture.

## 15. Future Implementation Checklist

- [ ] Confirm with the Court Case Intelligence vendor whether `searchScope: "full_history"` is available under the same contract, or requires a separate tier/agreement.
- [ ] KEY Investigations legal/compliance sign-off — stricter bar than Court Case Intelligence (Section 6), do first.
- [ ] Extend the `/ki/court-case-lookup` router (shared with Court Case Intelligence) to support `searchScope`.
- [ ] Implement `_computeLitigationIntelligence` in `js/ai-service.js`, registered in `_MODULE_IMPLEMENTATIONS['litigationIntelligence']`.
- [ ] Decide combined vs. separate UI trigger with Court Case Intelligence (Section 11).
- [ ] Automated tests: partial-coverage case, multiple-unrelated-matters case, in addition to the standard suite (no-match, vendor failure, retry).
- [ ] Confirm per-party consent/legitimate-interest documentation before enabling for any live case.
