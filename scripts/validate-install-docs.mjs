#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// Validates install/recovery documentation invariants.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();

const HARNESS_OWN_REPO = {
  claude: 'claude-plugin',
  codex: 'codex-plugin',
  cursor: 'cursor-plugin',
  devin: 'devin-plugin',
  opencode: 'opencode-jfrog-plugin',
  vscode: 'vscode-plugin',
};

const ALL_PLUGIN_REPOS = Object.values(HARNESS_OWN_REPO);

const REQUIRED_README_MARKERS = ['## Verify', '## Recovery'];

const FORBIDDEN_PATTERNS = [
  {
    re: /setting\s+(?:the\s+)?environment\s+variables?\s+after\s+a\s+failed\s+init\s+may\s+repair/i,
    message: 'must not claim env vars repair failed init',
  },
  {
    re: /JFROG_URL/,
    message: 'must not document the legacy JFROG_URL env var; use JFROG_PLATFORM_URL',
  },
  {
    re: /atlassian\.net/i,
    message: 'must not reference JFrog Jira (atlassian.net) in repo files',
  },
  {
    re: /\b(?:AX|MLD)-\d+\b/,
    message: 'must not include Jira ticket keys in repo files',
  },
];

export function validateInstallDocs({ repoRoot: root, harness }) {
  const errors = [];
  const readmePath = join(root, 'README.md');
  if (!existsSync(readmePath)) {
    return [`${harness}: missing README.md`];
  }
  const files = [{ label: 'README.md', text: readFileSync(readmePath, 'utf8') }];

  const readme = files[0].text;
  for (const marker of REQUIRED_README_MARKERS) {
    if (!readme.includes(marker)) {
      errors.push(`${harness}: README.md missing required marker: ${marker}`);
    }
  }

  const ownRepo = HARNESS_OWN_REPO[harness];
  const otherRepos = ALL_PLUGIN_REPOS.filter((name) => name !== ownRepo);

  for (const { label, text } of files) {
    for (const { re, message } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) errors.push(`${harness}: ${label} ${message}`);
    }
    for (const other of otherRepos) {
      if (text.includes(`github.com/jfrog/${other}`)) {
        errors.push(`${harness}: ${label} must not link to github.com/jfrog/${other}`);
      }
    }
  }

  return errors;
}

function main() {
  const harness = process.env.JFROG_PLUGIN_HARNESS ?? inferHarness(repoRoot);
  const errors = validateInstallDocs({ repoRoot, harness });
  if (errors.length) {
    console.error('install-docs validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('install-docs validation passed');
}

function inferHarness(root) {
  if (existsSync(join(root, '.codex-plugin'))) return 'codex';
  if (existsSync(join(root, '.devin-plugin'))) return 'devin';
  if (existsSync(join(root, '.claude-plugin'))) return 'claude';
  if (existsSync(join(root, 'plugins', 'jfrog', '.cursor-plugin'))) return 'cursor';
  if (existsSync(join(root, 'plugin', '.claude-plugin'))) return 'vscode';
  if (existsSync(join(root, 'package.json')) && root.endsWith('opencode-jfrog-plugin')) return 'opencode';
  return 'unknown';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
