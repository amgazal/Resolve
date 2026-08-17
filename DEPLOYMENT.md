# Deploying Resolve

Resolve has two deployment pieces:

- **Frontend:** Vite/React static build on GitHub Pages.
- **Backend:** Supabase for Postgres, Auth, RLS, and the workflow RPCs.

The repository is also safe to publish before Supabase is connected. If the two browser Supabase variables are absent, the site deliberately falls back to the in-memory demo adapter.

## 1. Verify the project locally

From the project root:

```bash
npm install
npm run check
npm run dev
```

The first successful `npm install` creates `package-lock.json`. Commit that lockfile. The GitHub workflows automatically use `npm ci` whenever the lockfile exists.

## 2. Create the Supabase backend

Create a Supabase project. Then apply the database files in this order:

```text
supabase/01_schema.sql
supabase/02_policies.sql
supabase/03_functions.sql
```

You can paste them into the Supabase SQL editor in that order for a first deployment. For a repeatable deployment, use the migration snapshot in `supabase/migrations/` with the Supabase CLI.

### Recommended CLI path

Supabase recommends installing the CLI as a project development dependency when you use npm. That keeps the CLI version with the repository:

```bash
npm install --save-dev supabase
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

`supabase init` creates the local `supabase/config.toml`; commit that file after you generate it. `db push` applies local migrations to the linked remote project. Keep database changes in migration files rather than making untracked production-only edits in the dashboard. If you installed the CLI globally instead, run the same commands without `npx`.

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

Run the starter seed from your own machine:

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

If you have the Supabase CLI/local stack installed:

```bash
supabase start
supabase db reset
supabase db lint --level warning
supabase test db
```

`supabase db reset` applies the migration snapshot from `supabase/migrations/`. The pgTAP tests under `supabase/tests/database/` check key RLS/integrity assumptions. The repository also includes `.github/workflows/database-tests.yml`, which starts a fresh local Supabase database, lints it, and runs those tests on pull requests or manual runs.

Also test the real product with separate accounts:

- end user: own session/tickets only; no technician queue or internal notes
- technician: escalated queue, notes, assignment/status controls; no tree editing
- admin: technician abilities plus draft tree authoring/publishing

Before calling the backend ready, verify that an unfinished diagnosis survives a browser refresh and that publishing a new tree does not change a session that already started on the previous version.

## 5. Push to GitHub

Create a repository (for example, `resolve`) and push the project:

```bash
git init
git add .
git commit -m "Build Resolve guided IT triage"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/resolve.git
git push -u origin main
```

If the repository already exists locally, do not run `git init` again. Commit and push normally.

## 6. Configure GitHub Pages

In the GitHub repository:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Then go to:

**Settings → Secrets and variables → Actions → Variables**

Add these two repository variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

They are injected into the Vite build. If you leave them unset, the deployed project remains a polished demo using the in-memory adapter.

The included Pages workflow automatically chooses the correct Vite base path for both:

```text
https://USERNAME.github.io/REPOSITORY/
```

and a root user site such as:

```text
https://USERNAME.github.io/
```

Every push to `main` runs the TypeScript check, Vitest suite, production build, and Pages deployment. Watch **Actions** for the result.

## 7. Production smoke test

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
