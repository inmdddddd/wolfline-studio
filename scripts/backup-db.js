#!/usr/bin/env node
// Scheduled SQLite backup, meant to run from cron against a live server.
//
// Uses VACUUM INTO rather than copying the .db file directly: this app runs
// in WAL mode (see lib/db.js), so a plain `cp` can catch a write mid-flight
// or miss data still sitting in the -wal file, producing a backup that looks
// fine but is actually torn. VACUUM INTO takes its own read snapshot and
// writes one complete, defragmented, self-contained file - safe to run
// against the database while the app keeps serving traffic.
//
// Usage: node backup-db.js <db-path> <backups-dir> <label>
//   node backup-db.js /home/ubuntu/beca-data/beca.db /home/ubuntu/beca-data-backups beca

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const RETENTION_DAYS = 14;

const [, , dbPath, backupsDir, label] = process.argv;
if (!dbPath || !backupsDir || !label) {
  console.error("Usage: node backup-db.js <db-path> <backups-dir> <label>");
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath} - nothing to back up.`);
  process.exit(1);
}

fs.mkdirSync(backupsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const prefix = `${label}.auto-`;
const outPath = path.join(backupsDir, `${prefix}${timestamp}.db`);

const source = new DatabaseSync(dbPath, { readOnly: true });
try {
  source.prepare("VACUUM INTO ?").run(outPath);
} finally {
  source.close();
}

// A backup nobody can restore from is worse than no backup - catch a torn
// or truncated snapshot right away instead of finding out during a real
// emergency.
const verify = new DatabaseSync(outPath, { readOnly: true });
let integrity;
try {
  integrity = verify.prepare("PRAGMA integrity_check").get();
} finally {
  verify.close();
}
if (!integrity || integrity.integrity_check !== "ok") {
  fs.unlinkSync(outPath);
  console.error(`Backup failed integrity check, removed: ${JSON.stringify(integrity)}`);
  process.exit(1);
}

console.log(`Backed up ${dbPath} -> ${outPath}`);

const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
let pruned = 0;
for (const file of fs.readdirSync(backupsDir)) {
  if (!file.startsWith(prefix) || !file.endsWith(".db")) continue;
  const filePath = path.join(backupsDir, file);
  if (fs.statSync(filePath).mtimeMs < cutoff) {
    fs.unlinkSync(filePath);
    pruned += 1;
  }
}
if (pruned) console.log(`Pruned ${pruned} backup(s) older than ${RETENTION_DAYS} days.`);
