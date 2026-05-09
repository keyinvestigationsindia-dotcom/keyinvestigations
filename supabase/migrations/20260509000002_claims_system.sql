-- ============================================
-- KEY Investigations – Claims Management System
-- ============================================

-- Drop old tables cleanly
DROP TABLE IF EXISTS public.cases CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;

-- ============================================
-- COMPANIES (must exist before profiles references it)
-- ============================================
CREATE TABLE public.companies (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text NOT NULL,
  email        text,
  phone        text,
  address      text,
  created_at   timestamptz DEFAULT now()
);

-- ============================================
-- PROFILES (all users: client, agent, admin)
-- ============================================
CREATE TABLE public.profiles (
  id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role        text NOT NULL DEFAULT 'client' CHECK (role IN ('client','agent','admin')),
  full_name   text,
  phone       text,
  company_id  uuid REFERENCES public.companies(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles: own row read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles: own row update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies: read if member or agent" ON public.companies
  FOR SELECT USING (
    id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('agent','admin'))
  );

-- ============================================
-- AGENTS (location + claim type specialization)
-- ============================================
CREATE TABLE public.agents (
  id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  states        text[]  DEFAULT '{}',
  claim_types   text[]  DEFAULT '{}',
  max_cases     int     DEFAULT 15,
  active        boolean DEFAULT true
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents: read own or admin" ON public.agents
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- CLAIM TYPES + FORM SCHEMAS
-- ============================================
CREATE TABLE public.claim_types (
  id           text PRIMARY KEY,
  label        text NOT NULL,
  description  text,
  form_schema  jsonb NOT NULL
);

ALTER TABLE public.claim_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_types: public read" ON public.claim_types FOR SELECT USING (true);

INSERT INTO public.claim_types (id, label, description, form_schema) VALUES

('motor_od', 'Motor OD (Own Damage)', 'Own damage claims for motor vehicles', '[
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

('motor_theft', 'Motor Theft', 'Claims for stolen motor vehicles', '[
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

('health', 'Health Insurance', 'Health and medical insurance claims', '[
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

('mact', 'MACT (Tribunal Claims)', 'Motor Accident Claims Tribunal cases', '[
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

('tp', 'Third Party (TP)', 'Third party liability claims', '[
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

('non_motor', 'Non-Motor', 'Fire, burglary, marine and other non-motor claims', '[
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

-- ============================================
-- CLAIMS
-- ============================================
CREATE SEQUENCE public.claim_number_seq START 1000;

CREATE TABLE public.claims (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_number    text    UNIQUE DEFAULT 'KI-' || nextval('public.claim_number_seq'),
  company_id      uuid    REFERENCES public.companies(id),
  client_id       uuid    REFERENCES public.profiles(id),
  claim_type_id   text    REFERENCES public.claim_types(id),
  agent_id        uuid    REFERENCES public.agents(id),
  status          text    DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_progress','under_review','resolved','closed')),
  priority        text    DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  location_state  text,
  location_city   text,
  form_data       jsonb   DEFAULT '{}',
  agent_notes     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claims: client sees own company" ON public.claims
  FOR ALL USING (
    company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "claims: agent sees assigned" ON public.claims
  FOR SELECT USING (
    agent_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "claims: agent can update" ON public.claims
  FOR UPDATE USING (
    agent_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- AUTO TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, company_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    COALESCE(new.raw_user_meta_data->>'role', 'client'),
    CASE WHEN new.raw_user_meta_data->>'company_id' IS NOT NULL
         THEN (new.raw_user_meta_data->>'company_id')::uuid
         ELSE NULL END
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN new.updated_at = now(); RETURN new; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claims_updated_at BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- SEED: Chola Insurance company
-- ============================================
INSERT INTO public.companies (id, name, email, phone)
VALUES ('a1b2c3d4-0000-0000-0000-000000000001',
        'Cholamandalam MS General Insurance',
        'claims@cholainsurance.com',
        '+91-44-1234-5678');
