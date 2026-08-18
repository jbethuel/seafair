#!/usr/bin/env bash
# Links the project to Vercel, pushes the environment, and deploys to production.
#
# Run `pnpm dlx vercel login` first — that step is interactive and cannot be
# scripted. Everything after it is here.
#
# Reads .env.local directly rather than sourcing it, because Supabase passwords
# and secrets routinely contain characters the shell would interpret.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "error: .env.local not found. Copy .env.example and fill it in." >&2
  exit 1
fi

VERCEL="pnpm dlx vercel@latest"

if ! $VERCEL whoami >/dev/null 2>&1; then
  echo "error: not logged in. Run: pnpm dlx vercel login" >&2
  exit 1
fi

echo "==> Linking project"
$VERCEL link --yes

# Only these four reach the deployment. DATABASE_URL and SUPABASE_DB_PASSWORD
# are for local migration and seeding scripts and are deliberately withheld:
# the running application never opens a direct database connection.
DEPLOY_VARS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_JWT_SECRET
)

echo "==> Pushing environment"
for key in "${DEPLOY_VARS[@]}"; do
  value="$(sed -n "s/^${key}=//p" .env.local | head -n1)"
  if [ -z "$value" ]; then
    echo "error: $key is empty in .env.local" >&2
    exit 1
  fi
  for env in production preview development; do
    $VERCEL env rm "$key" "$env" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | $VERCEL env add "$key" "$env" >/dev/null
  done
  echo "    $key -> production, preview, development"
done

echo "==> Deploying to production"
$VERCEL deploy --prod
