#!/usr/bin/env node
// Vendors skill content from the upstream jfrog/jfrog-skills repository
// into this plugin at release time. `main` itself never contains the
// synced files — they live only on the release tag.
//
// Called by .github/workflows/release.yml. Also safe to run locally to
// preview what a pin bump will produce — plugins/<plugin>/skills/ is
// gitignored, so the result is invisible to git.
//
// For each plugin listed in .cursor-plugin/marketplace.json, this script:
//   1. Reads <plugin>/.vendor.json to learn which repo + ref to pull.
//   2. Downloads that tarball from codeload.github.com (public, no auth).
//   3. Extracts it into a temp directory.
//   4. Copies the requested paths (e.g. "skills") into the plugin folder.
//
// Set SKILLS_REF to override the pin for one run (e.g. SKILLS_REF=v0.12.0).

import { promises as fs, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

// filesystem helpers
async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

// download the upstream tarball

// codeload.github.com serves any public repo's archive over HTTPS
// without auth, accepting a tag, branch, or commit SHA as the ref.
async function downloadTarball(repo, ref, destPath) {
  const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Could not download ${repo}@${ref} (HTTP ${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  console.log(`  fetched ${url}`);
}

// extract the tarball

// Shells out to the system `tar` instead of pulling in an npm tar library —
// keeps the script zero-dependency.
//
// GitHub tarballs always have exactly one top-level directory whose
// name encodes the repo + commit. We return that path so the caller
// knows where to find the extracted tree.
async function extractTarball(tarballPath, intoDir) {
  await fs.mkdir(intoDir, { recursive: true });
  const result = spawnSync("tar", ["-xzf", tarballPath, "-C", intoDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tar exited with status ${result.status}`);
  const [topLevel] = await fs.readdir(intoDir);
  return path.join(intoDir, topLevel);
}

// copy one path from the extracted tree into the plugin

// Removes the destination first so we never end up with stale leftovers
// from a previous sync, then creates the destination's parent directory then copies.
async function copyPath(fromDir, toDir, relativePath) {
  const from = path.join(fromDir, relativePath);
  const to = path.join(toDir, relativePath);
  if (!(await fileExists(from))) {
    throw new Error(`path missing in upstream tarball: ${relativePath}`);
  }
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
  console.log(`  ${relativePath} -> ${path.relative(process.cwd(), to)}`);
}

// Resolve a marketplace plugin entry to its on-disk directory.
//
// The Cursor marketplace manifest can declare a shared `metadata.pluginRoot`
// (e.g. "plugins") that is prepended to each plugin's `source` (e.g. "jfrog"),
// so the real plugin folder is `plugins/jfrog`. If `pluginRoot` is absent or
// already a prefix of `source`, the source is used as-is.
function resolvePluginDir(plugin, pluginRoot) {
  const source = plugin.source ?? "";
  if (!source) throw new Error(`plugin "${plugin.name}" is missing a "source"`);
  if (!pluginRoot) return path.resolve(source);
  const normalizedRoot = pluginRoot.replace(/\/+$/, "");
  if (source === normalizedRoot || source.startsWith(`${normalizedRoot}/`)) {
    return path.resolve(source);
  }
  return path.resolve(normalizedRoot, source);
}

// Sync one plugin: read its .vendor.json, download + extract + copy.
// Plugins without a .vendor.json are silently skipped.
//
// SKILLS_REF env var (set by the release workflow's `skills_version`
// input) overrides the pin for ad-hoc releases; falls back to the
// pin in .vendor.json when unset or empty.
async function syncPlugin(plugin, pluginRoot, workDir) {
  const pluginDir = resolvePluginDir(plugin, pluginRoot);
  const vendorPath = path.join(pluginDir, ".vendor.json");
  if (!(await fileExists(vendorPath))) return;

  const { repo, pin, paths } = await readJson(vendorPath);
  if (!repo || !pin || !Array.isArray(paths) || paths.length === 0) {
    throw new Error(`${vendorPath} must define 'repo', 'pin' and a non-empty 'paths' array`);
  }

  const ref = process.env.SKILLS_REF?.trim() || pin;
  const overridden = ref !== pin;
  console.log(`--- ${plugin.name} (ref: ${ref}${overridden ? " [override]" : ""}) ---`);

  // `slug` is just a unique filename for this plugin's tarball + extract.
  const slug = `${repo.replace("/", "-")}-${ref.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const tarball = path.join(workDir, `${slug}.tar.gz`);
  await downloadTarball(repo, ref, tarball);
  const extracted = await extractTarball(tarball, path.join(workDir, slug));
  for (const rel of paths) await copyPath(extracted, pluginDir, rel);
}

// Entry point: walk .cursor-plugin/marketplace.json, sync each plugin
// sequentially, always clean up the temp work directory.
async function main() {
  const marketplace = await readJson(".cursor-plugin/marketplace.json");
  const pluginRoot = marketplace.metadata?.pluginRoot ?? "";
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "sync-skills-"));
  try {
    for (const plugin of marketplace.plugins ?? []) {
      await syncPlugin(plugin, pluginRoot, workDir);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
  console.log("done.");
}

await main();
