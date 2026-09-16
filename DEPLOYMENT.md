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
```

For a new database, choose either the SQL editor sequence above or the CLI migration below. They contain the same schema, policies, and functions; do not apply both to the same database.

### CLI alternative

With the Supabase CLI installed, run from the project root:

```bash
supabase init
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

`supabase/config.toml` is not checked in, so run `supabase init` once before using the CLI. Review the dry run before pushing. The migration in [`supabase/migrations/`](./supabase/migrations/) contains the initial database setup. Add future database changes as migrations.

### Seed before creating Auth users

The schema's Auth trigger attaches a new account to the Resolve organization. That organization must exist first, so the bootstrap order is important:

```text
apply schema/policies/functions
        ↓
run the starter seed
        ↓
create Auth users
        ↓
promote technician/admin accounts deliberately
```

Run the starter seed from your own machine. Supply these variables to the command; the seed script does not load `.env` itself:

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SECRET_KEY="YOUR_SECRET_KEY" \
npm run seed
```

`SUPABASE_SECRET_KEY` is privileged. Keep it on your machine or another trusted server-side environment only. Never put it in a `VITE_*` variable, browser code, GitHub Pages settings, or a committed file. If your project still uses legacy keys, `SUPABASE_SERVICE_ROLE_KEY` is supported by the seed script as a fallback and must be protected the same way.

The seed is intentionally a **bootstrap/dev-reset command**, not a production content migration tool. It refuses to run after diagnostic session history exists because diagnosis and troubleshooting-step definitions are not versioned yet.

Now create real accounts in **Supabase → Authentication → Users**. New users start as `end_user`. Promote the accounts that need staff access in the SQL editor:

```sql
update public.users
set role = 'technician'
where email = 'technician@example.com';

update public.users
set role = 'admin'
where email = 'admin@example.com';
```

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

With the Supabase CLI installed and Docker running, initialize the local configuration with `supabase init` if it does not exist, then run:

```bash
supabase start
supabase db reset
supabase db lint --level warning
supabase test db
```

`supabase db reset` resets the local database and applies the migration snapshot from `supabase/migrations/`. The pgTAP tests under `supabase/tests/database/` check key RLS/integrity assumptions. The repository also includes `.github/workflows/database-tests.yml`, which starts a fresh local Supabase database, lints it, and runs those tests on pull requests or manual runs.

Also test the real product with separate accounts:

- end user: own session/tickets only; no technician queue or internal notes
- technician: escalated queue, notes, assignment/status controls; no tree editing
- admin: technician abilities plus draft tree authoring/publishing

Before calling the backend ready, verify that an unfinished diagnosis survives a browser refresh and that publishing a new tree does not change a session that already started on the previous version.

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
