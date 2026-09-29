// Reading-list operations built on four extension primitives:
// query / add / update / remove. Filtering, batching, backups and export live
// here so the extension stays tiny and easy to audit.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ensureHome } from "./config.js";

export class ReadingList {
  constructor(bridge, { homeDir, now = () => new Date() }) {
    this.bridge = bridge;
    this.homeDir = homeDir;
    this.now = now;
  }

  async all() {
    const entries = await this.bridge.call("query", {});
    return entries.map(normalize);
  }

  async list({ status = "all", search, limit = 50, offset = 0, sort = "newest" } = {}) {
    const all = await this.all();
    let matched = all;
    if (status === "unread") matched = matched.filter((e) => !e.read);
    if (status === "read") matched = matched.filter((e) => e.read);
    if (search) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      matched = matched.filter((e) => {
        const hay = `${e.title} ${e.url}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    matched.sort((a, b) => (sort === "oldest" ? a.createdMs - b.createdMs : b.createdMs - a.createdMs));
    return {
      total: all.length,
      unread: all.filter((e) => !e.read).length,
      matched: matched.length,
      offset,
      entries: matched.slice(offset, offset + limit).map(present),
    };
  }

  async add(items) {
    const existing = new Set((await this.all()).map((e) => e.url));
    const added = [];
    const skipped = [];
    for (const { url, title, read = false } of items) {
      if (existing.has(url)) {
        skipped.push({ url, reason: "already in reading list" });
        continue;
      }
      await this.bridge.call("add", { url, title: title || url, hasBeenRead: read });
      existing.add(url);
      added.push(url);
    }
    return { added, skipped };
  }

  async update(items) {
    const existing = new Set((await this.all()).map((e) => e.url));
    const updated = [];
    const notFound = [];
    for (const { url, title, read } of items) {
      if (!existing.has(url)) {
        notFound.push(url);
        continue;
      }
      const params = { url };
      if (title !== undefined) params.title = title;
      if (read !== undefined) params.hasBeenRead = read;
      await this.bridge.call("update", params);
      updated.push(url);
    }
    return { updated, notFound };
  }

  /** Removes entries by exact URL. Always writes a full backup first. */
  async remove(urls) {
    const all = await this.all();
    const byUrl = new Map(all.map((e) => [e.url, e]));
    const backupPath = this.#backup(all);
    const removed = [];
    const notFound = [];
    for (const url of urls) {
      const entry = byUrl.get(url);
      if (!entry) {
        notFound.push(url);
        continue;
      }
      await this.bridge.call("remove", { url });
      removed.push({ url, title: entry.title });
    }
    return { removed, notFound, backupPath, before: all.length, after: all.length - removed.length };
  }

  /** Re-adds entries from a backup file that are missing from the list now. */
  async restore(backupPath, urls) {
    const backup = JSON.parse(readFileSync(backupPath, "utf8"));
    const wanted = urls ? new Set(urls) : null;
    const items = backup.entries
      .filter((e) => !wanted || wanted.has(e.url))
      .map((e) => ({ url: e.url, title: e.title, read: e.read }));
    return this.add(items);
  }

  async export({ format = "markdown", path }) {
    const all = (await this.all()).sort((a, b) => b.createdMs - a.createdMs);
    const stamp = this.now().toISOString().slice(0, 10);
    const ext = { markdown: "md", json: "json", csv: "csv" }[format];
    const target = path || join(this.homeDir, "exports", `reading-list-${stamp}.${ext}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, render(all, format), { mode: 0o600 });
    return { path: target, count: all.length, format };
  }

  #backup(entries) {
    ensureHome(this.homeDir);
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    const path = join(this.homeDir, "backups", `reading-list-${stamp}.json`);
    writeFileSync(path, JSON.stringify({ createdAt: this.now().toISOString(), count: entries.length, entries: entries.map(present) }, null, 2), {
      mode: 0o600,
    });
    return path;
  }
}

function normalize(e) {
  return {
    url: e.url,
    title: e.title ?? "",
    read: Boolean(e.hasBeenRead),
    createdMs: e.creationTime ?? 0,
    updatedMs: e.lastUpdateTime ?? 0,
  };
}

function present(e) {
  return {
    url: e.url,
    title: e.title,
    read: e.read,
    added: e.createdMs ? new Date(e.createdMs).toISOString() : null,
  };
}

function render(entries, format) {
  if (format === "json") return JSON.stringify(entries.map(present), null, 2);
  if (format === "csv") {
    const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = entries.map((e) => [q(e.title), q(e.url), e.read, q(present(e).added)].join(","));
    return ["title,url,read,added", ...rows].join("\n") + "\n";
  }
  const line = (e) => `- [${e.read ? "x" : " "}] [${e.title.replace(/[[\]]/g, "")}](${e.url})`;
  const unread = entries.filter((e) => !e.read);
  const read = entries.filter((e) => e.read);
  return [
    `# Reading list (${entries.length})`,
    "",
    `## Unread (${unread.length})`,
    "",
    ...unread.map(line),
    "",
    `## Read (${read.length})`,
    "",
    ...read.map(line),
    "",
  ].join("\n");
}
