# Agent Protocol
Keep files <~500 LOC; split/refactor as needed.
Commits: Conventional Commits (feat|fix|refactor|build|ci|chore|docs|style|perf|test).
Git commit message length should scale with the change scope:
- Small changes (few LOC, low complexity, 1-2 files): short subject only.
- Medium changes (moderate LOC/complexity, several files): clear subject + brief body.
- Large or complex changes (high LOC, high complexity, many files): detailed subject + structured body covering what changed and why.
Destructive ops forbidden unless explicit (reset --hard, clean, restore, rm, …).
Don't mention claude or codex models as co author in commit messages or anywhere in the code

# Tech stack
use bun 

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

# Python environment
- Use the `bio-agent` uv virtual environment for all Python code.
- Run scripts: `bio-agent/bin/python script.py`
- Install packages: `uv pip install <package> --python bio-agent/bin/python`

# Debugging & Sandbox Playbook
- Verify runtime reachability first: run `curl http://127.0.0.1:<port>/health` from the same shell session before assuming a local server is accessible.
- If a port appears to be listening but `curl` fails, assume namespace/sandbox isolation. Do not trust host-level assumptions; continue with in-process or stdio-based diagnostics.
- For MCP server diagnostics, prefer stdio JSON-RPC checks (`initialize` + `tools/list`) per server and record tool counts/sizes.
- Separate measurements when debugging prompt limits:
  - tools payload size (count, chars, estimated tokens),
  - history size per session,
  - final request budget estimate before sending.
- Add temporary diagnostics in code only when needed, and remove them before final commit unless explicitly requested.

# Sandbox / Permissions Expectations
- If an important command fails due sandbox restrictions, rerun with escalation request instead of working around it.
- When repeated command families are needed, ask for scoped prefix approvals (for example `bun run ...` for app tasks).
- If network egress is blocked, state it explicitly and switch to local-only verification (DB, files, stdio probes) plus clear follow-up commands for the user to run outside the sandbox.

# Preferred Session Setup (for deep debugging)
- Use a less restricted session when possible:
  - filesystem: full project access,
  - network: enabled,
  - approvals: on-failure (or pre-approved safe prefixes for `bun`/`node` diagnostics).
- Keep backend and frontend running in the same environment as the agent whenever possible to avoid false negatives from cross-environment localhost checks.
- For debugging sessions, if a default port may already be in use, start services on `default + 1` (for example backend `3001` instead of `3000`) and use that port consistently for health checks and API calls.
