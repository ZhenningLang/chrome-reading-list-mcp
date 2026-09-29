import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const DEFAULT_PORT = 17893;

// ID of the extension when loaded unpacked from ./extension (fixed by the "key"
// field in its manifest). Add the Chrome Web Store ID here once published.
export const KNOWN_EXTENSION_IDS = ["ccclijbaodgdphbciifmfgnihbadlloj"];

export function loadConfig(env = process.env) {
  const extra = (env.READING_LIST_MCP_EXTENSION_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: Number(env.READING_LIST_MCP_PORT) || DEFAULT_PORT,
    homeDir: env.READING_LIST_MCP_HOME || join(homedir(), ".chrome-reading-list-mcp"),
    allowedExtensionIds: [...KNOWN_EXTENSION_IDS, ...extra],
  };
}

export function ensureHome(homeDir) {
  mkdirSync(join(homeDir, "backups"), { recursive: true, mode: 0o700 });
}

/** Shared secret that lets a second server process relay through the first. */
export function readToken(homeDir) {
  ensureHome(homeDir);
  const file = join(homeDir, "token");
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600, flag: "wx" });
    } catch (err) {
      if (err.code !== "EEXIST") throw err; // another process created it first
    }
  }
  chmodSync(file, 0o600);
  return readFileSync(file, "utf8").trim();
}
