-- ============================================================
-- Legal & Investigation Intelligence — module registry
-- ============================================================
-- Layer 1 of the plug-in architecture (registry) — the catalog of which
-- intelligence modules exist. Same pattern as public.claim_types: a
-- public-read reference table, no application logic. Layer 2 (per-report
-- data, in report_drafts.legal_intelligence) and Layer 3 (the renderer)
-- never change when a row is added here.
--
-- Shared by both KEY Investigations and the Bima Anveshak AI Engine via
-- this same Supabase project — adding a future module (Voice
-- Intelligence, OSINT Intelligence, etc.) is one INSERT into this table,
-- no file edit or deploy in either product.

CREATE TABLE public.legal_intelligence_modules (
  module_id      text PRIMARY KEY,
  module_label   text NOT NULL,
  module_version int NOT NULL DEFAULT 1,
  sort_order     int NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  description    text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.legal_intelligence_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_intelligence_modules: public read" ON public.legal_intelligence_modules FOR SELECT USING (true);

-- sort_order in steps of 10 so future modules can slot in between
-- existing ones without renumbering anything.
INSERT INTO public.legal_intelligence_modules (module_id, module_label, sort_order, description) VALUES
('courtCaseIntelligence',       'Court Case Intelligence',       10, 'Case status, hearings, and history across court record systems.'),
('litigationIntelligence',      'Litigation Intelligence',       20, 'Prior and ongoing litigation history involving the parties.'),
('insuranceIntelligence',       'Insurance Intelligence',        30, 'Cross-insurer claim history and policy verification.'),
('vehicleIntelligence',         'Vehicle Intelligence',          40, 'Vehicle registration, ownership, and history verification.'),
('personIntelligence',          'Person Intelligence',           50, 'Identity and background verification of involved parties.'),
('timelineIntelligence',        'Timeline Intelligence',         60, 'Reconstructed event timeline across all case documents.'),
('crossVerificationSummary',    'Cross Verification Summary',    70, 'Consolidated summary of discrepancies found across documents.'),
('aiInvestigationFindings',     'AI Investigation Findings',     80, 'AI-generated investigative findings and inferences.'),
('riskAssessment',              'Risk Assessment',               90, 'Composite fraud and risk scoring for the claim.'),
('investigatorAlerts',          'Investigator Alerts',          100, 'Flags and alerts requiring investigator attention.'),
('digitalEvidenceIntelligence', 'Digital Evidence Intelligence',110, 'Digital evidence collection, authenticity, and analysis.'),
('medicalIntelligence',         'Medical Intelligence',         120, 'Medical record and treatment consistency verification.');
