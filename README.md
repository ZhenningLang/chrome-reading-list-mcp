# Chrome Reading List MCP

[中文说明](https://github.com/ZhenningLang/chrome-reading-list-mcp/blob/main/README.zh-CN.md)

Let your AI assistant read and tidy up your **Chrome reading list** — the "Add to reading list" items in Chrome's side panel.

Works with any MCP client: Claude Desktop, Claude Code, Cursor, Codex, Windsurf, VS Code and more.

Things you can ask:

- "What's on my reading list about AI agents? Summarize the three newest."
- "Group my unread items by topic and tell me which ones are older than a month."
- "I've read the Rust and Postgres articles — mark them as read."
- "Remove everything from news sites I added before June."
- "Add these five links to my reading list."
- "Export my reading list as Markdown."

## Setup (about 2 minutes)

You need Chrome 120 or newer and [Node.js](https://nodejs.org) 18 or newer.

### 1. Install the Chrome extension

<!-- Replace with the Chrome Web Store link once published. -->
1. Download `extension.zip` from the [latest release](https://github.com/ZhenningLang/chrome-reading-list-mcp/releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `extension` folder.

The extension only has the `readingList` permission and only talks to your own computer (`127.0.0.1`).

### 2. Add the server to your AI client

**Claude Code**

```bash
claude mcp add -s user chrome-reading-list -- npx -y github:ZhenningLang/chrome-reading-list-mcp
```

**Claude Desktop** — Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "chrome-reading-list": { "command": "npx", "args": ["-y", "github:ZhenningLang/chrome-reading-list-mcp"] }
  }
}
```

**Cursor** — same JSON in `~/.cursor/mcp.json`.

**Codex** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.chrome-reading-list]
command = "npx"
args = ["-y", "github:ZhenningLang/chrome-reading-list-mcp"]
```

Restart the client. That's it.

### 3. Check it works

```bash
npx -y github:ZhenningLang/chrome-reading-list-mcp doctor
```

`OK: connected, 365 entries in the reading list` means you're set.

## Tools

| Tool | What it does |
|---|---|
| `reading_list_list` | List entries; filter by read/unread and keywords; always reports the total count |
| `reading_list_add` | Add pages (skips ones already there) |
| `reading_list_update` | Mark read/unread, rename |
| `reading_list_remove` | Remove by URL — **backs up the whole list first** |
| `reading_list_restore` | Bring entries back from a backup |
| `reading_list_export` | Save the list as Markdown, JSON or CSV |

## Safety

- **Nothing leaves your computer.** The extension talks only to the server on `127.0.0.1`; the server talks only to your AI client.
- **Websites can't use it.** The server only accepts the extension's own origin.
- **Deletes are undoable.** Every removal first saves the full list to `~/.chrome-reading-list-mcp/backups/`; ask your assistant to restore from it.
- Your AI assistant does see your reading list titles and URLs when it uses these tools — that's the point, but keep it in mind.

## Troubleshooting

- **"The Chrome extension is not connected"** — make sure Chrome is open and the extension is enabled. If the toolbar icon shows `…`, it's waiting for the server; the AI client starts the server when it launches.
- **Several AI clients at once** is fine: the first one hosts the connection and the others share it.
- **Port 17893 is taken by something else** — not configurable yet; please open an issue.

## Development

```bash
npm install
npm test                 # unit tests with a fake extension
npm run test:e2e         # real Chrome for Testing + the real extension
```

## License

MIT
