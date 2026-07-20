# Deployment Guide — Legal & Investigation Intelligence (v1.0)

## Hosting reality (verified directly, not assumed)

`keyinvestigations.in` is served by **GitHub Pages**, not Netlify — confirmed via `dig` (A records `185.199.108/109/110/111.153`, GitHub Pages' known IPs), response headers (`server: GitHub.com`, Fastly CDN), and `gh api repos/.../pages` (active Pages site building from `main`). This corrects an earlier, stale assumption in this project's own `CLAUDE.md`.

- **Repo**: `keyinvestigationsindia-dotcom/keyinvestigations`, branch `main`.
- **Deploy trigger**: any push to `main`. No build step — this is a pure static HTML/CSS/JS site, GitHub Pages serves the repo contents directly.
- **Propagation**: GitHub Pages/Fastly CDN caches assets at `max-age=600` (10 minutes). A fresh push can take a few minutes to propagate across all edge nodes — don't assume a deploy is live everywhere instantly. Verify by fetching with a cache-busting query string (`?cb=<random>`) and `cache: 'no-store'` before concluding a deploy hasn't landed.

## Deploying a code change (`js/ai-service.js`, `report.html`)

1. Commit and push to `main` — this **is** the deploy. No separate build/release step.
2. Wait ~15–30 seconds, then verify: fetch the deployed file directly (`curl` or `fetch` with a cache-busting query) and confirm the expected content is present.
3. No local dev server is required to deploy, but one is useful for testing (see below).

## Deploying a database change (registry rows, schema)

**Not automatic — no CI applies migrations.** Every migration in `supabase/migrations/` must be run manually:

1. Open the Supabase SQL Editor for project `mqsohzqbsupsathxphgd`: `https://supabase.com/dashboard/project/mqsohzqbsupsathxphgd/sql/new`.
2. Paste the migration file's contents.
3. Run. Confirm "Success" and no errors.
4. Verify: query the affected table/column directly (e.g. `select * from legal_intelligence_modules`) before considering the migration applied.

**Adding a module to the registry does not require a code deploy** — a direct `INSERT` into `legal_intelligence_modules` via the SQL Editor takes effect immediately; the next `getLegalIntelligence()` call picks it up.

## Local development / testing

`.claude/launch.json` defines a local static server for this repo:
```json
{ "name": "keyinvestigations", "runtimeExecutable": "python3", "port": 5678 }
```
Serves the repo root at `http://localhost:5678` — no build step, same files as production. Authentication still requires a real Supabase session (sign in normally); there is no local-only auth bypass.

## Environment / credentials

| Credential | Where it lives | Never exposed to |
|---|---|---|
| Supabase anon key | `js/app.js`, public by design (RLS enforces actual access control) | N/A — intentionally public |
| Supabase JWT (per-user session) | Browser, via `sb.auth` | — |
| Anthropic/OpenAI/Gemini API keys | Bima Anveshak server-side environment only | Browser, KEY Investigations repo |
| Future: court-data vendor credential, IIB credential | Bima Anveshak server-side environment only (when implemented — see [integration specs](integrations/)) | Browser, KEY Investigations repo |

KEY Investigations' repo is **public**; Bima Anveshak's repo is **private**. No proprietary Bima Anveshak code or credentials are ever committed to the KEY Investigations repo — this boundary held throughout v1.0 development and must hold for any future work.

## Rollback

No automated rollback tooling — this is a static site with no build artifacts to version separately from the git history. To roll back: `git revert` the offending commit(s) and push; GitHub Pages redeploys from the new `HEAD` the same way as any other push. Database changes (registry rows, schema) have no automated rollback — revert via a new migration or manual SQL, never by editing history.

## Version marker

v1.0 of the Legal & Investigation Intelligence Engine is marked by the git tag `legal-intelligence-v1.0` (see repository tags) — see the [Architecture Document](architecture.md) header for what's frozen as of this tag.
