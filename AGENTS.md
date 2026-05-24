# Global Agent Instructions

These are lightweight defaults for Pi sessions. Project-level `AGENTS.md` or `CLAUDE.md` files are more specific and should take precedence.

## Working Style

- Be concise, practical, and explicit about assumptions.
- Prefer reading the relevant files before making changes.
- Make targeted edits; avoid broad rewrites unless they are clearly justified.
- If instructions or requirements conflict, pause and ask for clarification.

## Safety

- Treat credentials, tokens, session logs, `.env*`, SSH keys, and auth files as sensitive.
- Do not print secrets unless explicitly asked and it is necessary.
- Before destructive operations or broad cleanup, explain the impact and ask first.
- Check `git status` before making changes in an existing repository, and do not overwrite user changes.

## Development Workflow

- Follow repository-local workflow instructions first.
- For non-trivial repository work, prefer an issue/worktree/branch flow when the repo documents one.
- After code changes, run the most relevant formatter, build, lint, or tests where practical.
- If validation is skipped or unavailable, say so clearly.

## Commits

- When asked to commit, review the diff first.
- Prefer Conventional Commit style unless the repository specifies something else:
  - `feat(scope): summary`
  - `fix(scope): summary`
  - `docs(scope): summary`
  - `chore(scope): summary`
- Keep commits focused; avoid bundling unrelated changes.
