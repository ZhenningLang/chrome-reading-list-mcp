import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function run(fn) {
  try {
    return json(await fn());
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
}

export function createServer(readingList, { version }) {
  const server = new McpServer({ name: "chrome-reading-list", version });

  server.registerTool(
    "reading_list_list",
    {
      title: "List reading list entries",
      description:
        "List entries in the user's Chrome reading list, newest first. The response always includes " +
        "`total` (entries in the whole list) and `matched` (entries matching the filters); page with " +
        "`offset` until you have seen `matched` entries before concluding something is not in the list.",
      inputSchema: {
        status: z.enum(["all", "unread", "read"]).default("all"),
        search: z.string().optional().describe("Words that must all appear in the title or URL (case-insensitive)."),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        sort: z.enum(["newest", "oldest"]).default("newest"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => readingList.list(args)),
  );

  server.registerTool(
    "reading_list_add",
    {
      title: "Add to reading list",
      description: "Add one or more pages to the Chrome reading list. URLs already in the list are skipped.",
      inputSchema: {
        entries: z
          .array(z.object({ url: z.string().url(), title: z.string().optional(), read: z.boolean().optional() }))
          .min(1),
      },
    },
    ({ entries }) => run(() => readingList.add(entries)),
  );

  server.registerTool(
    "reading_list_update",
    {
      title: "Mark read / rename entries",
      description:
        "Mark entries as read or unread, or change their titles. Entries are matched by exact URL. " +
        "Prefer marking as read over removing when the user just finished reading something.",
      inputSchema: {
        entries: z
          .array(z.object({ url: z.string(), read: z.boolean().optional(), title: z.string().optional() }))
          .min(1),
      },
      annotations: { idempotentHint: true },
    },
    ({ entries }) => run(() => readingList.update(entries)),
  );

  server.registerTool(
    "reading_list_remove",
    {
      title: "Remove from reading list",
      description:
        "Remove entries by exact URL (use URLs returned by reading_list_list). A backup of the whole list " +
        "is saved first; its path is returned and reading_list_restore can bring entries back.",
      inputSchema: { urls: z.array(z.string()).min(1) },
      annotations: { destructiveHint: true },
    },
    ({ urls }) => run(() => readingList.remove(urls)),
  );

  server.registerTool(
    "reading_list_restore",
    {
      title: "Restore from backup",
      description:
        "Re-add entries from a backup file written by reading_list_remove. Only entries missing from the " +
        "current list are added. Restored entries get a new 'added' time (Chrome does not allow setting it).",
      inputSchema: {
        backupPath: z.string(),
        urls: z.array(z.string()).optional().describe("Restore only these URLs; omit to restore every missing entry."),
      },
    },
    ({ backupPath, urls }) => run(() => readingList.restore(backupPath, urls)),
  );

  server.registerTool(
    "reading_list_export",
    {
      title: "Export reading list",
      description: "Write the whole reading list to a file (markdown, json or csv) and return its path.",
      inputSchema: {
        format: z.enum(["markdown", "json", "csv"]).default("markdown"),
        path: z.string().optional().describe("Absolute output path. Defaults to ~/.chrome-reading-list-mcp/exports/."),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => readingList.export(args)),
  );

  return server;
}
