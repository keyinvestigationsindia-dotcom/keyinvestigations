-- ============================================================
-- Legal & Investigation Intelligence — Investigation Decision Engine (v1.1)
-- ============================================================
-- Registers the 10th module — the first synthesis-type module. Its
-- module_id is looked up in _SYNTHESIS_MODULE_IMPLEMENTATIONS
-- (js/ai-service.js), a separate map from the other 9 modules'
-- _MODULE_IMPLEMENTATIONS, so it receives the other modules' already-
-- resolved output instead of docsText. This is a plain data INSERT into
-- the existing table from 20260719000002_legal_intelligence_modules.sql —
-- no schema change, matching how every module before it was registered.
--
-- sort_order 200 deliberately leaves a large gap above the existing
-- 10-120 range so this always renders last, after whichever of the
-- still-unimplemented modules (courtCaseIntelligence, litigationIntelligence,
-- insuranceIntelligence) ship in the future.

INSERT INTO public.legal_intelligence_modules (module_id, module_label, sort_order, description) VALUES
('investigationDecisionEngine', 'Investigation Decision Engine', 200, 'Synthesises the other intelligence modules'' output into one final investigation recommendation — findings, contradictions, missing evidence, and next steps, each citing its supporting module(s). Produces a recommendation only; the insurer makes the final claim decision.');
