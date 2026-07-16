-- ============================================================
-- Report Drafts — persist Investigation Report Drafter state
-- ============================================================

CREATE TABLE public.report_drafts (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  claim_id      uuid REFERENCES public.claims(id) ON DELETE SET NULL,
  title         text NOT NULL DEFAULT 'Untitled draft',
  case_data     jsonb NOT NULL DEFAULT '{}',
  doc_categories jsonb NOT NULL DEFAULT '{}',
  extra_notes   text DEFAULT '',
  generated_report jsonb,
  updated_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_report_drafts_user ON public.report_drafts(user_id);
CREATE INDEX idx_report_drafts_claim ON public.report_drafts(claim_id);
CREATE INDEX idx_report_drafts_updated ON public.report_drafts(updated_at DESC);

ALTER TABLE public.report_drafts ENABLE ROW LEVEL SECURITY;

-- Owner can do everything with their own drafts
CREATE POLICY "drafts: owner all" ON public.report_drafts FOR ALL
  USING (user_id = auth.uid());

-- KEY admin and QC can read all drafts (for review)
CREATE POLICY "drafts: key staff read" ON public.report_drafts FOR SELECT
  USING (public.my_system_role() IN ('key_qc', 'key_admin'));

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION public.update_report_draft_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER report_drafts_updated
  BEFORE UPDATE ON public.report_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_report_draft_timestamp();
