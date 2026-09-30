import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { Bridge } from "../src/bridge.js";
import { ReadingList } from "../src/readingList.js";

const EXT_ID = "ccclijbaodgdphbciifmfgnihbadlloj";
// Windows has no POSIX permission bits; files under the user profile are
// already private through the default ACLs.
const POSIX = process.platform !== "win32";
let port = 27000 + Math.floor(Math.random() * 2000);
let homeDir;
let cleanup = [];

beforeEach(() => {
  port += 1;
  homeDir = mkdtempSync(join(tmpdir(), "crl-test-"));
});

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function startBridge(opts = {}) {
  const bridge = new Bridge({ port, allowedExtensionIds: [EXT_ID], homeDir, connectWaitMs: 1500, callTimeoutMs: 1500, ...opts });
  await bridge.start();
  cleanup.push(() => bridge.close());
  return bridge;
}

/** A fake extension backed by an in-memory reading list. */
function fakeExtension(entries, { origin = `chrome-extension://${EXT_ID}` } = {}) {
  const store = new Map(entries.map((e) => [e.url, { ...e }]));
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  const handlers = {
    query: () => [...store.values()],
    add: ({ url, title, hasBeenRead }) => {
      store.set(url, { url, title, hasBeenRead, creationTime: Date.now(), lastUpdateTime: Date.now() });
    },
    update: ({ url, ...rest }) => Object.assign(store.get(url), rest),
    remove: ({ url }) => store.delete(url),
  };
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (!msg.id) return;
    ws.send(JSON.stringify({ id: msg.id, result: handlers[msg.method](msg.params) ?? null }));
  });
  const opened = new Promise((resolve) => ws.once("open", resolve));
  const closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
  cleanup.push(() => ws.terminate());
  return { ws, store, opened, closed };
}

const sample = () => [
  { url: "https://a.example/agents-md", title: "Slimming AGENTS.md", hasBeenRead: false, creationTime: 3000 },
  { url: "https://b.example/rust", title: "Rust async book", hasBeenRead: true, creationTime: 2000 },
  { url: "https://c.example/prompting", title: "Prompting Fundamentals", hasBeenRead: false, creationTime: 1000 },
];

test("list reports total and matched, filters by status and search", async () => {
  const bridge = await startBridge();
  const ext = fakeExtension(sample());
  await ext.opened;
  const rl = new ReadingList(bridge, { homeDir });

  const all = await rl.list();
  assert.equal(all.total, 3);
  assert.equal(all.unread, 2);
  assert.deepEqual(all.entries.map((e) => e.title), ["Slimming AGENTS.md", "Rust async book", "Prompting Fundamentals"]);

  const unread = await rl.list({ status: "unread", search: "prompting" });
  assert.equal(unread.matched, 1);
  assert.equal(unread.entries[0].url, "https://c.example/prompting");

  const page = await rl.list({ limit: 1, offset: 1 });
  assert.equal(page.matched, 3);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].title, "Rust async book");
});

test("remove writes a private backup first and restore brings entries back", async () => {
  const bridge = await startBridge();
  const ext = fakeExtension(sample());
  await ext.opened;
  const rl = new ReadingList(bridge, { homeDir });

  const res = await rl.remove(["https://a.example/agents-md", "https://missing.example/"]);
  assert.deepEqual(res.removed.map((r) => r.url), ["https://a.example/agents-md"]);
  assert.deepEqual(res.notFound, ["https://missing.example/"]);
  assert.equal(res.before, 3);
  assert.equal(res.after, 2);
  assert.equal(ext.store.size, 2);

  const backup = JSON.parse(readFileSync(res.backupPath, "utf8"));
  assert.equal(backup.count, 3);
  if (POSIX) assert.equal(statSync(res.backupPath).mode & 0o777, 0o600);

  const restored = await rl.restore(res.backupPath);
  assert.deepEqual(restored.added, ["https://a.example/agents-md"]);
  assert.equal(restored.skipped.length, 2);
  assert.equal(ext.store.size, 3);
});

test("update marks read and reports unknown urls", async () => {
  const bridge = await startBridge();
  const ext = fakeExtension(sample());
  await ext.opened;
  const rl = new ReadingList(bridge, { homeDir });

  const res = await rl.update([
    { url: "https://c.example/prompting", read: true },
    { url: "https://nope.example/", read: true },
  ]);
  assert.deepEqual(res.updated, ["https://c.example/prompting"]);
  assert.deepEqual(res.notFound, ["https://nope.example/"]);
  assert.equal(ext.store.get("https://c.example/prompting").hasBeenRead, true);
});

test("export writes markdown with every entry", async () => {
  const bridge = await startBridge();
  const ext = fakeExtension(sample());
  await ext.opened;
  const rl = new ReadingList(bridge, { homeDir, now: () => new Date("2026-09-29T00:00:00Z") });

  const res = await rl.export({ format: "markdown" });
  assert.equal(res.count, 3);
  assert.equal(res.path, join(homeDir, "exports", "reading-list-2026-09-29.md"));
  const md = readFileSync(res.path, "utf8");
  assert.match(md, /## Unread \(2\)/);
  assert.match(md, /- \[x\] \[Rust async book\]\(https:\/\/b\.example\/rust\)/);
});

test("connections from other origins are rejected", async () => {
  const bridge = await startBridge();
  const evil = fakeExtension(sample(), { origin: "https://evil.example" });
  assert.equal(await evil.closed, 4003);
  await assert.rejects(bridge.call("query"), /not connected/);
});

test("a second server process relays through the first (peer mode)", async () => {
  const hub = await startBridge();
  const ext = fakeExtension(sample());
  await ext.opened;
  const peer = await startBridge();
  assert.equal(hub.mode, "hub");
  assert.equal(peer.mode, "peer");

  const res = await new ReadingList(peer, { homeDir }).list();
  assert.equal(res.total, 3);
});

test("a peer without the token is refused", async () => {
  await startBridge();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.terminate());
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "hello", role: "peer", token: "wrong" }));
  const code = await new Promise((r) => ws.once("close", r));
  assert.equal(code, 4001);
});

test("peer takes over as hub when the first process exits", async () => {
  const hub = await startBridge();
  const peer = await startBridge();
  assert.equal(peer.mode, "peer");
  await hub.close();
  // The next call finds no hub, takes over the port and waits for the extension.
  const call = new ReadingList(peer, { homeDir }).list();
  await new Promise((r) => setTimeout(r, 100));
  const ext = fakeExtension(sample());
  await ext.opened;
  const res = await call;
  assert.equal(peer.mode, "hub");
  assert.equal(res.total, 3);
});

test("token file is created with owner-only permissions", async () => {
  await startBridge();
  const file = join(homeDir, "token");
  assert.ok(existsSync(file));
  if (POSIX) assert.equal(statSync(file).mode & 0o777, 0o600);
});
