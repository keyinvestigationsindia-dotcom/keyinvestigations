-- ============================================================
-- Legal & Investigation Intelligence — permanent report section
-- ============================================================
-- Stores the 12-module shared-contract payload (see js/ai-service.js
-- LEGAL_INTELLIGENCE_MODULES / _emptyModuleRecord). All modules are
-- placeholders ("Not Performed") until a Bima Anveshak AI Engine
-- endpoint populates them — no logic lives in the database.

ALTER TABLE public.report_drafts ADD COLUMN legal_intelligence jsonb;
