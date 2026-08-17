# Working on Resolve with Codex

Resolve is a good candidate for Codex because the repository has explicit contracts, tests, SQL boundaries, and `AGENTS.md` instructions. Use Codex as an engineering partner for implementation and review; keep GitHub Actions and Supabase as the deployment path.

## Recommended loop

Open the repository in Codex CLI or the IDE extension and start with:

```text
Read AGENTS.md, README.md, and DEPLOYMENT.md first.
Inspect the current implementation before editing.
For any requested change, preserve the server-owned authorization and diagnostic traversal model.
Run npm run check after frontend/TypeScript changes.
For SQL changes, also review the RLS boundary and run the Supabase database tests when the local stack is available.
Show me the diff and call out anything you could not verify.
```

For a larger feature, ask Codex to plan before changing code:

```text
Plan this feature first. Identify the files, database changes, authorization implications, test cases, and rollback risks. Do not edit until the plan is coherent.
```

For security review:

```text
Review this repository as a hostile client. Look for any path where an end user can forge diagnostic state, read another user's data, see internal notes, or gain technician/admin capability. Do not assume the UI is trustworthy. Give me concrete findings and tests before making fixes.
```

For the next product milestone:

```text
Implement requester-visible follow-up messages without exposing internal notes. Preserve current ticket RLS, add the smallest schema/API/UI change, add tests for end-user vs technician visibility, then run the quality checks.
```

## Branching

For substantive work, keep `main` deployable:

```bash
git checkout -b feature/<short-name>
```

Have Codex work on that branch, review the diff, run the checks, then merge through a pull request. The repository's quality workflow runs on pull requests before the Pages deployment on `main`.
