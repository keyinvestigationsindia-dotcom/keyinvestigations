# API Documentation — AI Service Layer (v1.0)

`js/ai-service.js` is the single entry point for all AI communication from `report.html`. UI components never see endpoints, prompts, auth tokens, or retry logic directly — they call `AIService.<method>(...)` only.

## Base transport

- **Base URL**: `https://bima-ai-service.onrender.com` (Bima Anveshak AI Engine, FastAPI backend).
- **Auth**: Supabase JWT, attached as `Authorization: Bearer <access_token>` from `sb.auth.getSession()`. A missing session redirects to `login.html`; a `401` response does the same.
- **Retry**: `429`/`503`/`529` responses retry with exponential backoff (`2s × 2^attempt`, capped at 16s), up to 4 attempts, via `_request()`.
- **Queueing**: every call is serialized through `_runQueued()` — a single in-flight request at a time, preventing overlapping AI calls from the same browser tab.

## `AIService.autoFillDocument({ category, files }, { onStatus })`

Extracts field values for one document category from uploaded files (image/PDF/DOCX).
- **Backend**: `POST /ki/vision`, `model_tier: "fast"`, `max_tokens: 6144`.
- **Returns**: `{ [fieldKey]: string }` matching the category's field list.

## `AIService.autoFillCaseHeader({ files }, { onStatus })`

Extracts case-level header fields (claim type, claim no., court, dates, etc.) from an uploaded intimation letter/policy/RC/petition/FIR.
- **Backend**: `POST /ki/vision`, `model_tier: "fast"`, `max_tokens: 1024`.
- **Returns**: `{ claimType, claimNo, court, claimAmount, doa, ivVehicle, insured, policyNo, policyPeriod }`.

## `AIService.generateReport({ caseData, docsText, sectionKeys, extraNotes }, { onStatus })`

Drafts the full narrative investigation report (sections, red flags, findings, observations, conclusion).
- **Backend**: `POST /ki/completion`, `model_tier: "best"` (Opus — quality over cost, this is a legal/court document), `max_tokens: 16000`.
- **Returns**: `{ sections: {...}, redFlags: [...], findings: string, observations: string, conclusion: string }`.

## `AIService.generateAccidentDiagram({ accidentText }, { onStatus })`

Produces a structured top-down accident schematic.
- **Backend**: `POST /ki/completion`, `model_tier: "fast"`, `max_tokens: 1000`.
- **Returns**: `{ roadDescription, roadOrientation, vehicles: [...], impactPoint, notes, confidence }`.

## `AIService.getLegalIntelligence({ caseData, docsText } = {}, { onStatus })`

The Legal & Investigation Intelligence entry point. See [Architecture §3](architecture.md#3-module-dispatch-where-module-specific-logic-lives) for dispatch behavior.

- **Backend calls**: zero if `docsText` is omitted/empty (returns all placeholders); otherwise one `POST /ki/completion` call per module that has a registered implementation (`model_tier: "fast"`, 1500–2000 `max_tokens` depending on module), run concurrently via `Promise.all`.
- **Also queries**: `legal_intelligence_modules` (Supabase, direct client query, not through Bima Anveshak) to fetch the current registry — public read, no auth required for this specific query.
- **Returns**: the shared envelope —
  ```
  { schemaVersion: "1.1.0", generatedAt: <ISO>, modules: ModuleRecord[] }
  ```
  Always returns one record per enabled registry row, regardless of how many modules actually computed successfully. Never throws for an individual module's failure (see [Architecture §6](architecture.md#6-design-principles-binding-for-all-future-modules)).

**Full `ModuleRecord` shape**: [Architecture §4](architecture.md#4-the-shared-contract-frozen-v11).

## Internal (not public API, documented for maintainers)

| Function | Role |
|---|---|
| `_request(endpoint, body, opts)` | Raw transport — session attach, retry, 401 redirect. |
| `_parseJsonContent(response, opts)` | Validates response, strips markdown code fences, `JSON.parse`s the model's `content` field. Throws on malformed JSON or `max_tokens` truncation — callers decide how to handle. |
| `_fetchModuleRegistry()` | Reads `legal_intelligence_modules`; returns `[]` (never throws) on any failure. |
| `_computeChecksAndDiscrepancies(promptBuilder, docsText, opts)` | Shared compute path for the 5 checks/discrepancies-style modules (see [Architecture §5](architecture.md#5-module-catalog-v10)). |
| `_MODULE_IMPLEMENTATIONS` | The dispatch map — module_id → compute function. The entire module-registration seam. |

## Future endpoint (documented, not built)

`POST /ki/intelligence` on Bima Anveshak — the real backend replacement for client-side `getLegalIntelligence()` computation. Full contract documented in `js/ai-service.js` directly above `_MODULE_IMPLEMENTATIONS`, and in [Architecture §7](architecture.md#7-ownership-roadmap-rule-bima-anveshak-becomes-the-engine-key-investigations-a-client). Summary:

```
POST /ki/intelligence
Request:  { caseData: {...}, requestedModules?: string[] }   // module_id values; omit for all enabled
Response: { schemaVersion, generatedAt, modules: ModuleRecord[] }
```

Backward-compatibility rules for this future endpoint (binding once built): additive-only fields, unknown fields/modules must be ignored by clients (not fatal), module list is always response-driven (a client never assumes a fixed count), `schemaVersion` major-version bumps only gate client behavior.

## External module endpoints (documented, not built)

Court Case Intelligence, Litigation Intelligence, and Insurance Intelligence each specify their own endpoint contract, separate from `/ki/intelligence` (different cost/consent/latency profile — see each spec's §3–4):

- [`POST /ki/court-case-lookup`](integrations/court-case-intelligence-spec.md#3-expected-api-contract) — shared by Court Case and Litigation Intelligence (`searchScope` parameter distinguishes them).
- [`POST /ki/insurance-history-lookup`](integrations/insurance-intelligence-spec.md#3-expected-api-contract) — Insurance Intelligence.
