# Global Agent Instructions

These instructions apply across projects unless a project-level `AGENTS.md` or `CLAUDE.md` says otherwise.

## Commits

When writing commit messages, use structured commit messages in Conventional Commit style:

```text
<type>(<scope>): <summary>
```

If no scope is useful, use:

```text
<type>: <summary>
```

Common types include `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`.

If an issue is referenced for the work, include it in the commit subject, for example:

```text
chore: do the thing (#123)
```

## Branches

When creating branches, include the work type in the branch name. If an issue is associated with the work, include the issue number after the type:

```text
chore/123-implement-something
```

If there is no associated issue, omit the issue number:

```text
feat/implement-something
```

## Issues

When creating issues, write titles that describe the problem to solve, not just the proposed implementation.

Start issue bodies with a BDD-style user story, then add further details below:

```text
As a <type of user>,
I want <goal>,
So that <benefit>.
```

Use the remaining issue body for context, acceptance criteria, constraints, risks, links, or implementation notes as appropriate.
