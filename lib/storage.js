const fs = require("fs");
const path = require("path");

/* Storage layer for the JSON data files (shared by every brand).
   ------------------------------------------------------------------
   All reads/writes of data/*.json go through here so the persistence
   format can later be swapped (SQLite/PostgreSQL) without touching the
   HTTP handlers. Guarantees:

   - readJson distinguishes "file missing" (normal - return the fallback)
     from "file exists but is corrupt" (never silently replaced with an
     empty fallback: log loudly, preserve the corrupt file sideways, try
     the newest valid backup, otherwise fail the operation with a 500).
   - writeJson stays atomic (unique .tmp + rename) and fsyncs the temp
     file before the rename so a crash mid-write can't tear a data file.
   - acquireProcessLock prevents two server processes from writing the
     same DATA_DIR at the same time (each brand runs as its own process
     with its own DATA_DIR; a second copy of the same brand must refuse
     to start instead of interleaving writes). */

function createStorage({ dataDir, backupsDir }) {
  function filePathFor(fileName) {
    return path.join(dataDir, fileName);
  }

  // Newest backup directory first. Backup dirs are ISO timestamps with
  // ":"/"." replaced, so a plain descending sort is newest-first.
  function backupCandidates(fileName) {
    let entries;
    try {
      entries = fs.readdirSync(backupsDir)
        .filter((name) => {
          try {
            return fs.statSync(path.join(backupsDir, name)).isDirectory();
          } catch {
            return false;
          }
        })
        .sort()
        .reverse();
    } catch {
      return [];
    }
    return entries.map((name) => path.join(backupsDir, name, fileName));
  }

  function restoreFromBackup(fileName) {
    for (const candidate of backupCandidates(fileName)) {
      try {
        const raw = fs.readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw);
        return { parsed, from: candidate };
      } catch {
        // corrupt or missing in this snapshot - keep looking at older ones
      }
    }
    return null;
  }

  function readJson(fileName, fallback) {
    const filePath = filePathFor(fileName);
    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      const wrapped = new Error(`Nu pot citi fisierul de date ${fileName}: ${error.message}`);
      wrapped.statusCode = 500;
      throw wrapped;
    }

    try {
      return JSON.parse(raw);
    } catch (parseError) {
      console.error(`[storage] JSON corupt in ${filePath}: ${parseError.message}`);

      const restored = restoreFromBackup(fileName);
      if (restored) {
        // Preserve the corrupt file sideways (never overwrite/delete data),
        // then put the last known-good backup in its place.
        const corruptCopy = `${filePath}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(filePath, corruptCopy);
          writeJson(fileName, restored.parsed);
          console.error(`[storage] ${fileName} restaurat din backup ${restored.from}. Fisierul corupt a fost pastrat la ${corruptCopy}`);
          return restored.parsed;
        } catch (restoreError) {
          console.error(`[storage] Restaurarea ${fileName} din backup a esuat: ${restoreError.message}`);
        }
      }

      const error = new Error(`Fisierul de date ${fileName} este corupt si nu exista backup valid. Interventie manuala necesara.`);
      error.statusCode = 500;
      error.code = "DATA_CORRUPT";
      throw error;
    }
  }

  function writeJson(fileName, data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = filePathFor(fileName);
    // Unique temp name so two in-flight writes can never share a temp file.
    const tempPath = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    const fd = fs.openSync(tempPath, "w");
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
  }

  // Cross-process guard: a pid lock file in dataDir. If another *live*
  // process holds it, refuse; a stale lock (dead pid) is taken over.
  function acquireProcessLock() {
    fs.mkdirSync(dataDir, { recursive: true });
    const lockPath = path.join(dataDir, ".server.lock");

    const takeover = () => {
      try {
        fs.writeFileSync(lockPath, String(process.pid));
        return true;
      } catch {
        return false;
      }
    };

    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let ownerPid = NaN;
      try {
        ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim());
      } catch {
        // unreadable lock - treat as stale
      }
      if (Number.isFinite(ownerPid) && ownerPid !== process.pid) {
        let alive = false;
        try {
          process.kill(ownerPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
        if (alive) {
          const busy = new Error(`DATA_DIR "${dataDir}" este deja folosit de procesul ${ownerPid}. Doua procese nu pot scrie simultan aceleasi date.`);
          busy.code = "DATA_DIR_LOCKED";
          throw busy;
        }
      }
      takeover();
    }

    const release = () => {
      try {
        const owner = Number(fs.readFileSync(lockPath, "utf8").trim());
        if (owner === process.pid) fs.unlinkSync(lockPath);
      } catch {
        // best effort
      }
    };
    process.once("exit", release);
    return release;
  }

  return { readJson, writeJson, acquireProcessLock, dataDir, backupsDir };
}

module.exports = { createStorage };
