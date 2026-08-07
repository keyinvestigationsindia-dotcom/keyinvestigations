# Document Intake Pipeline — Proposal Documents

**Status: Proposal only. Not approved, not implemented, no code written.**

| Document | Covers |
|---|---|
| [architecture-assessment.md](architecture-assessment.md) | Claim-type-agnostic intake mechanics: page rendering, full-bundle batching, multi-signal boundary reconciliation + global consistency pass, encrypted server-side page-image storage, server-side auditable review/confirm state |
| [medical-intelligence-layer.md](medical-intelligence-layer.md) | Health-Claim-specific: document taxonomy (Layer A) with a compatibility mapping to the existing `docCategories` contract, normalized Medical Events (Layer B), the three-tier timeline (Document → Medical Event → Patient Treatment), Treatment/Medicine/Test/Procedure/Billing cross-verification |

Read the architecture assessment first — the medical intelligence layer depends on confirmed documents as its input.

Relationship to the frozen [Legal & Investigation Intelligence Engine](../legal-intelligence/README.md): this proposal feeds it, and does not modify it. Nothing in either document above changes the registry, the 13-module contract, the renderer, the exports, or any existing module's code.
