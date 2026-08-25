#!/usr/bin/env node

// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0

import { readFileSync, existsSync } from "node:fs";
import process from "node:process";

const docPaths = (process.env.DOCS || process.env.README_PATH || "README.md")
  .split(/\s+/)
  .filter(Boolean);

const errors = [];

for (const docPath of docPaths) {
  const content = readFileSync(docPath, "utf8");
  validateDoc(docPath, content, errors);
}

function validateDoc(docPath, content, errors) {

const bannedPatterns = [
  {
    re: /current version/i,
    msg: 'README must not include a "Current version" callout — use GitHub Releases/tags.',
  },
  {
    re: /^## Versioning\s*$/m,
    msg: 'README must not include a "## Versioning" section — versions live in the manifest and GitHub Releases.',
  },
  {
    re: /then tag \(for example `v/i,
    msg: "README must not include example release tags.",
  },
  {
    re: /github\.com\/jfrog\/jfrog-skills\/blob\/v\d+\.\d+\.\d+/i,
    msg: "README must not pin jfrog-skills doc links to a release tag — use main README or sync-skills-vendor.json.",
  },
  {
    re: /codeload\.github\.com\/jfrog\/jfrog-skills\/(tar\.gz|zip)\/v\d+\.\d+\.\d+/i,
    msg: "README must not embed jfrog-skills release tags in download URLs.",
  },
];

  for (const { re, msg } of bannedPatterns) {
    if (re.test(content)) {
      errors.push(`${docPath}: ${msg}`);
    }
  }

  const manifestPath = process.env.PLUGIN_MANIFEST;
  if (docPath.endsWith("README.md") && manifestPath && existsSync(manifestPath)) {
    let version;
    if (manifestPath.endsWith(".json")) {
      version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
    } else if (manifestPath.endsWith("gradle.properties")) {
      const match = readFileSync(manifestPath, "utf8").match(/^version\s*=\s*(.+)$/m);
      version = match?.[1]?.trim();
    }

    if (version && content.includes(version)) {
      errors.push(
        `${docPath}: contains plugin version "${version}" — authoritative source is ${manifestPath}.`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("README version validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("README version validation passed.");
