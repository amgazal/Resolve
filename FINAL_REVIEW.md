# Resolve final engineering review

This pass keeps the product's existing visual direction and concentrates on reliability, authorization, accessibility, maintainability, and deployability.

## What was strengthened

### Frontend and product flow

- Split the original prototype into typed React components with a shared `Api` contract.
- Preserved the calm requester experience, technician desk, and admin question editor as distinct surfaces.
- Restores unfinished live diagnostic sessions from the backend after refresh; the browser stores only the session id.
- Prevents stale delayed diagnosis transitions after restart/unmount.
- Makes restart abandon the live session before clearing the local flow.
- Makes the ticket drawer an accessible modal: Escape close, focus trap, focus restoration, body scroll lock, loading/error/retry states.
- Keeps internal-note text when a request fails instead of silently clearing it.
- Fixes Clipboard API handling so copy success is only shown after the Promise resolves.
- Adds a purpose-built mobile technician queue instead of squeezing a wide table.
- Uses honest labels for currently implemented behavior (`Mark waiting for user`, `Save diagnostic path`).
- Makes root-question deletion explicit in the admin editor and blocks publishing trees with missing branches, unreachable nodes, or cycles.
- Keeps animation restrained and honors `prefers-reduced-motion`.

### TypeScript and API boundaries

- Uses TypeScript across the application and a single interface implemented by both mock and Supabase adapters.
- Removes the prototype role header entirely; roles come from the authenticated database profile.
- Uses modern Supabase publishable-key configuration in browser code with legacy anon-key fallback only for compatibility.
- Detects zero-row admin writes so RLS failures cannot look like successful edits.
- Keeps ticket status/assignment, internal notes, saved paths, and diagnostic traversal behind RPC boundaries.

### Database integrity and authorization

- Enables RLS across exposed tables and uses `security_invoker = true` for views that rely on underlying RLS.
- Pins every diagnostic session to a versioned tree.
- Validates that options stay inside their tree and diagnoses stay inside the organization.
- Validates historical session answers and troubleshooting attempts at the database boundary.
- Makes tree cloning map branches by stable node keys and serializes draft creation per category.
- Rejects published trees with missing roots, unanswered nodes, unreachable nodes, or cycles.
- Makes ticket references monotonic within the existing reference set rather than deriving them from row count.
- Keeps privileged functions `security definer` with an explicit `search_path` and server-side organization/role checks.

### Testing and delivery

- Adds mock-adapter contract/invariant tests.
- Adds pgTAP database tests for important RLS and integrity assumptions.
- Adds a GitHub database workflow that starts a fresh Supabase DB, lints it, and runs pgTAP on pull requests/manual runs.
- Adds GitHub Pages deployment and pull-request quality workflows.
- Adds deployment, Codex, and repository-agent guidance.

## Static checks completed in this environment

- TypeScript/TSX parser: no syntax errors across source/config files.
- TypeScript transpile diagnostics: none.
- Strict semantic check for the core data/model/mock adapter: passed.
- HTML shell/root check: passed.
- GitHub workflow YAML parsing: passed.
- CSS brace/syntax-structure check: passed.
- SQL dollar-quote balance and migration-content checks: passed.
- pgTAP declared plan matches the number of assertions: 22/22.

## Checks that still need to run on your machine

This environment could not retrieve npm dependencies, so `npm install` timed out. It also does not have a local Supabase/Docker stack. Because of that, these are intentionally **not** claimed as executed here:

```bash
npm install
npm run check
```

and, once the Supabase CLI + Docker are available:

```bash
supabase init
supabase start
supabase db reset
supabase db lint --level warning
supabase test db
```

The first successful `npm install` should create `package-lock.json`; commit it before relying on CI.

## Before sharing the project with recruiters

1. Run the npm and Supabase checks above.
2. Exercise one complete live flow with separate end-user and technician accounts.
3. Refresh in the middle of a diagnosis and confirm it resumes from Postgres.
4. Verify an end user cannot see the desk, internal notes, or another user's session.
5. Publish a new diagnostic-tree version and confirm an already-started session stays on the older version.
6. Check the deployed app on desktop and mobile.
7. Run Supabase Security Advisor after the production schema is deployed.
