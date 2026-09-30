# Chrome 阅读清单 MCP

[English](README.md)

让你的 AI 助手读取、整理你的 **Chrome 阅读清单**，也就是侧边栏里"添加到阅读清单"的那些文章。

支持所有 MCP 客户端：Claude Desktop、Claude Code、Cursor、Codex、opencode、Kilo、Windsurf、VS Code 等。

可以这样问它：

- "我的阅读清单里有哪些讲 AI agent 的？总结最新的三篇。"
- "把没读的按主题分组，告诉我哪些放了一个多月还没读。"
- "Rust 和 Postgres 那两篇我读完了，标成已读。"
- "删掉六月以前加的所有新闻网站文章。"
- "把这五个链接加进阅读清单。"
- "把阅读清单导出成 Markdown。"

## 安装（约 2 分钟）

需要 Chrome 120 及以上，以及 [Node.js](https://nodejs.org) 18 及以上。

### 1. 装 Chrome 扩展

<!-- 上架 Chrome 应用商店后替换成商店链接 -->
1. 从[最新发布](https://github.com/ZhenningLang/chrome-reading-list-mcp/releases/latest)下载 `extension.zip` 并解压。
2. 打开 `chrome://extensions`，打开右上角的"开发者模式"。
3. 点"加载已解压的扩展程序"，选择解压出来的 `extension` 文件夹。

扩展只申请了阅读清单这一项权限，只和你自己电脑上的程序（`127.0.0.1`）通信。

### 2. 把服务加到 AI 客户端

**Claude Code**

```bash
claude mcp add -s user chrome-reading-list -- npx -y github:ZhenningLang/chrome-reading-list-mcp
```

**Claude Desktop**：设置 → 开发者 → 编辑配置，加入：

```json
{
  "mcpServers": {
    "chrome-reading-list": { "command": "npx", "args": ["-y", "github:ZhenningLang/chrome-reading-list-mcp"] }
  }
}
```

**Cursor**：同样的 JSON 写进 `~/.cursor/mcp.json`。

**Codex**：写进 `~/.codex/config.toml`：

```toml
[mcp_servers.chrome-reading-list]
command = "npx"
args = ["-y", "github:ZhenningLang/chrome-reading-list-mcp"]
```

**opencode**：写进 `~/.config/opencode/opencode.json`：

```json
{
  "mcp": {
    "chrome-reading-list": {
      "type": "local",
      "command": ["npx", "-y", "github:ZhenningLang/chrome-reading-list-mcp"],
      "enabled": true
    }
  }
}
```

**Kilo CLI**：同样的内容写进 `~/.config/kilo/kilo.json`。

重启客户端即可。

### 3. 检查是否连通

```bash
npx -y github:ZhenningLang/chrome-reading-list-mcp doctor
```

看到 `OK: connected, 365 entries in the reading list` 就说明好了。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `reading_list_list` | 列出条目，可按已读/未读、关键词筛选；总是返回总条数 |
| `reading_list_add` | 添加网页（已存在的会跳过） |
| `reading_list_update` | 标记已读/未读、改标题 |
| `reading_list_remove` | 按网址删除，**删除前先备份整个清单** |
| `reading_list_restore` | 从备份恢复条目 |
| `reading_list_export` | 导出成 Markdown、JSON 或 CSV |

## 安全

- **数据不出你的电脑。** 扩展只连本机 `127.0.0.1` 上的服务，服务只和你的 AI 客户端通信。
- **网页用不了它。** 服务只接受这个扩展自己的来源。
- **删除可以撤回。** 每次删除前都会把整个清单备份到 `~/.chrome-reading-list-mcp/backups/`，让 AI 助手从备份恢复即可。
- AI 助手调用这些工具时，会看到阅读清单里的标题和网址。这正是它的用途，但你要心里有数。

## 常见问题

- **提示 "The Chrome extension is not connected"**：确认 Chrome 开着、扩展已启用。工具栏图标显示 `…` 表示它在等服务启动；服务由 AI 客户端启动时自动拉起。
- **同时开多个 AI 客户端**没问题：第一个负责连接，其余的共用。
- **端口 17893 被别的程序占了**：暂时不能改，请提 issue。

## 开发

```bash
npm install
npm test                 # 单元测试，用假扩展
npm run test:e2e         # 真实的 Chrome for Testing + 真实扩展
```

## 许可证

MIT
