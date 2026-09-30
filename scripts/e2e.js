// End-to-end check against a real Chrome: launches Chrome for Testing with the
// extension loaded into a throwaway profile, starts the MCP server over stdio
// the way an AI client would, and exercises every tool.
//
//   CHROME_BIN=/path/to/chrome node scripts/e2e.js
//
// Uses the default port (17893), so stop any running copy of the server first.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(import.meta.dirname, "..");
const chromeBin =
  process.env.CHROME_BIN || "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const profile = mkdtempSync(join(tmpdir(), "crl-e2e-profile-"));
const home = mkdtempSync(join(tmpdir(), "crl-e2e-home-"));

// CHROME_FIRST=1 starts Chrome before the server, like a user whose browser is
// already open when the AI client launches; the extension must find the server
// on its periodic reconnect.
const chromeFirst = Boolean(process.env.CHROME_FIRST);
let chrome;
const startChrome = () => {
  chrome = spawn(
    chromeBin,
    [
      `--user-data-dir=${profile}`,
      `--load-extension=${join(root, "extension")}`,
      "--no-first-run",
      "--no-default-browser-check",
      process.env.HEADED ? "" : "--headless=new",
      "about:blank",
    ].filter(Boolean),
    { stdio: "ignore" },
  );
};
const client = new Client({ name: "e2e", version: "0" });
if (chromeFirst) {
  startChrome();
  await new Promise((r) => setTimeout(r, 5000));
}
const t0 = Date.now();
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "src/cli.js")],
    env: { ...process.env, READING_LIST_MCP_HOME: home },
    stderr: "inherit",
  }),
);

if (!chromeFirst) startChrome();

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

const steps = [];
const step = (label, value) => {
  steps.push(label);
  console.log(`ok ${steps.length} - ${label}${value === undefined ? "" : `: ${value}`}`);
};

try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  step("tools listed", tools.join(", "));

  const empty = await call("reading_list_list");
  step("extension connected, fresh profile list", `total=${empty.total}, ${Math.round((Date.now() - t0) / 1000)}s after server start`);
  const base = empty.total;

  const added = await call("reading_list_add", {
    entries: [
      { url: "https://example.com/agents-md", title: "Slimming AGENTS.md" },
      { url: "https://example.org/prompting", title: "Prompting Fundamentals" },
      { url: "https://example.net/rust", title: "Rust async book", read: true },
    ],
  });
  assert.equal(added.added.length, 3);
  const dup = await call("reading_list_add", { entries: [{ url: "https://example.com/agents-md" }] });
  assert.equal(dup.skipped.length, 1);
  step("added 3 entries, duplicate skipped");

  const listed = await call("reading_list_list", { status: "unread" });
  assert.equal(listed.total, base + 3);
  assert.equal(listed.matched, 2);
  step("list unread", listed.entries.map((e) => e.title).join(" | "));

  const upd = await call("reading_list_update", {
    entries: [{ url: "https://example.org/prompting", read: true, title: "Prompting Fundamentals (done)" }],
  });
  assert.deepEqual(upd.updated, ["https://example.org/prompting"]);
  const search = await call("reading_list_list", { search: "done" });
  assert.equal(search.entries[0].read, true);
  step("marked read and renamed via real chrome.readingList");

  const rm = await call("reading_list_remove", { urls: ["https://example.com/agents-md"] });
  assert.equal(rm.removed.length, 1);
  assert.ok(existsSync(rm.backupPath));
  const after = await call("reading_list_list");
  assert.equal(after.total, base + 2);
  step("removed 1 entry, backup at", rm.backupPath.replace(home, "$HOME_DIR"));

  const restored = await call("reading_list_restore", { backupPath: rm.backupPath });
  assert.deepEqual(restored.added, ["https://example.com/agents-md"]);
  assert.equal((await call("reading_list_list")).total, base + 3);
  step("restored removed entry from backup");

  const exp = await call("reading_list_export", { format: "markdown" });
  const md = readFileSync(exp.path, "utf8");
  assert.match(md, /Slimming AGENTS\.md/);
  step("exported markdown", `${exp.count} entries`);

  console.log(`\nE2E PASSED (${steps.length} steps)`);
} catch (err) {
  console.error(`\nE2E FAILED after ${steps.length} steps: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
  chrome.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(profile, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
