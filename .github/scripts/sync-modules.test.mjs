// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  restoreKeepFiles,
  stashKeepFiles,
} from "./sync-modules.mjs";

test("stashKeepFiles + restoreKeepFiles round-trip overlay files", async () => {
  const destRoot = mkdtempSync(path.join(tmpdir(), "sync-keep-"));
  const rel = path.join("modules", "core", "rewrite-mcp-json.mjs");
  const full = path.join(destRoot, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "overlay-v1\n");

  const stash = await stashKeepFiles(destRoot, [rel, "modules/core/missing.mjs"]);
  assert.equal(stash.size, 1);
  assert.equal(stash.get(rel)?.toString("utf8"), "overlay-v1\n");
  // Simulate sync wiping the tree.
  writeFileSync(full, "upstream-empty\n");

  await restoreKeepFiles(destRoot, stash);
  assert.equal(readFileSync(full, "utf8"), "overlay-v1\n");
});
