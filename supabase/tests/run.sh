#!/usr/bin/env bash
# Runs the SQL test-suite against a throwaway local Postgres (no Docker / Supabase CLI needed).
set -euo pipefail
cd "$(dirname "$0")"
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DATA=$(mktemp -d)
PORT=${PGPORT:-54329}
RUNAS=()
if [ "$(id -u)" = 0 ]; then RUNAS=(runuser -u postgres --); fi
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DATA"; fi
"${RUNAS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=''" -w start >/dev/null
PSQL=(psql -X -t -o /dev/null --set=client_min_messages=warning -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
export PGOPTIONS="-c client_min_messages=warning"
"${PSQL[@]}" -f shim.sql
"${PSQL[@]}" -f ../schema.sql
"${PSQL[@]}" -f ../schema.sql   # idempotent re-run
"${PSQL[@]}" -f rls_and_sync.test.sql
echo "SQL tests passed"
