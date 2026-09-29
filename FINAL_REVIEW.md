# Release pass — 2026-09-29

**NOT VERIFIED — hosted Supabase is not connected or accessible for migration, Storage, function, cleanup, or authenticated production verification.** Local checks below pass; the custom-domain static/demo deployment is being verified separately. Historical review notes remain below.

## Changes and findings

- **Blank domain:** HTTPS HTML returned 200 but referenced `/Resolve/assets/index-DYAfhbmD.js`, which returned 404 with `text/html`. The same JS under `/assets/` returned 200 with JavaScript MIME. Removed repository-name base derivation; Vite defaults to `./`, with `public/CNAME`, canonical and Open Graph URL set to `https://resolve.amgazal.com/`. One production build is served and hard-reloaded at both `/` and `/Resolve/` in dedicated tests. Pages reports HTTPS enforced and an approved certificate.
- **Conversation:** the RPC already distinguished sends, but status was absent from the ticket header, the queue lacked a Needs review filter, and Waiting could be unassigned. Ordinary Send preserves status (including Waiting and Needs review). Send & wait atomically creates the message, sets Waiting, and claims unassigned work. Requester replies atomically set Needs review, preserving assignment. The composer explains status/ownership, hides redundant Send & wait while Waiting, and the header exposes status and owner. Refresh conversation also refreshes the queue.
- **Support images:** JPEG/PNG/WebP inputs; maximum three images, 5 MiB original and normalized size each. Browser orientation/decode/resize/re-encode creates PNG with no EXIF/GPS/text chunks. Maximum normalized edge 4096; decoded sources over 48 megapixels are rejected. Text is required. Authenticated Edge ingestion checks signature, permitted chunks, CRCs, dimensions, size, type and extension; clients cannot write Storage directly. Metadata reservations and message linking are explicit, not JSON blobs. Only published attachments are readable through RLS; no internal-note attachment path. Downloads are authenticated, represented by revocable browser object URLs. The server validates PNG structure, not a full pixel decode; browser normalization performs decoding. No GPS is extracted.
- **Failure handling:** pending images are invisible and cannot be reused across messages or tickets. A failed finalization rolls back message/state/attachment linking together. Daily trusted cleanup removes unpublished reservations older than 24 hours; its setup is a hosted activation prerequisite. Network interruption can leave pending uploads until cleanup. There is no message editing or deletion UI.
- **UI/accessibility:** public requester and IT replies have distinct labels/backgrounds; internal notes remain separate. Compact previews show filename and size, with removal before sending. A native image dialog supports keyboard/Escape/focus restoration without dismissing the surrounding ticket panel. Lazy thumbnails are keyboard-focusable; downloads start near the viewport or on focus. Phone/desktop layouts were visually inspected; overflow assertions cover 320, 375, 390, 393, 430, 768, 1024, 1280, 1440 and 844×390 landscape in the image flow. Existing role screens retain their visual system, focus handling and reduced-motion rules.
- **Auth/races:** delayed initial profile results are now discarded after an auth-ended event; a live browser regression proves this. Ticket loads use a generation counter to reject stale results. Session persistence/recovery, expired-auth handling, unprovisioned accounts, admin preview isolation, RLS boundaries and internal-note separation are exercised locally.
- **Production gating:** no GitHub Supabase variables were configured, and `supabase projects list` reported no management access token. No hosted data was modified. Demo images are in-memory only and explicitly reset on reload. Hosted upload controls require `VITE_TICKET_IMAGES_ENABLED=true`, only after documented verification.

## Verification commands and results

| Command | Result | Count / scope |
| --- | --- | --- |
| `npm ci` | PASS | Lockfile installation |
| `npm audit` | PASS | 0 vulnerabilities |
| `npm run check` | PASS | TypeScript, 25 unit tests, production build |
| `npm run test:browser` | PASS | 7 Chromium scenarios; representative axe checks |
| `npm run test:paths` | PASS | 2 production path/hard-refresh scenarios |
| `npx supabase start -x studio,realtime,imgproxy,logflare,vector,supavisor` | PASS | Local database/Auth/Storage/Edge Runtime |
| `npx supabase migration up --local` | PASS | 2 forward migrations; existing local data preserved |
| `npx supabase functions serve ticket-image` | PASS | Authenticated image endpoint |
| `npx supabase db lint --level warning` | PASS | No schema errors |
| `npx supabase test db` | PASS | 50 pgTAP assertions |
| `npm run test:integration` | PASS | 144 authenticated role/image/workflow assertions |
| `npm run test:browser:live` | PASS | 6 local live scenarios |
| Privileged-key signature scan | PASS | 0 secret-key or service-role JWT matches in built JS |
| Hosted Supabase checks | NOT RUN | Management access and configured project unavailable |

The live browser flow includes staff PNG upload and ordinary Send preserving Assigned, failed Send & wait preserving its draft, retry to Waiting, requester private-image viewing and JPEG reply to Needs review, preserved assignee and hidden internal notes. Integration cases include requester PNG ingestion, staff images, second-requester/other-org/anonymous denial, direct Storage upload denial, unpublished image denial, invalid MIME/SVG/forged bytes/oversize/count/path denial, terminal-ticket reservation denial, and literal malicious filenames.

Coverage limits: Chromium only; no Safari/Firefox/physical-device certification or native 200% text-zoom audit. Token refresh is provided by Supabase's SDK; this pass tests expired authorization and auth-ended races, not a timed hosted token-renewal soak. Existing list limits (200 desk tickets and Data API page limits) remain. Source images are decoded before the 48-megapixel guard, so exceptionally compressed inputs may temporarily consume browser memory. Attachments are added to existing requests in the public conversation, after escalation. Large photographs whose lossless normalization exceeds 5 MiB need a smaller source. No claim of hosted support or exhaustive defect absence is made.

## Files changed

Deployment/config: `.env.example`, three GitHub workflows, `vite.config.ts`, `index.html`, `public/CNAME`, `package.json`, path-test config/server and local live-test server.

Product: `App.tsx`, API/types, new image normalization/validation helpers, conversation/request/ticket/queue components, new image viewer, and `resolve.css`.

Backend: two forward migrations, `supabase/functions/ticket-image`, and trusted `cleanup-ticket-images.ts`.

Verification/docs: image fixtures/unit tests, mock workflow tests, pgTAP/integration/demo/live/path tests, README, DEPLOYMENT, and this review.

---

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

## Final release verification — September 27, 2026

**VERIFIED — ready for portfolio/deployment.** This section supersedes the incomplete product-completion results above. Verification began at `ee042bd`; the ticket scroll-region fix and its regression were committed by the repository owner as `d02519b` during verification. The final live-test locator correction is included in this working tree. No dependency, database, architecture, or feature changes were required.

Commands ran sequentially, with no competing build/dev/preview processes. Initial process inspection found no stale Resolve/Vite/Playwright processes. The isolated `supabase_db_Resolve` database contained zero organizations but an older note policy, so `npx supabase db reset --local --no-seed` successfully reapplied all three current migrations. The unrelated lowercase `supabase_db_resolve` stack was not changed. Vite cleaned its generated output during each build.

| Command | Final result |
| --- | --- |
| `npm ci` | PASS — 124 packages installed; install-script warnings did not prevent builds. |
| `npm run check` | PASS — TypeScript, 14 Vitest tests, production build; repeated successfully after the UI fix. |
| `npm audit` | PASS — 0 vulnerabilities. |
| `npx supabase db lint --level warning` | PASS — no schema errors or warnings. |
| `npx supabase test db` | PASS — 43 pgTAP assertions. |
| `npm run test:integration` | PASS — 110 reported authenticated checks across five accounts and two organizations. |
| `npm run test:browser` | PASS — 6 Chromium tests, including axe checks and 320–1440px overflow checks. |
| `npm run test:browser:live` | PASS — 5 Chromium tests against local Supabase. |
| `node /tmp/resolve-release-sanity.mjs` (temporary verification harness) | PASS — separate production builds and sole preview server for `/` and `/Resolve/`, asset fetches, reloads, and supplemental queue/message flow. |

Two failures were investigated and corrected without weakening assertions or authorization:

- The demo axe check found the ticket's scroll region could lack keyboard access while action controls were disabled. `TicketPanel` now makes that region focusable and labels it. A keyboard-focus regression assertion was added. The targeted test, application check, and complete six-test demo suite then passed.
- The live failed-message test could not find its exact wrapping label after React populated the textarea child text. The trace showed the draft and textbox still present. The test now locates the textbox by accessible role and exact name; it still asserts draft retention, successful retry, requester visibility, hidden internal notes, `needs_review`, and preserved assignment. The failure was reproduced in isolation; the corrected targeted test and complete five-test live suite passed.

The previous asset 404 did **not** reproduce in the clean sequential browser run. Both browser suites use `/Resolve/`. The independent production sanity check also verified HTML loads and reloads at `/` and `/Resolve/`; JS/CSS fetched with HTTP 200 and correct MIME types, reloads used valid HTTP 304 cache revalidation, and the relative favicon resolved with HTTP 200 under each base. No local asset returned an HTML fallback. The Pages workflow derives `/Resolve/` from the repository name, matching Vite's emitted `/Resolve/assets/...` URLs. No Vite, Playwright-server, or Pages-path fix was necessary. The temporary harness was corrected to resolve relative URLs, accept cache revalidation, and exclude external Google Fonts URLs from the same-origin prefix check; these were harness assumptions, not product failures.

Representative coverage includes requester diagnosis/troubleshooting/escalation, My requests and public replies, internal-note privacy, all/personal/unassigned/waiting queue views, assignment, normal reply with status preserved, send-and-wait, Path Library saving, terminal resolution, admin validation/preview/history/audit, and archived read-only controls. Authenticated tests exercise ownership, cross-organization denial, sender forgery, technician/admin boundaries, unprovisioned signup metadata, and anonymous denials. Live preview checks confirm no support session is created.

Remaining limits: verification used local Supabase and Chromium; hosted GitHub Actions/Pages and hosted Supabase settings were not deployed or exercised, and other browsers/assistive technologies were not certified. Conversations require refresh, provisioning uses trusted SQL/server membership assignment, and diagnosis/step definitions remain shared. No unresolved release-test failures remain.

Files changed during this verification: `src/technician/TicketPanel.tsx`, `tests/browser/smoke.spec.ts` (both already included in `d02519b`), `tests/live/recovery.spec.ts`, and this document. Generated build metadata was restored to the current committed version.
