# Pi Config

Personal configuration for the [Pi coding agent](https://pi.dev).

## Contents

- `settings.json` - global Pi settings, including default provider/model and theme.
- `extensions/` - local TypeScript extensions:
  - `compact-codeblocks.ts` - removes markdown code fences in the TUI and renders compact code blocks.
  - `context-progress-footer.ts` - custom footer with context usage and session stats.
  - `permission-gate.ts` - confirmation prompts for sensitive/destructive operations.
  - `question.ts` / `questionnaire.ts` - interactive clarification tools.
- `themes/` - custom themes.

## Not tracked

The repository intentionally ignores local/sensitive/runtime files, including:

- `auth.json` - OAuth/API credentials.
- `sessions/` - saved conversations and tool output, which may contain sensitive data.
- `bin/`, `npm/`, `git/` - downloaded tools and installed packages.
- `.env*`, key/certificate files, logs, caches, and temp files.

## Restore notes

Clone this repo to `~/.pi/agent` or copy its tracked files there, then authenticate Pi again with `/login` as needed.
