-- ============================================================
-- KEY Investigations – Multi-Tenant Claims System
-- ============================================================

-- Drop previous tables in order
DROP TABLE IF EXISTS public.claims CASCADE;
DROP TABLE IF EXISTS public.agents CASCADE;
DROP TABLE IF EXISTS public.claim_types CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP SEQUENCE IF EXISTS public.claim_number_seq;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.handle_updated_at();

-- ============================================================
-- PROFILES  (one row per auth user, global)
-- system_role: 'external' | 'key_agent' | 'key_qc' | 'key_admin'
-- ============================================================
CREATE TABLE public.profiles (
  id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   text,
  email       text,
  phone       text,
  system_role text NOT NULL DEFAULT 'external'
              CHECK (system_role IN ('external','key_agent','key_qc','key_admin')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Everyone reads their own profile; KEY staff can read all
CREATE POLICY "profiles: own read"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles: own update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles: key staff read all" ON public.profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.system_role IN ('key_agent','key_qc','key_admin')));

-- ============================================================
-- TENANTS  (client workspaces)
-- ============================================================
CREATE TABLE public.tenants (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  email      text,
  phone      text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
-- Policy added after workspace_members is created (see below)

-- ============================================================
-- WORKSPACE MEMBERS  (user ↔ tenant, with role per workspace)
-- workspace_role: 'admin' | 'member'
-- ============================================================
CREATE TABLE public.workspace_members (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id       uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  workspace_role text NOT NULL DEFAULT 'member' CHECK (workspace_role IN ('admin','member')),
  invited_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- Now add tenant policy (workspace_members exists now)
CREATE POLICY "tenants: members or key staff" ON public.tenants FOR SELECT USING (
  id IN (SELECT tenant_id FROM public.workspace_members WHERE user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role IN ('key_agent','key_qc','key_admin'))
);
-- Members can see their own memberships
CREATE POLICY "wm: own memberships" ON public.workspace_members FOR SELECT
  USING (user_id = auth.uid());
-- Tenant admins can see all members in their tenant
CREATE POLICY "wm: tenant admin sees all" ON public.workspace_members FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM public.workspace_members
    WHERE user_id = auth.uid() AND workspace_role = 'admin'
  ));
-- Tenant admins can insert/delete members in their tenant
CREATE POLICY "wm: tenant admin manage" ON public.workspace_members FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM public.workspace_members
    WHERE user_id = auth.uid() AND workspace_role = 'admin'
  ));
-- KEY admin can do everything
CREATE POLICY "wm: key admin all" ON public.workspace_members FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role = 'key_admin'));
-- KEY staff can read all
CREATE POLICY "wm: key staff read" ON public.workspace_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role IN ('key_agent','key_qc','key_admin')));

-- ============================================================
-- KEY AGENTS  (our investigators)
-- ============================================================
CREATE TABLE public.key_agents (
  id          uuid REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  states      text[]  DEFAULT '{}',
  claim_types text[]  DEFAULT '{}',
  max_cases   int     DEFAULT 15,
  active      boolean DEFAULT true
);

ALTER TABLE public.key_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "key_agents: own row" ON public.key_agents FOR SELECT USING (auth.uid() = id);
CREATE POLICY "key_agents: key admin all" ON public.key_agents FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role = 'key_admin'));
CREATE POLICY "key_agents: key staff read" ON public.key_agents FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role IN ('key_qc','key_admin')));

-- ============================================================
-- CLAIM TYPES
-- ============================================================
CREATE TABLE public.claim_types (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  form_schema jsonb NOT NULL
);

ALTER TABLE public.claim_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_types: public read" ON public.claim_types FOR SELECT USING (true);

INSERT INTO public.claim_types (id, label, description, form_schema) VALUES
('motor_od','Motor OD (Own Damage)','Own damage claims for motor vehicles','[
  {"name":"policy_number","label":"Policy Number","type":"text","required":true},
  {"name":"vehicle_reg","label":"Vehicle Registration Number","type":"text","required":true},
  {"name":"make_model","label":"Vehicle Make & Model","type":"text","required":true},
  {"name":"year","label":"Year of Manufacture","type":"text","required":true},
  {"name":"accident_date","label":"Date of Accident","type":"date","required":true},
  {"name":"accident_state","label":"State of Accident","type":"select","required":true,"options":["Gujarat","Maharashtra","Rajasthan","Madhya Pradesh","Delhi NCR","Uttar Pradesh","Punjab","Other"]},
  {"name":"accident_city","label":"City / District","type":"text","required":true},
  {"name":"nature_of_damage","label":"Nature of Damage","type":"textarea","required":true},
  {"name":"workshop_name","label":"Workshop / Garage Name","type":"text","required":false},
  {"name":"estimated_cost","label":"Estimated Repair Cost (₹)","type":"number","required":false},
  {"name":"remarks","label":"Additional Remarks","type":"textarea","required":false}
]'),
('motor_theft','Motor Theft','Claims for stolen motor vehicles','[
  {"name":"policy_number","label":"Policy Number","type":"text","required":true},
  {"name":"vehicle_reg","label":"Vehicle Registration Number","type":"text","required":true},
  {"name":"make_model","label":"Vehicle Make & Model","type":"text","required":true},
  {"name":"theft_date","label":"Date of Theft","type":"date","required":true},
  {"name":"theft_state","label":"State of Theft","type":"select","required":true,"options":["Gujarat","Maharashtra","Rajasthan","Madhya Pradesh","Delhi NCR","Uttar Pradesh","Punjab","Other"]},
  {"name":"theft_city","label":"City / District","type":"text","required":true},
  {"name":"fir_number","label":"FIR Number","type":"text","required":true},
  {"name":"police_station","label":"Police Station","type":"text","required":true},
  {"name":"last_known_location","label":"Last Known Location of Vehicle","type":"text","required":false},
  {"name":"remarks","label":"Additional Remarks","type":"textarea","required":false}
]'),
('health','Health Insurance','Health and medical insurance claims','[
  {"name":"policy_number","label":"Policy Number","type":"text","required":true},
  {"name":"patient_name","label":"Patient Full Name","type":"text","required":true},
  {"name":"patient_dob","label":"Patient Date of Birth","type":"date","required":true},
  {"name":"hospital_name","label":"Hospital Name","type":"text","required":true},
  {"name":"admission_date","label":"Date of Admission","type":"date","required":true},
  {"name":"discharge_date","label":"Date of Discharge","type":"date","required":false},
  {"name":"diagnosis","label":"Diagnosis / Illness","type":"text","required":true},
  {"name":"treating_doctor","label":"Treating Doctor Name","type":"text","required":false},
  {"name":"claim_amount","label":"Claim Amount (₹)","type":"number","required":true},
  {"name":"hospital_state","label":"State","type":"select","required":true,"options":["Gujarat","Maharashtra","Rajasthan","Madhya Pradesh","Delhi NCR","Uttar Pradesh","Punjab","Other"]},
  {"name":"hospital_city","label":"City","type":"text","required":true},
  {"name":"remarks","label":"Additional Remarks","type":"textarea","required":false}
]'),
('mact','MACT (Tribunal Claims)','Motor Accident Claims Tribunal cases','[
  {"name":"policy_number","label":"Policy Number","type":"text","required":true},
  {"name":"accident_date","label":"Date of Accident","type":"date","required":true},
  {"name":"claimant_name","label":"Claimant Full Name","type":"text","required":true},
  {"name":"vehicle_numbers","label":"Vehicle Number(s) Involved","type":"text","required":true},
  {"name":"case_number","label":"MACT Case Number","type":"text","required":false},
  {"name":"court_name","label":"Court / Tribunal Name","type":"text","required":false},
  {"name":"nature_of_injury","label":"Nature of Injury / Loss","type":"textarea","required":true},
  {"name":"claim_amount","label":"Claim Amount (₹)","type":"number","required":true},
  {"name":"accident_state","label":"State","type":"select","required":true,"options":["Gujarat","Maharashtra","Rajasthan","Madhya Pradesh","Delhi NCR","Uttar Pradesh","Punjab","Other"]},
  {"name":"accident_city","label":"City / District","type":"text","required":true},
  {"name":"remarks","label":"Additional Remarks","type":"textarea","required":false}
]'),
('tp','Third Party (TP)','Third party liability claims','[
  {"name":"policy_number","label":"Policy Number","type":"text","required":true},
  {"name":"accident_date","label":"Date of Accident","type":"date","required":true},
  {"name":"insured_vehicle","label":"Insured Vehicle Number","type":"text","required":true},
  {"name":"tp_name","label":"Third Party Name","type":"text","required":true},
  {"name":"tp_vehicle","label":"Third Party Vehicle Number","type":"text","required":false},
  {"name":"nature_of_damage","label":"Nature of Damage / Injury","type":"textarea","required":true},
  {"name":"claim_amount","label":"Claim Amount (₹)","type":"number","required":false},
  {"name":"accident_state","label":"State","type":"select","required":true,"options":["Gujarat","Maharashtra","Rajasthan","Madhya Pradesh","Delhi NCR","Uttar Pradesh","Punjab","Other"]},
  {"name":"accident_city","label":"City / District","type":"text","required":true},
  {"name":"remarks","label":"Additional Remarks","type":"textarea","required":false}
]'),
('non_motor','Non-Motor','Fire, burglary, marine and other non-motor claims','[
  {"name":"policy_number","label":"Policy Number","type":"text","required":true},
  {"name":"policy_type","label":"Policy Type","type":"select","required":true,"options":["Fire","Burglary","Marine","Home","Shop","Other"]},
  {"name":"incident_date","label":"Date of Incident","type":"date","required":true},
  {"name":"incident_state","label":"State","type":"select","required":true,"options":["Gujarat","Maharashtra","Rajasthan","Madhya Pradesh","Delhi NCR","Uttar Pradesh","Punjab","Other"]},
  {"name":"incident_city","label":"City / District","type":"text","required":true},
  {"name":"description","label":"Description of Incident","type":"textarea","required":true},
  {"name":"claim_amount","label":"Claim Amount (₹)","type":"number","required":true},
  {"name":"fir_number","label":"FIR Number (if applicable)","type":"text","required":false},
  {"name":"remarks","label":"Additional Remarks","type":"textarea","required":false}
]');

-- ============================================================
-- CLAIMS  (belong to a tenant)
-- ============================================================
CREATE SEQUENCE public.claim_number_seq START 1000;

CREATE TABLE public.claims (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_number    text UNIQUE DEFAULT 'KI-' || nextval('public.claim_number_seq'),
  tenant_id       uuid REFERENCES public.tenants(id) NOT NULL,
  created_by      uuid REFERENCES public.profiles(id),
  claim_type_id   text REFERENCES public.claim_types(id),
  agent_id        uuid REFERENCES public.key_agents(id),
  status          text DEFAULT 'pending'
                  CHECK (status IN ('pending','assigned','in_progress','under_review','qc_review','rfi_raised','resolved','closed')),
  priority        text DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  location_state  text,
  location_city   text,
  form_data       jsonb DEFAULT '{}',
  agent_notes     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- Tenant members see only their tenant's claims
CREATE POLICY "claims: tenant members" ON public.claims FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));
-- KEY agents see only assigned claims
CREATE POLICY "claims: key_agent assigned" ON public.claims FOR SELECT
  USING (agent_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role = 'key_agent'));
-- KEY agents can update their assigned claims
CREATE POLICY "claims: key_agent update" ON public.claims FOR UPDATE
  USING (agent_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role = 'key_agent'));
-- KEY QC and admin see everything
CREATE POLICY "claims: key staff all" ON public.claims FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role IN ('key_qc','key_admin')));

-- ============================================================
-- QC REVIEWS
-- ============================================================
CREATE TABLE public.qc_reviews (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id    uuid REFERENCES public.claims(id) ON DELETE CASCADE NOT NULL,
  reviewer_id uuid REFERENCES public.profiles(id),
  status      text DEFAULT 'pending' CHECK (status IN ('pending','approved','rfi_raised')),
  checklist   jsonb DEFAULT '{}',
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.qc_reviews ENABLE ROW LEVEL SECURITY;
-- Tenant members can read QC reviews for their claims
CREATE POLICY "qc_reviews: tenant read" ON public.qc_reviews FOR SELECT
  USING (claim_id IN (
    SELECT id FROM public.claims WHERE tenant_id IN (
      SELECT tenant_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  ));
-- KEY agent can read QC of their claims
CREATE POLICY "qc_reviews: agent read" ON public.qc_reviews FOR SELECT
  USING (claim_id IN (SELECT id FROM public.claims WHERE agent_id = auth.uid()));
-- KEY QC / admin full access
CREATE POLICY "qc_reviews: key staff all" ON public.qc_reviews FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role IN ('key_qc','key_admin')));

-- ============================================================
-- RFI  (Request for Information)
-- ============================================================
CREATE TABLE public.rfis (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id    uuid REFERENCES public.claims(id) ON DELETE CASCADE NOT NULL,
  raised_by   uuid REFERENCES public.profiles(id),
  question    text NOT NULL,
  response    text,
  status      text DEFAULT 'open' CHECK (status IN ('open','responded','closed')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.rfis ENABLE ROW LEVEL SECURITY;
-- Agents can read/respond to RFIs on their claims
CREATE POLICY "rfis: agent read respond" ON public.rfis FOR ALL
  USING (claim_id IN (SELECT id FROM public.claims WHERE agent_id = auth.uid()));
-- KEY QC / admin full access
CREATE POLICY "rfis: key staff all" ON public.rfis FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND system_role IN ('key_qc','key_admin')));
-- Tenant members can read RFIs for their claims
CREATE POLICY "rfis: tenant read" ON public.rfis FOR SELECT
  USING (claim_id IN (
    SELECT id FROM public.claims WHERE tenant_id IN (
      SELECT tenant_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  ));

-- ============================================================
-- AUTO TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN new.updated_at = now(); RETURN new; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at  BEFORE UPDATE ON public.profiles  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER claims_updated_at    BEFORE UPDATE ON public.claims    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER qc_reviews_updated_at BEFORE UPDATE ON public.qc_reviews FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER rfis_updated_at      BEFORE UPDATE ON public.rfis      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, system_role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email,
    COALESCE(new.raw_user_meta_data->>'system_role', 'external')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SEED DATA
-- ============================================================
-- Chola Insurance tenant
INSERT INTO public.tenants (id, name, slug, email, phone) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Cholamandalam MS General Insurance', 'chola', 'claims@cholainsurance.com', '+91-44-1234-5678'),
  ('a1b2c3d4-0000-0000-0000-000000000002', 'Royal Sundaram General Insurance', 'royal-sundaram', 'claims@royalsundaram.in', '+91-44-2345-6789'),
  ('a1b2c3d4-0000-0000-0000-000000000003', 'Bajaj Allianz General Insurance', 'bajaj-allianz', 'claims@bajajallianz.co.in', '+91-20-3456-7890');
