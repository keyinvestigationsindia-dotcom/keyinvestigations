# KEY Investigations – Claude Instructions

## Working Style
- You are the dev. Make decisions autonomously – commit, push, deploy without asking.
- Only pause for irreversible or ambiguous decisions (deleting prod data, major arch changes).
- Always push after committing. The site auto-deploys from main via Netlify.

## Tech Stack
- Pure static HTML/CSS/JS – no build step, no framework, no bundler.
- Tailwind CSS via CDN (`cdn.tailwindcss.com`).
- Supabase for auth, database (Postgres), and RLS.
- Self-hosted `supabase-js` UMD bundle at `js/supabase.js`.
- Shared config/helpers in `js/app.js` (Supabase client, constants, buildHeader).

## Project Structure
```
index.html          – Public marketing landing page
login.html          – Auth (login / signup / password reset)
dashboard.html      – Client portal (role: external)
admin.html          – KEY admin panel (role: key_admin)
qc.html             – QC reviewer dashboard (role: key_qc)
agent.html          – Field agent dashboard (role: key_agent)
js/app.js           – Shared Supabase client, constants, helpers
js/supabase.js      – Self-hosted supabase-js UMD bundle
images/logo.jpg     – Company logo (used in all navbars/headers)
css/style.css       – (legacy, unused)
supabase/migrations – Database migration SQL files
```

## Conventions
- All pages use the same Tailwind config: navy (#0a0f1e), gold (#c9a84c).
- Auth guard pattern: each page checks session → profile → role → redirect if wrong.
- Logo: `<img src="images/logo.jpg">` with white background pill on dark navs.
- Role routing defined in `ROLE_ROUTES` in `js/app.js`.
- Header built via `buildHeader(profile, tenantName)` in `js/app.js`.

## Database
- Supabase project: mqsohzqbsupsathxphgd
- All tables have RLS with SECURITY DEFINER helpers to avoid recursion.
- Key tables: profiles, tenants, workspace_members, key_agents, claim_types, claims, qc_reviews, rfis.
- Migrations in `supabase/migrations/` (run via Supabase CLI).

## Deployment
- GitHub repo: keyinvestigationsindia-dotcom/keyinvestigations (main branch)
- Netlify auto-deploys from main. Just push.
- Domain: keyinvestigations.in (GoDaddy DNS → Netlify).
