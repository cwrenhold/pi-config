# Global Agent Instructions

Applies unless a project `AGENTS.md` or `CLAUDE.md` overrides.

## Commits

Use Conventional Commits: `<type>(<scope>): <summary>` or `<type>: <summary>`.
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
If relevant, include the issue in the subject, e.g. `chore: do the thing (#123)`.

## Branches

Use `<type>/<issue>-<description>` for issue work; otherwise `<type>/<description>`.
Examples: `chore/123-implement-something`, `feat/implement-something`.

## Issues

Titles should describe the problem, not just the implementation.
Start bodies with:

```text
As a <type of user>,
I want <goal>,
So that <benefit>.
```

Then add context, acceptance criteria, constraints, risks, links, or notes as needed.
