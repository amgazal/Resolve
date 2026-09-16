# Resolve verification checklist

Use this checklist when reviewing a release. It describes checks to run, not a record of completed validation. Backend setup and database commands are in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Automated checks

```bash
npm ci
npm run check
```

`npm run check` runs TypeScript checking, Vitest, and the production build. The [mock API tests](./src/api/mockApi.test.ts) cover role restrictions, invalid answers, session retrieval, ordered and immutable troubleshooting attempts, abandonment, premature escalation, draft cloning, and cycle rejection.

With the local Supabase database running:

```bash
supabase db lint --level warning
supabase test db
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
- A technician can assign a ticket, add an internal note, mark it waiting, and resolve it, but cannot edit trees.
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

## Remaining coverage

The repository has mock-adapter tests and database structure/integrity tests. It does not include browser automation or a complete authenticated, multi-role database test suite. Live session recovery, historical tree behavior, and role boundaries still need verification against a configured backend.
