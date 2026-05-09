-- ============================================================
-- FIX: Infinite recursion in RLS policies
-- Root cause: policies on a table were querying the same table
-- Fix: Use SECURITY DEFINER functions that bypass RLS
-- ============================================================

-- Helper: returns current user's system_role (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.my_system_role()
RETURNS text LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT system_role FROM public.profiles WHERE id = auth.uid()
$$;

-- Helper: returns tenant IDs where current user is admin (bypasses RLS)
CREATE OR REPLACE FUNCTION public.my_admin_tenants()
RETURNS SETOF uuid LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT tenant_id FROM public.workspace_members WHERE user_id = auth.uid() AND workspace_role = 'admin'
$$;

-- ============================================================
-- PROFILES: fix recursive "key staff read all" policy
-- ============================================================
DROP POLICY IF EXISTS "profiles: key staff read all" ON public.profiles;
CREATE POLICY "profiles: key staff read all" ON public.profiles FOR SELECT
  USING (public.my_system_role() IN ('key_agent','key_qc','key_admin'));

-- ============================================================
-- WORKSPACE MEMBERS: fix recursive tenant admin policies
-- ============================================================
DROP POLICY IF EXISTS "wm: tenant admin sees all" ON public.workspace_members;
DROP POLICY IF EXISTS "wm: tenant admin manage" ON public.workspace_members;
DROP POLICY IF EXISTS "wm: key admin all" ON public.workspace_members;
DROP POLICY IF EXISTS "wm: key staff read" ON public.workspace_members;

CREATE POLICY "wm: tenant admin sees all" ON public.workspace_members FOR SELECT
  USING (tenant_id IN (SELECT public.my_admin_tenants()));

CREATE POLICY "wm: tenant admin manage" ON public.workspace_members FOR ALL
  USING (tenant_id IN (SELECT public.my_admin_tenants()));

CREATE POLICY "wm: key admin all" ON public.workspace_members FOR ALL
  USING (public.my_system_role() = 'key_admin');

CREATE POLICY "wm: key staff read" ON public.workspace_members FOR SELECT
  USING (public.my_system_role() IN ('key_agent','key_qc','key_admin'));

-- ============================================================
-- TENANTS: replace inline profile query with fn
-- ============================================================
DROP POLICY IF EXISTS "tenants: members or key staff" ON public.tenants;
CREATE POLICY "tenants: members or key staff" ON public.tenants FOR SELECT
  USING (
    id IN (SELECT tenant_id FROM public.workspace_members WHERE user_id = auth.uid())
    OR public.my_system_role() IN ('key_agent','key_qc','key_admin')
  );

-- ============================================================
-- CLAIMS: replace inline profile queries with fn
-- ============================================================
DROP POLICY IF EXISTS "claims: key_agent assigned" ON public.claims;
DROP POLICY IF EXISTS "claims: key_agent update" ON public.claims;
DROP POLICY IF EXISTS "claims: key staff all" ON public.claims;

CREATE POLICY "claims: key_agent assigned" ON public.claims FOR SELECT
  USING (agent_id = auth.uid() AND public.my_system_role() = 'key_agent');

CREATE POLICY "claims: key_agent update" ON public.claims FOR UPDATE
  USING (agent_id = auth.uid() AND public.my_system_role() = 'key_agent');

CREATE POLICY "claims: key staff all" ON public.claims FOR ALL
  USING (public.my_system_role() IN ('key_qc','key_admin'));

-- ============================================================
-- KEY_AGENTS: replace inline profile queries
-- ============================================================
DROP POLICY IF EXISTS "key_agents: key admin all" ON public.key_agents;
DROP POLICY IF EXISTS "key_agents: key staff read" ON public.key_agents;

CREATE POLICY "key_agents: key admin all" ON public.key_agents FOR ALL
  USING (public.my_system_role() = 'key_admin');

CREATE POLICY "key_agents: key staff read" ON public.key_agents FOR SELECT
  USING (public.my_system_role() IN ('key_qc','key_admin'));

-- ============================================================
-- QC_REVIEWS: replace inline profile queries
-- ============================================================
DROP POLICY IF EXISTS "qc_reviews: key staff all" ON public.qc_reviews;
CREATE POLICY "qc_reviews: key staff all" ON public.qc_reviews FOR ALL
  USING (public.my_system_role() IN ('key_qc','key_admin'));

-- ============================================================
-- RFIS: replace inline profile queries
-- ============================================================
DROP POLICY IF EXISTS "rfis: key staff all" ON public.rfis;
CREATE POLICY "rfis: key staff all" ON public.rfis FOR ALL
  USING (public.my_system_role() IN ('key_qc','key_admin'));
