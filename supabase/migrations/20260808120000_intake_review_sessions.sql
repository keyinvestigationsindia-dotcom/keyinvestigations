-- ============================================================
-- Combined PDF Intake — server-side review/intake session
-- ============================================================
-- Phase 1 of the Document Intake Pipeline (see
-- docs/document-intake-pipeline/architecture-assessment.md §6 and
-- phase-1-implementation-plan.md §4). Common, claim-agnostic
-- infrastructure only — no Health/TP/OD/Theft-specific columns or
-- tables here; this table has no notion of claim type.
--
-- Additive only: no change to report_drafts' existing columns. Nothing
-- writes to report_drafts.doc_categories until an investigator explicitly
-- confirms a session (status = 'confirmed') — see js/intake-service.js.

CREATE TABLE public.intake_review_sessions (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id           uuid REFERENCES public.report_drafts(id) ON DELETE CASCADE NOT NULL,
  user_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status             text NOT NULL DEFAULT 'processing'
                       -- 'error' added beyond architecture-assessment.md §6's original 4 values —
                       -- Phase 1's error-handling requirement: a session that cannot reach a
                       -- trustworthy grouping result must stay visibly in an error state, never
                       -- silently guess or masquerade as 'abandoned' (which means the investigator
                       -- walked away, a different condition from the system failing outright).
                       CHECK (status IN ('processing', 'ready_for_review', 'confirmed', 'abandoned', 'error')),
  page_count         int NOT NULL,
  document_groups    jsonb NOT NULL DEFAULT '[]',
  unrecognized_pages jsonb NOT NULL DEFAULT '[]',
  edit_log           jsonb NOT NULL DEFAULT '[]',
  error_message      text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now(),
  confirmed_at       timestamptz
);

CREATE INDEX idx_intake_review_sessions_draft ON public.intake_review_sessions(draft_id);
CREATE INDEX idx_intake_review_sessions_user ON public.intake_review_sessions(user_id);
CREATE INDEX idx_intake_review_sessions_status ON public.intake_review_sessions(status);

ALTER TABLE public.intake_review_sessions ENABLE ROW LEVEL SECURITY;

-- Owner can do everything with their own intake sessions — same boundary
-- as report_drafts, one investigator cannot see or touch another's
-- in-progress intake (including its rendered page images, which are
-- referenced by storage key inside document_groups/unrecognized_pages,
-- never embedded — see architecture-assessment.md §4).
CREATE POLICY "intake_review_sessions: owner all" ON public.intake_review_sessions FOR ALL
  USING (user_id = auth.uid());

-- KEY QC/admin can read any session, for review/audit — same staff
-- visibility already granted on report_drafts.
CREATE POLICY "intake_review_sessions: key staff read" ON public.intake_review_sessions FOR SELECT
  USING (public.my_system_role() IN ('key_qc', 'key_admin'));

CREATE OR REPLACE FUNCTION public.update_intake_review_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER intake_review_sessions_updated
  BEFORE UPDATE ON public.intake_review_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_intake_review_session_timestamp();

-- Storage bucket for rendered page images is a separate, manual
-- prerequisite (Supabase dashboard or a service_role-authenticated step)
-- — verified live this proposal as reachable with zero buckets currently
-- configured (docs/document-intake-pipeline/architecture-assessment.md
-- §2, §7). Not created by this migration; RLS/bucket policy for
-- "intake-page-renders" must be configured to require an authenticated
-- session, matching every other authenticated read in this app.
