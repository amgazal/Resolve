# Resolve engineering guidance

Resolve is a guided IT-triage product with three surfaces: end-user support, technician desk, and admin question editor.

## Non-negotiable architecture

- Keep authorization in Postgres/Supabase. Never trust a role, org id, requester id, or diagnostic state supplied by the browser.
- Keep diagnostic traversal server-owned. The client may submit an option id; Postgres verifies it belongs to the current node and returns the next authoritative session state.
- Keep ticket mutations server-owned too. Status/priority/assignment and internal-note creation go through explicit RPCs; do not reopen broad direct UPDATE/INSERT policies just to make a UI change easier.
- Keep diagnostic trees versioned. Editing opens a draft; publishing retires the old published tree; existing sessions stay pinned to the version they started with.
- Treat `scripts/seed.ts` as bootstrap/dev-reset only. Do not use it to change a live project after diagnostic history exists; diagnosis/step wording is not versioned yet.
- Never expose `SUPABASE_SECRET_KEY` or the legacy `SUPABASE_SERVICE_ROLE_KEY` to browser code, Vite variables, GitHub Pages, or client logs.
- Views exposed through the Data API must use `security_invoker = true` when their underlying tables rely on RLS.

## Product and UI principles

- The user-facing flow should feel like a calm consultation, not an admin dashboard.
- Ask one useful question at a time. Do not dump troubleshooting trees on the user.
- Keep the diagnostic trail as the shared artifact between requester and technician.
- Preserve the current visual system: paper-toned ground, white cards, spruce accent, Newsreader for Resolve's voice, Inter for interface chrome, IBM Plex Mono for data/status labels.
- Accessibility is part of the implementation, not a later visual pass. Preserve keyboard navigation, focus visibility, reduced-motion behavior, semantic labels, and modal focus trapping.
- Prefer restrained motion and clear information hierarchy over decorative effects.

## Before completing a code change

Run:

```bash
npm run check
```

For database changes, also review:

```bash
supabase db lint --level warning
supabase test db
```

If the local Supabase stack is not available, state that database tests were not executed rather than implying they passed.

## Review checklist

- No cross-organization data path was introduced.
- End users cannot read internal notes or the technician queue.
- Technicians cannot edit diagnostic trees.
- Admin writes remain scoped to their organization.
- Options cannot cross tree boundaries or terminate in another organization's diagnosis.
- Existing sessions continue to work after a tree version is published.
- Refreshing an unfinished live session restores state from Postgres rather than reconstructing it from local browser data.
