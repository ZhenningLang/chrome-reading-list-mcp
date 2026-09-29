#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { ReadingList } from "./readingList.js";
import { createServer } from "./server.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const log = (msg) => process.stderr.write(`[chrome-reading-list-mcp] ${msg}\n`);

async function main(argv) {
  const cmd = argv[0];
  if (cmd === "--version" || cmd === "-v") return console.log(version);
  if (cmd === "--help" || cmd === "-h") return console.log(HELP);

  const config = loadConfig();
  const bridge = new Bridge({ ...config, log });
  await bridge.start();
  const readingList = new ReadingList(bridge, { homeDir: config.homeDir });

  if (cmd === "doctor") return doctor(bridge, readingList, config);

  const server = createServer(readingList, { version });
  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.stdin.on("close", shutdown);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function doctor(bridge, readingList, config) {
  console.log(`config dir : ${config.homeDir}`);
  console.log(`port       : ${config.port} (${bridge.mode})`);
  console.log("waiting for the Chrome extension to connect...");
  try {
    const { total, unread } = await readingList.list({ limit: 1 });
    console.log(`OK: connected, ${total} entries in the reading list (${unread} unread).`);
    await bridge.close();
    process.exit(0);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    await bridge.close();
    process.exit(1);
  }
}

const HELP = `chrome-reading-list-mcp ${version}

Usage:
  chrome-reading-list-mcp          run the MCP server (stdio); your AI client starts this
  chrome-reading-list-mcp doctor   check that the Chrome extension is connected

Environment:
  READING_LIST_MCP_PORT           local port shared with the extension (default 17893)
  READING_LIST_MCP_HOME           where backups and exports go (default ~/.chrome-reading-list-mcp)
  READING_LIST_MCP_EXTENSION_IDS  extra extension IDs allowed to connect (comma separated)
`;

main(process.argv.slice(2)).catch((err) => {
  log(err.stack || err.message);
  process.exit(1);
});
