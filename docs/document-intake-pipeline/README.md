# Document Intake Pipeline — Proposal Documents

**Status: Architecture approved (verdict A, see FINAL-ARCHITECTURE-AUDIT.md). Phase 1 has a written implementation plan. No application code, migrations, or implementation have started.**

**One reusable Combined-PDF pipeline, not one per claim type.** Page identification, document grouping, cross-batch reconciliation, human review, confirmed documents, provenance, and the Document Timeline are common infrastructure — built once, used by every claim type. Claim-specific intelligence (Health's Medical Events, TP's Investigation Events, and future OD/Theft/PA-GPA/WC layers) is a separate adapter built *on top of* that common layer, never inside it. See architecture-assessment.md §1a for the exact rule and §8 for the formal boundary/contract between the two.

| Document | Covers |
|---|---|
| [architecture-assessment.md](architecture-assessment.md) | **Common infrastructure**, claim-agnostic: page rendering, full-bundle batching, multi-signal boundary reconciliation + global consistency pass, encrypted server-side page-image storage, server-side auditable review/confirm state, the Document Timeline, the claim-specific adapter contract + registry, export design for adapter views, and the shared `investigation_events`/`investigation_event_links` persistence design every adapter writes into |
| [medical-intelligence-layer.md](medical-intelligence-layer.md) | **Health adapter**: document taxonomy (Layer A) with a compatibility mapping to the existing `docCategories` contract, normalized Medical Events (Layer B) with a relationship graph, the three-tier timeline (Document → Medical Event → Patient Treatment), Treatment/Medicine/Test/Procedure/Billing cross-verification |
| [tp-investigation-layer.md](tp-investigation-layer.md) | **TP/MACT adapter**: mostly-identity compatibility map onto the existing (already TP-shaped) `docCategories`, normalized TP Investigation Events, a verification set grounded directly in this app's own existing `analysisHint` prose, the TP Investigation Timeline |
| [FINAL-ARCHITECTURE-AUDIT.md](FINAL-ARCHITECTURE-AUDIT.md) | Independent end-to-end audit of the three documents above against the actual codebase; verdict A (approved), plus an addendum closing the 3 items it found REQUIRED before implementation |
| [phase-1-implementation-plan.md](phase-1-implementation-plan.md) | The common intake pipeline only (upload → confirmed document groups) — files, reused vs. untouched contracts, DB/API/frontend/storage requirements, data flow, testing strategy, production-impact assessment. Health/TP-specific work is explicitly out of scope for Phase 1 |

Read the architecture assessment first — both adapters depend on confirmed documents and the Document Timeline as their input, and neither can be understood without §8's contract.

Relationship to the frozen [Legal & Investigation Intelligence Engine](../legal-intelligence/README.md): this proposal feeds it, and does not modify it. Nothing in any document above changes the registry, the 13-module contract, the renderer, the exports, or any existing module's code.
