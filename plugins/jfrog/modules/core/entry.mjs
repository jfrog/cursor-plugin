// Shared "was this module run as the CLI entrypoint?" check for the adapters.
//
// Claude invokes hooks as `${CLAUDE_PLUGIN_ROOT}/modules/<adapter>.mjs`, and a
// plugin install directory is often a symlink. Node resolves the main entry to
// its real path before assigning import.meta.url, so comparing against a raw
// path.resolve(process.argv[1]) reports false under a symlinked layout and the
// hook silently becomes a no-op with exit code 0. Compare against both.

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * @param {string} moduleUrl — the caller's import.meta.url
 * @param {string} [entry] — defaults to process.argv[1]
 */
export function isMainEntry(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;

  try {
    const resolved = path.resolve(entry);
    let real = resolved;
    try {
      real = realpathSync(resolved);
    } catch {
      // Entry may not exist on disk (e.g. a virtual entrypoint); use as-is.
    }
    return (
      moduleUrl === pathToFileURL(real).href ||
      moduleUrl === pathToFileURL(resolved).href
    );
  } catch {
    return false;
  }
}
