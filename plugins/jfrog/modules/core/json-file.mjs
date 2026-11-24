// JSON state files shared by the hooks' background work.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Write JSON through a temp file and a rename, so a reader never sees half a
 * file. Throws when the file can't be written; the temp file is removed.
 * @param {string} file
 * @param {unknown} data
 */
export function writeJsonAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
