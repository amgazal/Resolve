# Resolve

Resolve turns vague IT problems into guided troubleshooting and structured support tickets. It includes a requester flow, a technician desk, and an admin editor for diagnostic questions.

## What it does

A requester describes the problem, selects a category, and answers one question at a time before trying suggested fixes. The selected category and answers determine the diagnostic path; the written description stays with the report as context. If the issue needs a technician, the requester reviews a handoff containing their answers, device details, and attempted fixes before sending it.

## Key features

- Guided troubleshooting for network, login, software, hardware, printing, and general issues.
- A diagnostic trail shared between the requester flow and ticket detail view.
- A technician queue with priority ordering, self-assignment, waiting/resolved states, internal notes, and saved diagnostic paths.
- An admin editor for questions, answer branches, and draft publishing.
- A demo mode that runs without a database, plus a Supabase adapter for persistent accounts and support history.

## Engineering

- **Postgres controls the diagnostic flow.** In Supabase mode, the browser submits an option ID. Database functions verify that it belongs to the current question, record the answer, and return the session state. Troubleshooting results must be recorded in order and cannot be overwritten.
- **Authorization lives in the database.** Supabase Auth identifies the user; PostgreSQL row-level security and function checks enforce roles and organization boundaries. Ticket updates and internal notes use explicit RPCs. The Data API views use `security_invoker` to respect the underlying policies. Private policy helpers are outside the exposed schema; explicit grants restrict direct authoring to draft fields. Server-side text limits reject oversized input without truncating it.
- **Question trees are versioned.** Editing creates or reopens a draft. Publishing rejects missing roots, unanswered questions, unreachable nodes, and cycles, then archives the previous version. Existing sessions keep their original tree.
- **Both backends share a TypeScript contract.** The Supabase and in-memory adapters implement the same [`Api` interface](./src/types.ts). Vitest exercises the mock adapter's workflow rules independently of the React interface.
- **Live sessions resume from the backend.** The app saves the unfinished diagnostic session's ID locally and fetches its state from Postgres after refresh.
- **The interface accounts for keyboard and mobile use.** The ticket dialog implements focus trapping, focus restoration, and Escape-to-close. Small screens use queue cards, and animations respect reduced-motion preferences.

## Tech stack

| Area | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, CSS |
| Backend | Supabase Auth, PostgreSQL, SQL functions, row-level security |
| Testing | Vitest, pgTAP, authenticated Supabase requests, Playwright and axe |
| Delivery | GitHub Actions, GitHub Pages |

## Running locally

Use Node.js 22.20+ on the Node 22 release line and npm. CI uses Node 22.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. With the Supabase browser variables unset, choose **Requester**, **IT Technician**, or **Administrator** from the demo exploration screen. Use **Switch role** in the header to explore another surface; no credentials are required in demo mode.

Demo data, edits, and sessions reset on reload. Queue metrics and example accounts in this mode are fixtures.

To use Supabase, follow the [deployment guide](./DEPLOYMENT.md) to apply the database schema, seed the catalog, and create accounts. Then copy [`.env.example`](./.env.example) to `.env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and restart Vite. Keep privileged seed keys out of all `VITE_*` variables.

## Checks and deployment

```bash
npm run check
npm audit
npx playwright install chromium
npm run test:browser
```

`npm run check` runs TypeScript checking, Vitest, and a production build. The small Playwright suite checks demo journeys, modal keyboard behavior, unsaved edits, axe findings, and overflow at 320–1440px using a `/Resolve/` base path. The [database tests](./supabase/tests/database/schema_security_test.sql) cover policy structure, view configuration, cross-tree and cross-organization constraints, and resolution timestamps. See [DEPLOYMENT.md](./DEPLOYMENT.md) for local database checks and GitHub Pages setup, and [FINAL_REVIEW.md](./FINAL_REVIEW.md) for manual verification steps.

With Docker running, the pinned Supabase CLI provides local backend checks:

```bash
npx supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
npx supabase db lint --level warning
npx supabase test db
npm run test:integration
npm run test:browser:live
```

The integration suite creates temporary accounts in two organizations, signs in through Auth, tests allowed and denied requests, and removes its fixtures. The live browser suite checks session restoration and failure recovery. Both refuse remote endpoints. Local ports are 55321 (API) and 55322 (database), avoiding the usual Supabase defaults.

Pull requests run application, browser, database, and authenticated integration checks in GitHub Actions. Supabase CLI is pinned to 2.117.0 in `package.json`. The Pages workflow builds and deploys on pushes to `main`; without Supabase browser variables, the deployed build uses demo mode.

## Current limitations

- Requesters cannot reply to tickets inside the app, even when a technician marks one as waiting.
- Saved diagnostic paths are references for the desk; they do not change future questions.
- Question trees are versioned, but diagnosis wording and troubleshooting steps are shared definitions. The seed script refuses to reseed an organization with diagnostic history.
- New Auth accounts join the first organization. An invitation or membership flow is not implemented.
- The queue refreshes after local actions or an explicit refresh; there is no realtime subscription. Resolved tickets are terminal; reopening is not supported.
- Browser coverage is a small Chromium smoke suite, not exhaustive cross-browser or accessibility certification.
