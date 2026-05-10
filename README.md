# KEY Investigations

**Insurance Claims Investigation Platform** – [keyinvestigations.in](https://keyinvestigations.in)

Specialist insurance fraud investigation firm based in Ahmedabad, Gujarat. This is the full web platform: public marketing site + multi-tenant claims management system.

## Features

### Public Site (`index.html`)
- Company overview, services, locations, careers, contact form
- Responsive design with scroll animations
- Direct link to client portal

### Client Portal (`dashboard.html`)
- Multi-tenant workspaces (one client company = one tenant)
- Submit new investigation requests via dynamic forms (6 claim types)
- Track claim status through full lifecycle
- Workspace member management (admin role can invite users)

### Admin Panel (`admin.html`)
- Global view across all tenants, claims, and agents
- Assign/reassign agents to claims with priority setting
- Agent capacity tracking
- Claim detail drawer with full form data

### QC Review Dashboard (`qc.html`)
- 8-point QC checklist per claim
- Approve claims or raise RFIs (Request for Information)
- Review notes and status management

### Agent Dashboard (`agent.html`)
- View assigned claims
- Update investigation status and add field notes
- Submit claims for QC review

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML, Tailwind CSS (CDN), vanilla JavaScript |
| Auth | Supabase Auth (email/password) |
| Database | Supabase (PostgreSQL) |
| Security | Row Level Security (RLS) on all tables |
| Hosting | Netlify (auto-deploy from GitHub) |
| Domain | GoDaddy DNS → Netlify |

No build step. No framework. No bundler. Pure static files.

## Project Structure

```
keyinvestigations/
├── index.html              # Public landing page
├── login.html              # Authentication (login/signup/reset)
├── dashboard.html          # Client portal (external role)
├── admin.html              # KEY admin panel (key_admin role)
├── qc.html                 # QC reviewer dashboard (key_qc role)
├── agent.html              # Field agent dashboard (key_agent role)
├── CNAME                   # Custom domain for Netlify
├── .nojekyll               # Disable Jekyll processing
├── js/
│   ├── app.js              # Shared config, Supabase client, helpers
│   └── supabase.js         # Self-hosted supabase-js UMD bundle
├── images/
│   └── logo.jpg            # Company logo
├── css/
│   └── style.css           # Legacy (unused)
├── supabase/
│   └── migrations/
│       ├── 20260509000001_customers.sql       # Initial schema (superseded)
│       ├── 20260509000002_claims_system.sql   # Claims + agents + types (superseded)
│       ├── 20260509000003_multitenant.sql     # Multi-tenant schema (current)
│       └── 20260509000004_fix_rls_recursion.sql # RLS fix with SECURITY DEFINER
├── CLAUDE.md               # Claude Code instructions
└── README.md               # This file
```

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `profiles` | All users (extends auth.users). Fields: full_name, email, phone, system_role |
| `tenants` | Client workspaces (insurance companies) |
| `workspace_members` | User ↔ tenant mapping with workspace_role (admin/member) |
| `key_agents` | KEY investigator profiles (states, claim_types, max_cases) |
| `claim_types` | 6 claim types with JSON form schemas |
| `claims` | Investigation requests with form_data, status, priority |
| `qc_reviews` | QC checklist results and reviewer notes |
| `rfis` | Request for Information threads on claims |

### System Roles (`profiles.system_role`)

| Role | Access |
|------|--------|
| `external` | Client portal only. Sees own tenant's claims. |
| `key_agent` | Agent dashboard. Sees assigned claims only. |
| `key_qc` | QC dashboard. Reads all claims, manages QC reviews. |
| `key_admin` | Full admin. Everything. |

### Claim Types

| ID | Label | Icon |
|----|-------|------|
| `motor_od` | Motor OD (Own Damage) | 🚗 |
| `motor_theft` | Motor Theft | 🔓 |
| `health` | Health Insurance | 🏥 |
| `mact` | MACT (Tribunal Claims) | ⚖️ |
| `tp` | Third Party (TP) | 🤝 |
| `non_motor` | Non-Motor | 🏢 |

### Claim Statuses

`pending` → `assigned` → `in_progress` → `under_review` → `qc_review` → `resolved` → `closed`

Side branch: `rfi_raised` (when QC raises a question)

### Row Level Security

All tables have RLS enabled. Key patterns:
- **Tenant isolation**: clients only see their own tenant's data via `workspace_members`
- **Agent isolation**: agents only see claims assigned to them
- **KEY staff access**: QC and admin roles see everything
- **SECURITY DEFINER helpers**: `my_system_role()` and `my_admin_tenants()` functions prevent RLS recursion

## Seeded Data

Three insurance company tenants pre-configured:
- Cholamandalam MS General Insurance
- Royal Sundaram General Insurance  
- Bajaj Allianz General Insurance

## Deployment

1. Push to `main` branch on GitHub
2. Netlify auto-deploys from the repo
3. Custom domain `keyinvestigations.in` configured via GoDaddy DNS

## Local Development

Open `index.html` directly in a browser, or serve with any static file server:

```bash
python3 -m http.server 3333
# or
npx serve .
```

No build step required.
