// Bridge between this process and the Chrome extension.
//
// The first server process on the machine becomes the "hub": it listens on
// 127.0.0.1:<port> and the extension connects to it. Any later server process
// (e.g. Claude Desktop and Cursor both running the MCP server) finds the port
// taken and connects to the hub as a "peer"; the hub relays its calls.
//
// Who may connect:
//   - the extension: WebSocket Origin must be chrome-extension://<allowed id>.
//     Web pages cannot fake this header, so no website can drive the bridge.
//   - peers: must send the token stored in the user's config dir (mode 0600).

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { readToken } from "./config.js";

const PEER_HELLO_TIMEOUT_MS = 2000;

export const NOT_CONNECTED =
  "The Chrome extension is not connected. Make sure Chrome is running and the " +
  '"Reading List MCP" extension is installed and enabled (chrome://extensions). ' +
  "If Chrome was just started, wait a few seconds and try again.";

export class Bridge {
  constructor({ port, allowedExtensionIds, homeDir, callTimeoutMs = 15000, connectWaitMs = 35000, log = () => {} }) {
    this.port = port;
    this.allowedOrigins = new Set(allowedExtensionIds.map((id) => `chrome-extension://${id}`));
    this.homeDir = homeDir;
    this.callTimeoutMs = callTimeoutMs;
    this.connectWaitMs = connectWaitMs;
    this.log = log;
    this.mode = null; // "hub" | "peer"
    this.wss = null;
    this.extension = null; // hub: the extension socket
    this.extensionWaiters = [];
    this.hubSocket = null; // peer: socket to the hub
    this.pending = new Map(); // id -> {resolve, reject, timer}
  }

  async start() {
    this.token = readToken(this.homeDir);
    try {
      await this.#listen();
      this.mode = "hub";
      this.log(`hub listening on 127.0.0.1:${this.port}`);
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
      this.mode = "peer";
      this.log(`port ${this.port} in use, running as peer`);
    }
  }

  async close() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("bridge closed"));
    }
    this.pending.clear();
    this.hubSocket?.terminate();
    if (this.wss) {
      for (const c of this.wss.clients) c.terminate();
      await new Promise((r) => this.wss.close(() => r()));
    }
  }

  /** Call a method on the extension. Works in both hub and peer mode. */
  async call(method, params = {}) {
    if (this.mode === "hub") {
      const ext = await this.#waitForExtension();
      return this.#request(ext, method, params);
    }
    const target = await this.#connectToHub();
    return this.#request(target, method, params);
  }

  // ---------------------------------------------------------------- hub side

  #listen() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port: this.port });
      wss.once("error", reject);
      wss.once("listening", () => {
        wss.off("error", reject);
        wss.on("error", (e) => this.log(`hub error: ${e.message}`));
        wss.on("connection", (ws, req) => this.#onConnection(ws, req));
        this.wss = wss;
        resolve();
      });
    });
  }

  #onConnection(ws, req) {
    const origin = req.headers.origin;
    if (origin) {
      if (!this.allowedOrigins.has(origin)) {
        this.log(`rejected connection from origin ${origin}`);
        ws.close(4003, "origin not allowed");
        return;
      }
      this.#attachExtension(ws);
      return;
    }
    // No Origin header: must be a peer process presenting the token.
    const timer = setTimeout(() => ws.close(4001, "hello timeout"), PEER_HELLO_TIMEOUT_MS);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      const msg = safeParse(raw);
      if (msg?.type !== "hello" || msg.role !== "peer" || msg.token !== this.token) {
        ws.close(4001, "bad token");
        return;
      }
      ws.send(JSON.stringify({ type: "welcome" }));
      ws.on("message", (data) => this.#onPeerMessage(ws, data));
    });
  }

  #attachExtension(ws) {
    if (this.extension && this.extension !== ws) this.extension.close(4000, "replaced");
    this.extension = ws;
    this.log("extension connected");
    ws.on("message", (raw) => {
      const msg = safeParse(raw);
      if (!msg) return;
      if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
      this.#settle(msg);
    });
    ws.on("close", () => {
      if (this.extension === ws) this.extension = null;
      this.log("extension disconnected");
    });
    for (const w of this.extensionWaiters.splice(0)) w(ws);
  }

  async #onPeerMessage(peer, raw) {
    const msg = safeParse(raw);
    if (!msg?.id || !msg.method) return;
    try {
      const ext = await this.#waitForExtension();
      const result = await this.#request(ext, msg.method, msg.params);
      peer.send(JSON.stringify({ id: msg.id, result }));
    } catch (err) {
      peer.send(JSON.stringify({ id: msg.id, error: err.message }));
    }
  }

  #waitForExtension() {
    if (this.extension?.readyState === WebSocket.OPEN) return Promise.resolve(this.extension);
    return new Promise((resolve, reject) => {
      const waiter = (ws) => {
        clearTimeout(timer);
        resolve(ws);
      };
      const timer = setTimeout(() => {
        this.extensionWaiters = this.extensionWaiters.filter((w) => w !== waiter);
        reject(new Error(NOT_CONNECTED));
      }, this.connectWaitMs);
      this.extensionWaiters.push(waiter);
    });
  }

  // --------------------------------------------------------------- peer side

  async #connectToHub() {
    if (this.hubSocket?.readyState === WebSocket.OPEN) return this.hubSocket;
    // The hub may have exited; try to take over its port first.
    try {
      await this.#listen();
      this.mode = "hub";
      this.log("previous hub gone, promoted to hub");
      return this.#waitForExtension();
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
    }
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out connecting to hub")), 5000);
      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      ws.once("error", fail);
      ws.once("close", (code, reason) => fail(new Error(`hub closed connection: ${code} ${reason}`)));
      ws.once("open", () => ws.send(JSON.stringify({ type: "hello", role: "peer", token: this.token })));
      ws.once("message", (raw) => {
        clearTimeout(timer);
        if (safeParse(raw)?.type === "welcome") resolve();
        else reject(new Error("hub refused connection"));
      });
    });
    ws.on("message", (raw) => this.#settle(safeParse(raw)));
    ws.on("close", () => {
      if (this.hubSocket === ws) this.hubSocket = null;
    });
    this.hubSocket = ws;
    return ws;
  }

  // ------------------------------------------------------------------ shared

  #request(ws, method, params) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`extension did not answer "${method}" within ${this.callTimeoutMs} ms`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  #settle(msg) {
    if (!msg?.id) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}
