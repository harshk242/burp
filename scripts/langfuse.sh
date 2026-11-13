#!/usr/bin/env bash
# Run langfuse-cli with credentials from app/.env (LANGFUSE_PUBLIC_KEY / _SECRET_KEY / _BASE_URL).
# Usage: scripts/langfuse.sh api <resource> <action> [options]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LANGFUSE_ENV_FILE:-$root/app/.env}"

if [[ -z "${LANGFUSE_SECRET_KEY:-}" && -f "$env_file" ]]; then
  while IFS='=' read -r key value; do
    value="${value%\"}"; value="${value#\"}"
    export "$key=$value"
  done < <(grep -E '^LANGFUSE_(PUBLIC_KEY|SECRET_KEY|BASE_URL|HOST)=' "$env_file")
fi

: "${LANGFUSE_SECRET_KEY:?LANGFUSE_SECRET_KEY not set (expected in $env_file)}"
export LANGFUSE_HOST="${LANGFUSE_HOST:-${LANGFUSE_BASE_URL:-}}"

exec bunx langfuse-cli "$@"
