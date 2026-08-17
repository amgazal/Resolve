# Resolve

Resolve is guided IT triage for the gap between **“something is broken”** and a useful support ticket.

A requester describes the problem in their own words. Resolve asks a small number of targeted questions, walks through the most likely fixes one at a time, and only escalates when it has something useful to hand to a technician: what the person reported, what has been confirmed, the diagnostic path, and what has already been tried.

The project has three surfaces:

- **Get help** — the requester-facing diagnostic flow
- **IT desk** — the technician queue and ticket detail view
- **Questions** — an admin editor for versioned diagnostic workflows

The point is not to replace a technician with a chatbot. It is to make the time before a technician gets involved more useful for both sides.

---

## Run it locally

```bash
npm install
npm run dev
```

With no Supabase browser variables, Resolve runs against the in-memory adapter. That mode includes the full diagnostic flow, a demo ticket queue, staff actions, and the question editor, but resets on reload.

Demo accounts:

```text
maya@northgate.test    end user
jordan@northgate.test  technician
sam@northgate.test     admin
```

No password is required in mock mode.

To run against Supabase:

```bash
cp .env.example .env
```

and fill in:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full database/bootstrap/GitHub Pages sequence.

---

## Quality checks

```bash
npm run typecheck
npm test
npm run build

# all three
npm run check
```

The mock-adapter tests cover important workflow invariants such as role boundaries, invalid option IDs, session restoration, ordered/immutable troubleshooting attempts, abandoned sessions, premature escalation, draft-tree isolation, and loop rejection.

The database test at `supabase/tests/database/schema_security_test.sql` uses pgTAP to check RLS-critical structure, security-invoker views, cross-tree/cross-organization integrity, and ticket-resolution timestamps. Pull requests can run the same database checks through `.github/workflows/database-tests.yml`.

With the Supabase CLI/local stack available:

```bash
supabase start
supabase db reset
supabase db lint --level warning
supabase test db
```

---

## Project structure

```text
src/
  components/     requester flow, sign-in, trail, completion states
  technician/     queue and accessible ticket detail dialog
  admin/          diagnostic-tree editor
  data/           starter categories, diagnoses, and trees
  api/            Supabase adapter, mock adapter, contract tests
  styles/         Resolve visual system
  types.ts        shared API/domain contract
  App.tsx

supabase/
  01_schema.sql
  02_policies.sql
  03_functions.sql
  migrations/
  tests/database/

scripts/seed.ts   initial catalog bootstrap
```

`types.ts` is the contract implemented by both API adapters. A payload change therefore has to satisfy both the real Supabase implementation and the demo implementation at compile time.

---

## Architecture decisions

### The database owns the diagnostic walk

The browser never receives the complete decision tree during a support session.

It starts a session, receives the current question, submits one option ID, and gets the next authoritative state back. `answer_question` verifies that the option actually belongs to the session's current node before recording it.

That means a diagnostic history is something the backend observed, not a path the browser can simply claim happened.

The same principle applies to troubleshooting attempts. `record_attempt` accepts only the next unattempted step for the diagnosis, makes an identical retry idempotent, and does not allow an already-recorded result to be rewritten.

### Authorization is a database fact

The original prototype trusted a client-supplied role header. The full version does not.

Supabase Auth provides the signed user identity. Postgres resolves `auth.uid()` through `public.users`, and RLS/RPC checks decide what that identity is allowed to see and change.

Important boundaries include:

- end users read only their own sessions and tickets
- staff read diagnostic details only after a session is escalated
- internal notes stay on the staff side
- technicians cannot edit diagnostic trees
- direct browser writes cannot manufacture diagnostic sessions/history
- tree/options/tickets are constrained to their organization

The two Data API views, `session_facts` and `ticket_queue`, are explicitly created with `security_invoker = true` so their underlying RLS policies remain part of the access boundary.

The privileged server key is used only by the local bootstrap script and is never imported by the browser application.

### Diagnostic questions are versioned

The admin editor does not mutate the currently published question tree.

Opening the editor clones the published tree into a draft. Publishing checks that:

- a first question exists
- every question has at least one answer
- every question is reachable
- the graph contains no loops

The previous published tree is then archived and the draft becomes the new published version. Existing sessions remain pinned to the `tree_id` they started with, so **question/answer wording and branching do not shift underneath an active session**.

Diagnosis titles and troubleshooting-step definitions are still seed-managed shared content in this version. They are intentionally not browser-editable yet. If live editing of that content is added later, it should be versioned or snapshotted before historical wording can be changed.

### A live session can survive refresh

In Supabase mode the browser stores only the unfinished session ID in local storage. On refresh, the app asks Postgres for the authoritative state and rebuilds the current UI from that response.

Answers, diagnoses, and troubleshooting attempts are not reconstructed from browser storage.

### The mock is a real contract adapter, not a separate demo UI

When Supabase variables are absent, `api/index.ts` switches to the in-memory implementation. Both adapters implement the same `Api` interface and the React components do not know which one is active.

That keeps the public demo easy to run without creating a second, drifting version of the product.

---

## Product/UI approach

Resolve is meant to feel like a calm support conversation rather than a conventional help-desk dashboard.

The requester sees one useful decision at a time. A compact diagnostic trail and **What we know** panel make progress visible without exposing the whole tree. When escalation happens, that same information becomes the technician's context instead of making the requester repeat it.

The technician surface is denser because the job is different: scan the queue, understand the diagnostic history, act on the ticket. On small screens, the desktop table becomes purpose-built queue cards instead of forcing a wide table into a phone viewport.

The visual system stays restrained: paper-toned background, white work surfaces, deep spruce for primary actions and established state, Newsreader for the parts Resolve says to a person, Inter for interface chrome, and IBM Plex Mono for compact status/data labels.

Accessibility is treated as implementation work rather than a final styling pass. The ticket drawer behaves as a modal dialog with Escape-to-close, focus trapping, focus restoration, visible focus states, and reduced-motion support.

---

## Database bootstrap

Apply:

```text
supabase/01_schema.sql
supabase/02_policies.sql
supabase/03_functions.sql
```

Then, **before creating Auth users or real support sessions**, bootstrap the organization/catalog:

```bash
SUPABASE_URL=... \
SUPABASE_SECRET_KEY=... \
npm run seed
```

The seed refuses to run once diagnostic history exists. Troubleshooting-step definitions are not versioned yet, so reseeding a live project would be the wrong way to change production content.

After the seed, create Auth users and promote technician/admin accounts deliberately. Full steps are in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Deployment

The Vite frontend is set up for GitHub Pages through `.github/workflows/deploy-pages.yml`.

The workflow:

```text
install dependencies
→ TypeScript check
→ Vitest
→ Vite production build
→ upload dist/
→ deploy GitHub Pages
```

It calculates the correct Vite base path for both a project page (`/<repo>/`) and a root `username.github.io` repository.

The live backend remains Supabase. Add these as **GitHub Actions repository variables** when you want the deployed site to use the real backend:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

If they are absent, the deployed site still runs in demo mode.

---

## Known gaps / next worthwhile work

- **Requester follow-up is not a thread yet.** A technician can mark a ticket as waiting, but the requester cannot answer inside Resolve. `ticket_notes.is_internal = false` is a natural seam for that feature.
- **Saved diagnostic paths are reference-only.** They preserve a useful path/name for the desk but do not automatically alter future diagnostics or learn from outcomes.
- **Diagnosis and troubleshooting-step content is not versioned.** The question tree is versioned; these shared definitions are not. That should be addressed before adding live admin editing for them.
- **The bootstrap org assignment is intentionally simple.** New Auth users join the first Resolve organization. A real multi-tenant product would use an invitation/membership flow instead.
- **Realtime queue updates are not wired yet.** The desk refreshes after its own actions. Supabase Realtime could make incoming tickets appear without refresh/polling.
- **Database authorization testing can go deeper.** Current pgTAP tests protect important structural/integrity assumptions; the next layer is a local-Supabase suite that impersonates separate end-user, technician, and admin JWTs and asserts each RLS boundary end to end.

---

## Working with Codex

The repository includes `AGENTS.md` with the architectural and security rules Codex should preserve, plus [`CODEX_WORKFLOW.md`](./CODEX_WORKFLOW.md) with useful review/implementation prompts.
