#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.env.JF_MCP_GATEWAY_FORCE_ENABLE !== "true") {
  process.stdout.write("{}");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let template;
try {
  template = readFileSync(
    path.join(root, "templates", "jfrog-mcp-management.md"),
    "utf8",
  );
} catch {
  process.stdout.write("{}");
  process.exit(0);
}

process.stdout.write(
  JSON.stringify({
    additional_context: template,
  }),
);
