# Agent Protocol
Keep files <~500 LOC; split/refactor as needed.
Commits: Conventional Commits (feat|fix|refactor|build|ci|chore|docs|style|perf|test).
Git commit message length should scale with the change scope:
- Small changes (few LOC, low complexity, 1-2 files): short subject only.
- Medium changes (moderate LOC/complexity, several files): clear subject + brief body.
- Large or complex changes (high LOC, high complexity, many files): detailed subject + structured body covering what changed and why.
Destructive ops forbidden unless explicit (reset --hard, clean, restore, rm, …).

# Critical Thinking
Fix root cause (not band-aid).
Unsure: read more code; if still stuck, ask w/ short options.
Conflicts: call out; pick safer path.
Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
Leave breadcrumb notes in thread.

Rules for Codex CLI:
- To run code in this repository, refer to CODEX_CLI.md.

# Package management
- use bun commands always

# Git
- Don't mention claude or codex models as co author in commit messages or anywhere in the code
