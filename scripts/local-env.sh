#!/usr/bin/env bash
# Writes .env for local development from the running local Supabase stack (`npx supabase start`).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env already exists - leaving it alone (delete it to regenerate)."; exit 0; fi

eval "$(npx supabase status -o env)"
: "${API_URL:?supabase status gave no API_URL - is 'npx supabase start' running?}" "${ANON_KEY:?}" "${SERVICE_ROLE_KEY:?}"

cp .env.example .env
set_var() { sed -i.bak "s|^$1=.*|$1=$2|" .env; }
set_var SUPABASE_URL "$API_URL"
set_var SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_var VITE_SUPABASE_URL "$API_URL"
set_var VITE_SUPABASE_ANON_KEY "$ANON_KEY"
set_var TOKEN_ENCRYPTION_KEY "$(openssl rand -base64 32)"
set_var OAUTH_STATE_KEY "$(openssl rand -base64 32)"
rm -f .env.bak
echo "Wrote .env (Supabase URL + keys, fresh encryption keys). Provider OAuth creds are optional: add them to .env later."
