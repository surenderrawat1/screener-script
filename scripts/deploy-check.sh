#!/usr/bin/env bash
# Production deploy dry-run checks.
# Usage (repo root): pnpm deploy:check
# Optional build:    pnpm deploy:check -- --build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    # strip CR
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      # strip surrounding quotes
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
      if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
      # drop inline comments only when value is unquoted and has space+#
      export "${key}=${val}"
    fi
  done < "$file"
}

load_env_file .env

FAILED=0
ok() { echo "✓ $*"; }
warn() { echo "⚠ $*"; }
err() { echo "✗ $*"; FAILED=1; }

echo "=== Script Screener deploy check ==="
echo

require() {
  local key="$1"
  local val="${!key:-}"
  if [[ -z "$val" ]]; then
    err "Missing required env: $key"
  elif [[ "$key" == *SECRET* ]] && { [[ ${#val} -lt 24 ]] || [[ "$val" == change-me* ]] || [[ "$val" == dev-access-secret* ]]; }; then
    if [[ "${NODE_ENV:-}" == "production" ]]; then
      err "$key looks weak or is still a placeholder — set a strong secret (≥24 chars)"
    else
      warn "$key looks weak/placeholder (OK for local; must change for production)"
    fi
  else
    ok "$key set"
  fi
}

recommend() {
  local key="$1"
  local val="${!key:-}"
  if [[ -z "$val" ]]; then
    warn "Recommended env unset: $key"
  elif [[ "$key" == *SECRET* ]] && [[ "$val" == change-me* ]]; then
    warn "$key is still a placeholder"
  else
    ok "$key set"
  fi
}

require DATABASE_URL
require REDIS_URL
require JWT_ACCESS_SECRET

recommend CORS_ORIGIN
recommend JWT_REFRESH_SECRET
recommend SIGNAL_ALERT_EMAIL_TO
recommend SMTP_HOST
recommend SMTP_FROM

if [[ "${NODE_ENV:-}" == "production" ]]; then
  ok "NODE_ENV=production"
else
  warn "NODE_ENV=${NODE_ENV:-(unset)} — use production in deploy"
fi

for f in docker-compose.yml docker/Dockerfile.api docker/Dockerfile.worker docker/Dockerfile.web docker/nginx.conf; do
  if [[ -f "$f" ]]; then ok "Found $f"; else err "Missing $f"; fi
done

WANT_BUILD=0
for arg in "$@"; do
  [[ "$arg" == "--build" ]] && WANT_BUILD=1
done

if [[ "$WANT_BUILD" == "1" ]]; then
  echo
  echo "Running pnpm build…"
  if pnpm build; then ok "pnpm build succeeded"; else err "pnpm build failed"; fi
else
  echo
  echo "(Skip build — pass --build to run pnpm build)"
fi

echo
echo "Post-deploy smoke (manual):"
echo "  curl -sS http://localhost:3100/health"
echo "  curl -sS http://localhost:3100/health/ready"
echo "  curl -sS http://localhost:3100/metrics | head"
echo "  Open web UI → login → Morning / Strategies / Verify"

if [[ "$FAILED" != "0" ]]; then
  echo
  echo "Deploy check FAILED"
  exit 1
fi
echo
echo "Deploy check PASSED (env + files)"
