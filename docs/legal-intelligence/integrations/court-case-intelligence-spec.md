# Technical Integration Specification — Court Case Intelligence

Status: **Integration-ready, not implemented.** Registry entry exists (`module_id: courtCaseIntelligence`, `legal_intelligence_modules` table). No mock or placeholder logic beyond the standard "Not Performed" record — see [Module Documentation](../module-documentation.md).

## 1. Purpose

Check whether the parties named in a claim (claimant, accused/TP driver, deceased, vehicle owner) have court cases — this claim's own MACT petition, and any other matters — findable in Indian court record systems, and surface their current status (pending, disposed, next hearing date) as a cross-check against what the claim documents themselves state.

## 2. Required External Data Sources

| Source | Status | Notes |
|---|---|---|
| e-Courts National Judicial Data Grid (NJDG) | No official public bulk/programmatic API | District & Taluka Court, High Court, and Supreme Court systems are separately hosted and CAPTCHA-protected; scraping is both fragile and against terms of use |
| Licensed legal-tech data vendor | **Recommended path** | Several Indian legal-tech vendors maintain compliant, licensed access to court data (via NIC partnerships or their own aggregation agreements) and expose it as a commercial API. This is the realistic integration point — not direct e-Courts access. |
| NIC-authorized institutional access | Alternative path | Requires a formal institutional relationship with NIC; not practical for a private investigation firm to obtain directly. |

**Decision required before implementation**: which licensed vendor to contract with. This spec is vendor-agnostic; Section 3 below anticipates a generic "connector" shape any compliant vendor's API can be adapted to.

## 3. Expected API Contract

A new endpoint on the Bima Anveshak AI Engine (not the existing `/ki/completion` — this needs a genuine external network call to a vendor, with its own credentials and cost model):

```
POST /ki/court-case-lookup
Host: bima-ai-service.onrender.com (or successor)
Auth: Supabase JWT (same _validate_jwt pattern as ki_drafter.py), role in {key_admin, key_qc, key_agent}
```

This is a **separate endpoint from the future `/ki/intelligence`** (documented in `js/ai-service.js`) because it has a materially different cost/latency/consent profile (external per-query vendor cost, not an LLM completion) and needs its own explicit trigger — see Section 11.

## 4. Request / Response JSON

**Request:**
```json
{
  "parties": [
    { "name": "Ramesh Kumar", "role": "claimant", "fatherName": "Suresh Kumar", "dob": "1978-04-12", "address": "Village Kheralu, District Mehsana, Gujarat" },
    { "name": "Amit Patel", "role": "accused_driver", "dob": null, "address": null }
  ],
  "claimReference": { "claimNo": "KI-1042", "caseType": "MACT Death Claim" }
}
```
`dob`/`address` are optional but materially improve match confidence (Section 14). Only send fields the investigator has actually confirmed — never a guessed DOB.

**Response:**
```json
{
  "schemaVersion": "1.1.0",
  "generatedAt": "2026-08-01T10:00:00.000Z",
  "modules": [
    {
      "moduleId": "courtCaseIntelligence",
      "moduleLabel": "Court Case Intelligence",
      "status": "Pending Verification",
      "summary": "2 parties checked; 1 additional pending case found for Amit Patel (accused_driver).",
      "details": "Ramesh Kumar (claimant): no other matters found.\nAmit Patel (accused_driver): 1 pending case — Case No. CRL/456/2025, Sessions Court, Ahmedabad, next hearing 15/09/2026 (match confidence: medium — name + address matched, DOB not available).",
      "confidence": "medium",
      "source": "eCourts Connector v1 — [Vendor Name]",
      "asOf": "2026-08-01T10:00:00.000Z",
      "verifiedBy": null,
      "manualReview": false,
      "evidence": [
        { "label": "Case No. CRL/456/2025 — Sessions Court, Ahmedabad", "kind": "link", "url": "https://vendor.example/case/CRL-456-2025" }
      ],
      "references": ["CRL/456/2025"],
      "lastUpdated": "2026-08-01T10:00:00.000Z",
      "version": 1
    }
  ]
}
```
Identical envelope and record shape to every other module — this is what "reuse the existing architecture" means concretely. The response is a normal `ModuleRecord`, not a new contract.

## 5. Authentication Method

- **Client → Bima Anveshak**: existing Supabase JWT, `_validate_jwt` + role check (unchanged pattern).
- **Bima Anveshak → vendor**: vendor API key/OAuth client credential, held server-side only (environment variable, never sent to or readable by the browser) — same posture as `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` today in `provider_factory.py`.

## 6. DPDP Act and Legal Considerations

This is the load-bearing constraint for this module, not an afterthought:

- **Consent basis differs by party.** Looking up the **insured/policyholder** is generally covered by the existing claim-processing relationship (contractual necessity). Looking up a **third party** (accused driver, TP claimant, a witness) who is not a policyholder has **no existing relationship basis** — querying their court history requires either their own consent (rarely practical to obtain) or a documented legitimate-interest basis specific to fraud investigation, which itself needs to be recorded, not assumed.
- **Purpose limitation.** Data obtained must be used only for this claim's investigation, not retained or reused for any other case involving the same person.
- **Data minimization.** Request only the fields needed to match a party (name, and only DOB/address if already known from the claim file) — never a broader "look up everything about this person."
- **Retention.** Court case results should follow the same retention policy as the rest of the case file, not persist independently or longer.
- **Recommendation**: this module should not go live without KEY Investigations' own legal/compliance sign-off on the specific consent language and the specific vendor's data-handling terms. This spec does not substitute for that review.

## 7. Error Handling

| Condition | Handling |
|---|---|
| No match found | **Not an error.** Valid result: `status: "Pending Verification"`, `summary: "No matching court records found for the parties checked."` — never surfaced as a failure. |
| Vendor timeout | Falls back to the existing dispatch pattern — placeholder (`"Not Performed"`), logged server-side, same as any other module's `try/catch` in `getLegalIntelligence()`. |
| Vendor auth/quota failure | Same fallback; additionally alert KEY Investigations admin (vendor account issue, not a per-case problem) — this is the one case worth a distinct ops alert, since it silently degrades every future lookup until fixed. |
| Ambiguous/multiple matches | Return all candidate matches in `details` with their individual confidence, do not silently pick one — the investigator decides, matching "never fabricate/never guess." |

## 8. Retry Strategy

Reuse the existing `_request()` retry pattern (429/503/529 → exponential backoff, capped retries) for the KEY Investigations ↔ Bima Anveshak leg. For the Bima Anveshak ↔ vendor leg: **do not blindly retry** on a paid-per-query vendor API without idempotency confirmation — a naive retry could double-bill. Recommended: retry only on connection-level failures (no response received), not on any response the vendor actually returned, paid-for or not.

## 9. Refresh Policy

Court case status changes over weeks/months, not minutes — unlike document-based modules (cheap to recompute), each refresh here has a real external cost. Recommendation:
- No automatic refresh on page load or as part of the generic "Refresh" button used by the 9 document-based modules (Section 11).
- `asOf` drives a UI hint: "Last checked DD/MM/YYYY — court status may have changed since." No enforced expiry; the investigator decides when a fresh check is worth the cost.

## 10. Database Mapping

**No new column, no new table.** The result is a standard `ModuleRecord` inside the existing `report_drafts.legal_intelligence` jsonb array, exactly like the 9 document-based modules already store. `legal_intelligence_modules.module_id = 'courtCaseIntelligence'` already exists from the original seed — no migration needed to activate this module once implemented.

## 11. UI Behaviour

- Same `ModuleCard` renders it — zero renderer changes (proven by the document-based modules; this module produces the same record shape).
- **Trigger is NOT the shared "Refresh" button.** Because this module has a real external cost and a distinct consent-timing requirement (Section 6), it needs its **own explicit action** — a "Run Court Case Check" control scoped to this module only, separate from the free, instant document-based Refresh. This is a UI addition to make when implementing, not a renderer redesign.
- Evidence links (Section 12) should be rendered as clickable — `ModuleCard` already has the data shape (`evidence: [{label, kind, url}]`) but does not currently render evidence items (only `references` is shown today). Rendering `evidence` entries is a small, additive UI change to make when this module is implemented — not required now.

## 12. Evidence Mapping

Unlike document-based modules (which honestly report `evidence: []` — no real file/URL exists for pasted text), this module has genuine evidence to cite: `{ label: "Case No. X — Court", kind: "link", url: "<vendor case URL>" }`. Populate `evidence` for real here; this is the first module where that field carries data.

## 13. References Mapping

`references`: array of case numbers found (e.g., `["CRL/456/2025"]`) — deduplicated, matching the pattern already used by every document-based module.

## 14. Confidence Calculation

Not a single global confidence — per-match, driven by how many identifying fields corroborated the match:

| Fields matched | Confidence |
|---|---|
| Name + DOB + address/state | high |
| Name + one of (DOB, address) | medium |
| Name only (common name, no other field to disambiguate) | low |

Module-level `confidence` = the lowest confidence among any match actually surfaced in `details` (conservative — never overstate).

## 15. Future Implementation Checklist

- [ ] KEY Investigations legal/compliance sign-off on consent language and vendor terms (Section 6) — **blocking, do first**.
- [ ] Select and contract a licensed court-data vendor.
- [ ] Implement `POST /ki/court-case-lookup` in `bima-anveshak-ai/apps/ai-services/routers/` (new router; do not extend `ki_drafter.py`, which is KEY-Investigations-specific plumbing).
- [ ] Add vendor credentials to Bima Anveshak's server-side environment config.
- [ ] Implement `_computeCourtCaseIntelligence` in `js/ai-service.js`, registered in `_MODULE_IMPLEMENTATIONS['courtCaseIntelligence']` — same pattern as the 9 existing modules.
- [ ] Add the module-specific "Run Court Case Check" trigger control in `report.html` (Section 11).
- [ ] Add evidence-item rendering to `ModuleCard` (Section 11) — benefits all future modules with real evidence, not just this one.
- [ ] Automated tests mirroring the existing suite: mocked vendor response, no-match case, ambiguous-match case, vendor failure, retry behavior.
- [ ] Confirm this module's data source and consent basis are documented in KEY Investigations' own DPDP records before enabling for any live case.
