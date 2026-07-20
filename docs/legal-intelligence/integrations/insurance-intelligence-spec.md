# Technical Integration Specification — Insurance Intelligence

Status: **Integration-ready, not implemented.** Registry entry exists (`module_id: insuranceIntelligence`, `legal_intelligence_modules` table). No mock or placeholder logic beyond the standard "Not Performed" record — see [Module Documentation](../module-documentation.md).

## 1. Purpose

Cross-check the claimant/insured/vehicle against other insurance policies and claims history — prior claims on the same vehicle or by the same claimant, policy validity/overlap issues, and multi-insurer patterns that a single insurer's own records wouldn't surface.

## 2. Required External Data Sources

Unlike Court Case Intelligence and Litigation Intelligence, this module has a **realistic, industry-standard data source** rather than a scraping/licensing workaround:

| Source | Status | Notes |
|---|---|---|
| **Insurance Information Bureau of India (IIB)** | **Recommended, primary path** | IRDAI-backed industry data repository purpose-built for exactly this — cross-insurer claim and policy history, used by insurers today for fraud detection. This is the legitimate, established channel, not a workaround. |
| Client insurer's own IIB access | Practical access model | KEY Investigations is not itself an insurer/IIB member. The realistic integration path is querying **through the client insurer's existing IIB access** (the insurer that commissioned the investigation), not KEY Investigations obtaining independent membership. |
| Insurer-provided claim history export | Fallback | If IIB integration isn't feasible short-term, the client insurer may be able to provide relevant history directly as part of the case assignment — a manual/semi-automated interim path, not this module's primary design. |

**This is the one of the three external modules with a genuinely clean legal/industry basis** — IIB data sharing among insurers for fraud prevention is an established, IRDAI-sanctioned practice, not a novel consent question like third-party court lookups.

## 3. Expected API Contract

```
POST /ki/insurance-history-lookup
Host: bima-ai-service.onrender.com (or successor)
Auth: Supabase JWT (same _validate_jwt pattern), role in {key_admin, key_qc, key_agent}
```
A dedicated router, separate from the court-data connector — different data source, different credential, different response shape.

## 4. Request / Response JSON

**Request:**
```json
{
  "vehicleRegNo": "GJ-01-AB-5678",
  "claimantName": "Geeta Singh",
  "claimantIdentifier": { "type": "aadhar_last4", "value": "1234" },
  "requestingInsurer": "Chola MS General Insurance",
  "claimReference": "KI-1042"
}
```
`claimantIdentifier` uses only a partial/masked identifier (e.g. last 4 digits) where the underlying IIB query supports it — full identifiers are not passed through KEY Investigations' own systems where avoidable (Section 6).

**Response** — same envelope, `moduleId: "insuranceIntelligence"`:
```json
{
  "schemaVersion": "1.1.0",
  "generatedAt": "2026-08-01T10:00:00.000Z",
  "modules": [
    {
      "moduleId": "insuranceIntelligence",
      "moduleLabel": "Insurance Intelligence",
      "status": "Pending Verification",
      "summary": "Vehicle and claimant checked; 1 prior claim found on this vehicle, no overlapping policy issues.",
      "details": "Vehicle GJ-01-AB-5678: 1 prior claim — Claim No. XYZ/2023, Insurer B, own-damage, settled 2023, unrelated vehicle part. Claimant Geeta Singh: no other claims found under matched identifier.",
      "confidence": "medium",
      "source": "Insurance Information Bureau (IIB) — via [Requesting Insurer]'s member access",
      "asOf": "2026-08-01T10:00:00.000Z",
      "verifiedBy": null,
      "manualReview": false,
      "evidence": [
        { "label": "IIB record — Claim XYZ/2023", "kind": "document", "fileRef": "iib-ref-xyz-2023" }
      ],
      "references": ["XYZ/2023"],
      "lastUpdated": "2026-08-01T10:00:00.000Z",
      "version": 1
    }
  ]
}
```
`evidence` uses `fileRef` rather than a public `url` here, since IIB records are not independently web-addressable the way a court case page is — the reference is an internal bureau record ID, retrievable through the same authorized channel, not a link anyone can open.

## 5. Authentication Method

- **Client → Bima Anveshak**: same Supabase JWT pattern as every other endpoint.
- **Bima Anveshak → IIB**: credentials are the **requesting insurer's** IIB member credentials, not KEY Investigations' own — meaning this call must be made in a way that's attributable to and authorized by the specific client insurer per case, not a single shared service credential. This is a materially different trust model from the other two external modules and needs its own design pass at implementation time (likely: per-tenant credential storage, scoped to which insurer commissioned which case).

## 6. DPDP Act and Legal Considerations

The cleanest of the three external modules, but not consideration-free:

- **Legal basis**: cross-insurer fraud-prevention data sharing via IIB is IRDAI-sanctioned industry practice — closer to "contractual/regulatory necessity" than the third-party consent problem Court Case and Litigation Intelligence face.
- **Still applies**: purpose limitation (fraud investigation for this claim only), data minimization (query only what's needed to match the vehicle/claimant, not a general claimant profile), and retention consistent with the case file.
- **Attribution matters**: because access flows through the client insurer's own IIB membership (Section 2, Section 5), KEY Investigations must be able to demonstrate the query was made on that insurer's authority for that specific case — this is as much a contractual/audit requirement between KEY Investigations and its client insurers as a DPDP one.

## 7. Error Handling

| Condition | Handling |
|---|---|
| No prior history found | Not an error — valid result: "No prior claims or policy issues found for this vehicle/claimant." |
| Requesting insurer has no IIB access configured | Distinct, actionable error surfaced to the investigator (not a silent placeholder) — this is a setup/onboarding gap for that insurer client, worth knowing immediately rather than looking like "nothing found." |
| IIB service unavailable | Standard fallback to placeholder, same pattern as every other module. |
| Partial identifier match (name matches, identifier doesn't, or vice versa) | Surfaced with explicit confidence, never silently resolved (Section 14). |

## 8. Retry Strategy

Standard `_request()` backoff for the KEY Investigations ↔ Bima Anveshak leg. For Bima Anveshak ↔ IIB: follow whatever retry contract IIB's own API documentation specifies once that integration is scoped — do not assume the same 429/503 backoff pattern used elsewhere applies without checking, since IIB is a regulated industry utility, not a generic AI vendor.

## 9. Refresh Policy

Claim/policy history changes when new claims are filed, not continuously — no automatic refresh on page load. Unlike Court Case Intelligence, a fresh IIB check may be worth re-running slightly more often if a case is under active, extended investigation, since a new claim on the same vehicle *during* the investigation is itself a meaningful signal — but still investigator-triggered, not scheduled.

## 10. Database Mapping

No new column, no new table — standard `ModuleRecord`, `module_id = 'insuranceIntelligence'`, already seeded in `legal_intelligence_modules`.

## 11. UI Behaviour

Same `ModuleCard`/`LegalIntelligenceSection`, zero renderer changes. Own explicit trigger (not the shared document-based Refresh), same reasoning as the other two external modules (real cost, real consent/attribution timing). Additionally, since this module's data crosses insurer-attribution lines (Section 5), the trigger control should make clear **which insurer's access** is being used — a small but important trust-and-audit UI detail to design in at implementation time.

## 12. Evidence Mapping

Real `evidence` entries using `fileRef` (internal IIB record identifiers) rather than public URLs — see Section 4.

## 13. References Mapping

`references`: claim numbers / IIB record identifiers found, deduplicated.

## 14. Confidence Calculation

| Match quality | Confidence |
|---|---|
| Vehicle registration number exact match + claimant identifier match | high |
| Vehicle registration number match only, claimant unmatched (or vice versa) | medium |
| Fuzzy/partial match on either | low |

Module-level `confidence` = the lowest confidence among matches actually surfaced, same conservative rule as the other two external modules.

## 15. Future Implementation Checklist

- [ ] Confirm IIB integration pathway with at least one pilot client insurer (their IIB membership, their willingness to authorize per-case queries through KEY Investigations' tooling) — **blocking, do first**, this determines whether Section 2's primary path is actually available.
- [ ] Design per-tenant/per-insurer credential storage (Section 5) — a genuinely new piece of infrastructure, not a reuse of the existing single-shared-key pattern used for Anthropic/OpenAI/Gemini today.
- [ ] Legal/compliance review of the specific IIB data-sharing agreement and KEY Investigations' role as an authorized investigator acting on an insurer's behalf.
- [ ] Implement `POST /ki/insurance-history-lookup` router in `bima-anveshak-ai/apps/ai-services/routers/`.
- [ ] Implement `_computeInsuranceIntelligence` in `js/ai-service.js`, registered in `_MODULE_IMPLEMENTATIONS['insuranceIntelligence']`.
- [ ] Add the per-insurer-attribution UI trigger (Section 11).
- [ ] Automated tests: no-IIB-access-configured case, partial-match case, in addition to the standard suite.
- [ ] Confirm attribution/audit trail (which insurer authorized which query, when) is logged before enabling for any live case.
