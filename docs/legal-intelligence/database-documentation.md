# Database Documentation — Legal & Investigation Intelligence (v1.0)

Supabase project `mqsohzqbsupsathxphgd`, shared by KEY Investigations and Bima Anveshak AI.

## Tables

### `public.legal_intelligence_modules` (Layer 1 — Registry)

```sql
CREATE TABLE public.legal_intelligence_modules (
  module_id      text PRIMARY KEY,
  module_label   text NOT NULL,
  module_version int NOT NULL DEFAULT 1,
  sort_order     int NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  description    text,
  created_at     timestamptz DEFAULT now()
);
```

| Column | Purpose |
|---|---|
| `module_id` | Primary key. Matches `moduleId` in the shared JSON contract and the key used in `_MODULE_IMPLEMENTATIONS`. camelCase (e.g. `timelineIntelligence`), not snake_case — matches the contract, not SQL convention, deliberately, since this value round-trips directly into JSON. |
| `module_label` | Human-readable display name, matches `moduleLabel` in the contract. |
| `module_version` | This module *type's* own schema version — independent of the per-record `version` field in stored data (which tracks one report's module data revision) and the envelope `schemaVersion` (which tracks the overall contract shape). All three are separate counters by design. |
| `sort_order` | Display order. Seeded in steps of 10 so a future module can be inserted between two existing ones without renumbering anything. |
| `enabled` | Soft-disable a module without deleting its row (data history/audit trail preserved). `_fetchModuleRegistry()` filters `WHERE enabled = true`. |
| `description` | Catalog description, not currently surfaced in the UI — reserved for a future admin/QC module-management view. |

**RLS**: `FOR SELECT USING (true)` — public read, no authentication required. Same policy shape as the pre-existing `claim_types` table. No insert/update/delete policy — registry changes happen via direct SQL (SQL Editor or migration), deliberately, matching how `claim_types` rows are managed today.

**Seed data (v1.0, 12 rows)**:

| sort_order | module_id | module_label |
|---|---|---|
| 10 | `courtCaseIntelligence` | Court Case Intelligence |
| 20 | `litigationIntelligence` | Litigation Intelligence |
| 30 | `insuranceIntelligence` | Insurance Intelligence |
| 40 | `vehicleIntelligence` | Vehicle Intelligence |
| 50 | `personIntelligence` | Person Intelligence |
| 60 | `timelineIntelligence` | Timeline Intelligence |
| 70 | `crossVerificationSummary` | Cross Verification Summary |
| 80 | `aiInvestigationFindings` | AI Investigation Findings |
| 90 | `riskAssessment` | Risk Assessment |
| 100 | `investigatorAlerts` | Investigator Alerts |
| 110 | `digitalEvidenceIntelligence` | Digital Evidence Intelligence |
| 120 | `medicalIntelligence` | Medical Intelligence |

Migration: `supabase/migrations/20260719000002_legal_intelligence_modules.sql`.

### `public.report_drafts.legal_intelligence` (Layer 2 — Data)

```sql
ALTER TABLE public.report_drafts ADD COLUMN legal_intelligence jsonb;
```

A single nullable `jsonb` column added to the pre-existing `report_drafts` table. Stores exactly the envelope shape returned by `AIService.getLegalIntelligence()` — see [Architecture §4](architecture.md#4-the-shared-contract-frozen-v11). No structural constraint beyond "valid JSON" — the contract is enforced at the application layer (`js/ai-service.js`), not the database layer, matching the standing "don't hardcode intelligence logic in SQL" principle.

`NULL` for any draft created before this column existed, or before the investigator has clicked Refresh at least once — the UI treats `null` identically to an empty envelope (shows the "Not yet generated" state, or triggers a fresh placeholder-only fetch on load).

Migration: `supabase/migrations/20260719000001_legal_intelligence.sql`. Inherits `report_drafts`' existing RLS (owner full access; `key_qc`/`key_admin` read-all) — no new policy needed, since RLS is table-level, not column-level.

## Why two migrations, not one

`report_drafts.legal_intelligence` (data) and `legal_intelligence_modules` (registry) are deliberately separate concerns added in separate migrations — this is the DB-level expression of the Layer 1 / Layer 2 split in [Architecture §2](architecture.md#2-the-three-layer-model). A future module never needs a schema migration for either table; only a new registry *row*.

## Extending the schema (when it's actually warranted)

Adding a module: **never** requires a migration — one `INSERT` into `legal_intelligence_modules`.

A migration would only be warranted for something outside the current design entirely — e.g., a dedicated per-insurer credential store for the Insurance Intelligence integration ([spec §5](integrations/insurance-intelligence-spec.md#5-authentication-method)), which is new infrastructure, not a module addition, and is explicitly called out as a checklist item in that spec rather than assumed here.
