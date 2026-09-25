# Resolve verification checklist

Use this checklist when reviewing a release. The checklist describes checks to run; the dated section below records this review. Backend setup and database commands are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Automated checks

```bash
npm ci
npm run check
npm audit
npm run test:browser
```

`npm run check` runs TypeScript checking, Vitest, and the production build. The [mock API tests](./src/api/mockApi.test.ts) cover role restrictions, invalid answers, session retrieval, ordered and immutable troubleshooting attempts, abandonment, premature escalation, draft cloning, and cycle rejection.

With the local Supabase database running:

```bash
npx supabase db lint --level warning
npx supabase test db
npm run test:integration
npm run test:browser:live
```

The [pgTAP suite](./supabase/tests/database/schema_security_test.sql) checks policy structure, security-invoker views, cross-tree and cross-organization integrity, and resolution timestamps. These tests do not replace checks made through authenticated clients with different roles.

Record the tested revision and results when reviewing a release. If the local database stack is unavailable, report database checks as not run.

## Requester flow

- Start a diagnosis, change the last answer, and confirm the trail updates.
- Refresh an unfinished session in Supabase mode and confirm its state returns from Postgres.
- Record a failed fix, then a successful fix; confirm the session resolves.
- Escalate a separate session and compare the reviewed handoff with the technician's ticket.
- Start over during a diagnosis and confirm the old session is abandoned.

## Roles and history

Use separate end-user, technician, and admin accounts. Test direct API requests as well as the interface.

- An end user cannot read another user's session or ticket, internal notes, or the staff queue.
- A technician can assign a ticket, add an internal note, send a public message and wait for a reply, and resolve it, but cannot edit trees.
- Admin edits stay within their organization and affect drafts only.
- Publishing rejects missing roots, unanswered questions, unreachable questions, and cycles.
- A session started before publication continues on its original question tree.
- Options cannot branch into another tree or terminate in another organization's diagnosis.
- Ticket mutations cannot replace requester or diagnostic history through direct table writes.

## Interface and deployment

- Complete the requester flow and open the technician queue on desktop and mobile.
- Navigate the queue and ticket dialog with the keyboard. Check focus trapping, Escape-to-close, and focus restoration.
- Enable reduced motion and check that transitions are suppressed.
- Confirm failed note submissions preserve the draft and failed ticket loads offer retry.
- Check the deployed site's asset paths and whether it is using the intended demo or Supabase configuration.

## Review results — September 24, 2026

This review added explicit database grants, private policy helpers, text limits, terminal ticket resolution, publication/edit serialization, and authenticated tests using five accounts across two organizations. UI checks cover demo onboarding, explicit answer drafts, destructive confirmations, modal keyboard behavior, and live session recovery.

Verified locally: `npm ci`; `npm run check` (also with Node 22.20.0); `npm audit` and `npm audit --omit=dev` (zero reported vulnerabilities); `npx supabase db reset --local --no-seed`; `npx supabase db lint --level warning`; `npx supabase test db`; `npm run test:integration`; `npm run test:browser`; and `npm run test:browser:live`. Supabase CLI 2.117.0 applied both migrations from scratch. Tests exercised the `/Resolve/` asset base path, and screenshots of loaded requester, technician and admin surfaces were inspected at mobile and desktop widths.

Muted text was measured at 4.69:1 against paper and 5.43:1 against white. The browser suite checks overflow at 320, 375, 430, 768, 1024 and 1440 pixels. No hosted deployment or GitHub-hosted workflow run was performed. Chromium automation and axe assist the review; they do not certify accessibility or substitute for testing other browsers and assistive technologies. Hosted Supabase and GitHub Pages settings must still be verified when deploying.

## Product completion review — September 25, 2026 (verification incomplete)

Implemented public ticket conversations and My requests, personal queue filters, richer Path Library snapshots, a stronger handoff, local draft preview, shared backend validation, read-only version history, backend audit events, and explicit account provisioning. Requester projections omit internal notes. Message sender/status changes and audit actors are backend-owned; ordinary clients cannot edit or delete messages or audit events. Existing memberships and historical trees remain intact.

Commands actually run during this pass:

| Command | Observed result |
| --- | --- |
| `npm ci` | Passed; npm reported install-script approval warnings for esbuild/fsevents. |
| `npm run check` | Final local run passed: TypeScript, 14 Vitest tests, production build. |
| `npm audit` | Passed with network permission: 0 vulnerabilities. |
| `npx supabase db reset --local --no-seed` | Applied all three migrations on the isolated local test stack. |
| `npx supabase db lint --level warning` | Last run found no schema errors. |
| `npx supabase test db` | 43 assertions passed. |
| `npm run test:integration` | Earlier run passed 90 authenticated assertions. Later provisioning/impersonation assertions were added; final rerun was denied. |
| `npm run test:browser` | Attempt failed with asset 404s while a concurrent production build replaced the shared output. Sequential rerun was denied; no new browser pass is claimed. |
| `npm run test:browser:live` | Expanded to five tests; not run for this pass. |

The final IT-only legacy-note policy was added after database verification, so the final migration must be reapplied and database checks repeated. The test code now includes technician → waiting → requester reply → needs review, failed-message draft retention, Path Library loading/deduplication, provisioning, preview isolation, validation/publication parity, and audit write denials. Coverage added is not equivalent to coverage executed.

Before treating this pass as release-ready, run database lint/pgTAP/integration against the final migration, then run demo and live browser suites **sequentially**; both build into `dist`. Inspect the revised handoff, conversation, and history screens on mobile and desktop. No hosted deployment was performed.

Intentionally omitted: optional rollback (archived versions stay read-only), a full invitation system (trusted provisioning is documented), and optional queue search. Conversations use explicit refresh, without realtime or notifications. Diagnosis/step definitions remain shared, demo state resets on reload, and legacy library entries may have no saved question/answer snapshot. The audit trail records authenticated administrative changes after this migration, not reconstructed historical or maintenance activity.
