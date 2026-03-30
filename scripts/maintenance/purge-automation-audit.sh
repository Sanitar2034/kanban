#!/usr/bin/env bash
set -euo pipefail
# Purges automation audit events older than RETENTION_DAYS (default: 30).
# Self-rescheduling via the job queue so this runs daily.
#
# Args:
#   $1 = JOB_QUEUE_DB_URL   (required for self-rescheduling)
#   $2 = INTERVAL_SECS      (default: 86400 = 24 h)
#   $3 = RETENTION_DAYS     (default: 30)

JOB_QUEUE_DB_URL="${1:?JOB_QUEUE_DB_URL is required}"
INTERVAL="${2:-86400}"
RETENTION_DAYS="${3:-30}"

AUDIT_FILE="${HOME}/.kanban/automations/audit-events.json"
CUTOFF_MS=$(( ($(date +%s) - RETENTION_DAYS * 86400) * 1000 ))

echo "[purge-automation-audit] retention=${RETENTION_DAYS}d cutoff_ms=${CUTOFF_MS}"

if [ ! -f "$AUDIT_FILE" ]; then
  echo "[purge-automation-audit] no audit file found — nothing to purge"
else
  # Use Node to parse & rewrite JSON atomically
  node - <<'NODEEOF'
const fs = require("node:fs");
const path = require("node:path");
const file = process.env.AUDIT_FILE;
const cutoff = Number(process.env.CUTOFF_MS);

if (!fs.existsSync(file)) process.exit(0);

let events;
try {
  events = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.stderr.write("[purge-automation-audit] corrupt JSON — resetting\n");
  fs.writeFileSync(file, "[]");
  process.exit(0);
}

if (!Array.isArray(events)) {
  fs.writeFileSync(file, "[]");
  process.exit(0);
}

const before = events.length;
const kept = events.filter((e) => typeof e.timestamp === "number" && e.timestamp >= cutoff);
fs.writeFileSync(file, JSON.stringify(kept, null, 2));
console.log(`[purge-automation-audit] purged ${before - kept.length} events, kept ${kept.length}`);
NODEEOF
fi

# Self-reschedule via the job queue using sqlite3 (same pattern as other scripts).
NEXT_DUE=$(( $(date +%s) + INTERVAL ))
SCRIPT_PATH="$(realpath "$0")"

if command -v sqlite3 &>/dev/null && [ -f "${JOB_QUEUE_DB_URL#file:}" ] 2>/dev/null || \
   (echo "$JOB_QUEUE_DB_URL" | grep -q "\.db$" && [ -f "${JOB_QUEUE_DB_URL}" ]); then
  DB_FILE="${JOB_QUEUE_DB_URL#file:}"
  sqlite3 "$DB_FILE" <<SQL 2>/dev/null || true
INSERT OR IGNORE INTO jobs (id, command, args, queue, status, priority, due_at, max_attempts, created_at, updated_at)
VALUES (
  'purge-automation-audit-' || cast(strftime('%s','now') as text),
  '$SCRIPT_PATH',
  '["${JOB_QUEUE_DB_URL}","${INTERVAL}","${RETENTION_DAYS}"]',
  'kanban.maintenance',
  'pending',
  5,
  $NEXT_DUE,
  1,
  cast(strftime('%s','now') as text),
  cast(strftime('%s','now') as text)
);
SQL
  echo "[purge-automation-audit] rescheduled in ${INTERVAL}s"
fi
