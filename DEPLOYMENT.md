# Deploying Resolve

Resolve has two deployment pieces:

- **Frontend:** Vite/React static build on GitHub Pages.
- **Backend:** Supabase for Postgres, Auth, RLS, and the workflow RPCs.

Without Supabase browser configuration, the frontend uses the in-memory demo adapter. Demo changes reset on reload.

## 1. Verify the project locally

Use Node.js 22.20+ on the Node 22 release line and npm. From the project root:

```bash
npm ci
npm run check
npm run dev
```

The repository includes `package-lock.json`; `npm ci` installs its recorded dependency versions.

## 2. Create the Supabase backend

Create a Supabase project. Then apply the database files in this order:

```text
supabase/01_schema.sql
supabase/02_policies.sql
supabase/03_functions.sql
supabase/04_hardening.sql
supabase/05_product_completion.sql
```

For a new database, choose either the SQL editor sequence above or the CLI migration below. They contain the same schema, policies, and functions; do not apply both to the same database.

### CLI alternative

With the Supabase CLI installed, run from the project root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

`supabase/config.toml` is checked in for local development; the CLI is pinned in npm dependencies. Review the dry run before pushing. The migrations include the initial schema, hardening, and product completion. Existing installations should apply only missing migrations, not rerun the bootstrap schema or seed. If the initial schema was installed manually, reconcile its migration history before using CLI migrations.

### Bootstrap the catalog and provision accounts

Auth identities do not automatically join an organization. Apply all migrations, seed a new catalog, create Auth identities, then explicitly provision membership through trusted SQL or server code. Never accept organization or role assignments from signup metadata.

Run the starter seed from your own machine. Supply these variables to the command; the seed script does not load `.env` itself:

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SECRET_KEY="YOUR_SECRET_KEY" \
npm run seed
```

`SUPABASE_SECRET_KEY` is privileged. Keep it on your machine or another trusted server-side environment only. Never put it in a `VITE_*` variable, browser code, GitHub Pages settings, or a committed file. If your project still uses legacy keys, `SUPABASE_SERVICE_ROLE_KEY` is supported by the seed script as a fallback and must be protected the same way.

The seed is intentionally a **bootstrap/dev-reset command**, not a production content migration tool. It refuses to run after diagnostic session history exists because diagnosis and troubleshooting-step definitions are not versioned yet.

Create real accounts in **Supabase → Authentication → Users**. They will see an awaiting-access screen until provisioned. In the trusted SQL editor, insert each membership using the verified Auth UUID and intended organization UUID:

```sql
insert into public.users (id, org_id, email, full_name, role)
select id, 'YOUR_ORGANIZATION_UUID'::uuid, email, 'Person Name', 'end_user'
from auth.users
where id = 'VERIFIED_AUTH_USER_UUID'::uuid;
```

Choose `technician` or `admin` deliberately for staff accounts. Confirm the UUIDs and role before executing. Existing memberships are preserved by the migration; review earlier automatically assigned memberships separately. The browser cannot provision itself. An existing account can use **Check access** after provisioning.

## 3. Connect the frontend locally

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

The publishable key is a browser key; the security boundary is the database authorization/RLS configuration. The service-role key is different and must never be exposed to the frontend.

Restart `npm run dev`, sign in with one of the Auth accounts, and verify a complete live flow before deploying.

## 4. Run the database checks

With Docker running and npm dependencies installed:

```bash
npx supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
npx supabase db lint --level warning
npx supabase test db
npm run test:integration
npx playwright install chromium
npm run test:browser:live
```

The local API uses port 55321 and PostgreSQL uses 55322. `npx supabase db reset --local --no-seed` is available for a disposable development database; it destroys local data and reapplies migrations. Do not use the seed against an organization with diagnostic history.

The pgTAP suite checks schema, grants and integrity. The authenticated suite creates isolated requester, technician and admin accounts across two organizations, then removes only its fixtures. It uses a privileged key solely for fixture setup/cleanup; assertions use real password-authenticated clients. Live browser checks cover refresh restoration and error recovery. These suites refuse non-local endpoints and read local keys from CLI status without storing them in repository files.

The database workflow runs these commands with the npm-pinned Supabase CLI. Before publishing a hosted deployment, repeat representative flows against that configured project; local verification does not establish its deployed migration or Auth settings.

## 5. Configure GitHub Pages

In the GitHub repository:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Then go to:

**Settings → Secrets and variables → Actions → Variables**

Add these two repository variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

They are injected into the Vite build. If you leave them unset, the deployed project remains a demo using the in-memory adapter.

The included Pages workflow automatically chooses the correct Vite base path for both:

```text
https://USERNAME.github.io/REPOSITORY/
```

and a root user site such as:

```text
https://USERNAME.github.io/
```

Every push to `main` runs the TypeScript check, Vitest suite, production build, and Pages deployment. Watch **Actions** for the result.

## 6. Deployment smoke test

After the Pages URL is live, check it once on desktop and once on a phone. In live-backend mode, verify:

```text
sign in
→ start diagnosis
→ refresh midway and resume
→ reach diagnosis
→ record troubleshooting attempts
→ escalate
→ technician opens the same ticket
→ add internal note
→ assign and resolve
→ admin opens a draft without changing the published flow
```

Also run Supabase's Security Advisor after the schema is deployed and inspect any warnings before sharing the live project widely.
