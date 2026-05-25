#!/usr/bin/env bash
#
# One-shot bring-up of a local AIM stack and registration of DVAA's
# RAGBot-AIM agent against it.
#
# What it does:
#   1. Brings up the 4-service AIM docker-compose stack (postgres + redis +
#      backend + frontend) in agent-identity-management/
#   2. Seeds a local admin user (admin@opena2a.org / AIM2025!Secure)
#   3. Generates DVAA's Ed25519 identity for ragbot-aim via @opena2a/aim-core
#   4. Registers the agent against the local AIM backend with that public key
#   5. Prints the env vars to copy into `dvaa --api` so cloud reporting fires
#
# After this script, log into http://localhost:3000 as
#   admin@opena2a.org / AIM2025!Secure
# and you'll see dvaa-ragbot-aim registered + the verification events that
# land each time `dvaa demo aim-ab` runs.
#
# LOCAL DEMO ONLY. The admin password is the legacy DVAA-CTF default and is
# documented publicly. DO NOT use this script against any AIM stack reachable
# from the public internet.

set -euo pipefail

DVAA_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AIM_ROOT="${AIM_ROOT:-$DVAA_ROOT/../agent-identity-management}"
ADMIN_EMAIL="admin@opena2a.org"
ADMIN_PASSWORD="AIM2025!Secure"
# bcrypt cost-12 hash of "AIM2025!Secure" (from agent-identity-management
# migration 072 — the legacy DVAA-default-admin seed). Reused here so the
# script doesn't depend on htpasswd / python bcrypt / etc.
ADMIN_PW_HASH='$2a$12$UbRtBE0U9Ry36Bdl04YWDuXe3lIw14aZaxQ8B6bbA4P7peLRski66'
BACKEND_URL="http://localhost:8080"
DASHBOARD_URL="http://localhost:3000"

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[1;32m✓\033[0m %s\n" "$*"; }
err()  { printf "    \033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

step "Pre-flight"
[[ -d "$AIM_ROOT" ]] || err "AIM_ROOT not found: $AIM_ROOT (set AIM_ROOT env var to the agent-identity-management clone path)"
[[ -f "$AIM_ROOT/docker-compose.quickstart.yml" ]] || err "$AIM_ROOT/docker-compose.quickstart.yml missing"
docker info >/dev/null 2>&1 || err "Docker daemon not running. Start Docker Desktop and re-run."
ok "AIM repo: $AIM_ROOT"
ok "Docker daemon ready"

step "Generate .env with shell-safe secrets"
ENV_FILE="$AIM_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
KEYVAULT_MASTER_KEY=$(openssl rand -base64 32)
EOF
  ok "wrote $ENV_FILE"
else
  ok "$ENV_FILE exists (reusing)"
fi

step "Apply postgres port override (if host's 5432 is busy)"
OVERRIDE_FILE="$AIM_ROOT/docker-compose.override.yml"
if [[ ! -f "$OVERRIDE_FILE" ]]; then
  cat > "$OVERRIDE_FILE" <<'EOF'
# Local override: remap aim-postgres to host port 5433 so it coexists with
# a local postgres on 5432. Container-internal port stays 5432; backend talks
# to postgres via the internal docker network and is unaffected.
services:
  postgres:
    ports:
      - "127.0.0.1:5433:5432"
EOF
  ok "wrote $OVERRIDE_FILE"
else
  ok "$OVERRIDE_FILE exists (reusing)"
fi

step "Bring up the stack (postgres + redis + backend + frontend)"
( cd "$AIM_ROOT" && docker compose -f docker-compose.quickstart.yml -f docker-compose.override.yml --env-file .env up -d >/dev/null )
ok "compose up issued"

step "Wait for backend health (up to 60s)"
for i in $(seq 1 12); do
  if curl -fsS -m 2 "$BACKEND_URL/health" >/dev/null 2>&1; then
    ok "backend healthy (took ${i}5s)"
    break
  fi
  sleep 5
done
curl -fsS -m 2 "$BACKEND_URL/health" >/dev/null 2>&1 || err "backend never became healthy (check: docker logs aim-backend)"

step "Seed admin user (if not already present)"
EXISTING=$(docker exec aim-postgres psql -U postgres -d identity -tA -c "SELECT count(*) FROM users WHERE email = '$ADMIN_EMAIL';" 2>/dev/null || echo 0)
if [[ "$EXISTING" = "0" ]]; then
  cat > /tmp/dvaa-seed-admin.sql <<SQL
INSERT INTO users (organization_id, email, name, role, provider, provider_id, password_hash, status, email_verified, force_password_change)
SELECT id, '$ADMIN_EMAIL', 'DVAA Local Admin', 'admin', 'local', '$ADMIN_EMAIL', '$ADMIN_PW_HASH', 'active', TRUE, FALSE
FROM organizations WHERE domain = 'admin.opena2a.org';
SQL
  docker cp /tmp/dvaa-seed-admin.sql aim-postgres:/tmp/dvaa-seed-admin.sql >/dev/null
  docker exec aim-postgres psql -U postgres -d identity -f /tmp/dvaa-seed-admin.sql >/dev/null 2>&1
  rm -f /tmp/dvaa-seed-admin.sql
  ok "admin user seeded ($ADMIN_EMAIL / $ADMIN_PASSWORD)"
else
  ok "admin user already present"
fi

step "Log in to capture JWT"
LOGIN_RESP=$(curl -fsS -m 5 -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BACKEND_URL/api/v1/public/login")
JWT=$(echo "$LOGIN_RESP" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); process.stdout.write(j.accessToken||'')})")
[[ -n "$JWT" ]] || err "JWT not returned from login (login resp: $LOGIN_RESP)"
ok "JWT captured (${#JWT} chars)"

step "Generate DVAA's Ed25519 identity for ragbot-aim (if missing)"
ID_FILE="$DVAA_ROOT/.dvaa-aim/ragbot-aim/identity.json"
PUBKEY=$(cd "$DVAA_ROOT" && node -e "
import('@opena2a/aim-core').then(async (m) => {
  const path = await import('path');
  const fs = await import('fs');
  const dataDir = path.join('$DVAA_ROOT', '.dvaa-aim', 'ragbot-aim');
  fs.mkdirSync(dataDir, { recursive: true });
  const core = new m.AIMCore({ agentName: 'ragbot-aim', dataDir });
  const id = core.getOrCreateIdentity();
  process.stdout.write(id.publicKey);
});
")
[[ -n "$PUBKEY" ]] || err "Ed25519 keygen failed"
ok "public key: $PUBKEY"
ok "identity file: $ID_FILE"

step "Check if dvaa-ragbot-aim already registered"
EXISTING_AGENT=$(curl -fsS -m 5 -H "Authorization: Bearer $JWT" "$BACKEND_URL/api/v1/agents" | node -e "
let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  const a=(j.agents||[]).find(a => a.name === 'dvaa-ragbot-aim');
  if (a) process.stdout.write(a.id);
});
")

if [[ -n "$EXISTING_AGENT" ]]; then
  CLOUD_AGENT_ID="$EXISTING_AGENT"
  ok "agent already registered: $CLOUD_AGENT_ID"
else
  step "Register dvaa-ragbot-aim with the public key"
  CREATE_RESP=$(curl -fsS -m 10 -X POST -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
    -d "{
      \"name\": \"dvaa-ragbot-aim\",
      \"displayName\": \"DVAA RAGBot-AIM\",
      \"description\": \"DVAA 15th agent: same RAG code as RAGBot, AIM capability enforcement at the tool boundary\",
      \"agentType\": \"custom\",
      \"version\": \"0.8.3\",
      \"publicKey\": \"$PUBKEY\",
      \"capabilities\": [\"rag:read\", \"chat:respond\"]
    }" \
    "$BACKEND_URL/api/v1/agents")
  CLOUD_AGENT_ID=$(echo "$CREATE_RESP" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); process.stdout.write(j.id||'')})")
  [[ -n "$CLOUD_AGENT_ID" ]] || err "registration failed (resp: $CREATE_RESP)"
  ok "registered agent id: $CLOUD_AGENT_ID"
fi

step "Done — next steps"
cat <<EOF

  Dashboard:    $DASHBOARD_URL
  Login:        $ADMIN_EMAIL  /  $ADMIN_PASSWORD

  Start DVAA with cloud reporting enabled (in another terminal):

    export AIM_SERVER_URL=$BACKEND_URL
    export AIM_API_KEY=not_required_for_local_verifications
    export DVAA_AIM_CLOUD_AGENT_ID=$CLOUD_AGENT_ID
    cd $DVAA_ROOT
    node src/index.js --api

  Then run the demo (in a third terminal):

    cd $DVAA_ROOT
    node src/index.js demo aim-ab

  Refresh the dashboard's Verification Events page to see the events land.

  To tear down: docker compose -f $AIM_ROOT/docker-compose.quickstart.yml -f $AIM_ROOT/docker-compose.override.yml --env-file $AIM_ROOT/.env down

EOF
