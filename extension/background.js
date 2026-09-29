// Connects to the local MCP server and runs reading-list calls it sends.
// The whole extension is this file: it only touches chrome.readingList and
// only talks to 127.0.0.1.

const PORT = 17893;
const URL_ = `ws://127.0.0.1:${PORT}`;
const PING_MS = 20_000; // keeps the service worker alive while connected
const RETRY_MS = 3_000; // retry while the service worker is awake

let ws = null;
let pingTimer = null;
let retryTimer = null;

const handlers = {
  query: () => chrome.readingList.query({}),
  add: ({ url, title, hasBeenRead }) => chrome.readingList.addEntry({ url, title, hasBeenRead: Boolean(hasBeenRead) }),
  update: ({ url, title, hasBeenRead }) => {
    const info = { url };
    if (title !== undefined) info.title = title;
    if (hasBeenRead !== undefined) info.hasBeenRead = hasBeenRead;
    return chrome.readingList.updateEntry(info);
  },
  remove: ({ url }) => chrome.readingList.removeEntry({ url }),
};

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const socket = new WebSocket(URL_);
  ws = socket;
  socket.onopen = () => {
    setStatus("connected");
    socket.send(JSON.stringify({ type: "hello", role: "extension", version: chrome.runtime.getManifest().version }));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('{"type":"ping"}'), PING_MS);
  };
  socket.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg.id || !msg.method) return;
    const handler = handlers[msg.method];
    try {
      if (!handler) throw new Error(`unknown method ${msg.method}`);
      const result = await handler(msg.params || {});
      socket.send(JSON.stringify({ id: msg.id, result: result ?? null }));
    } catch (err) {
      socket.send(JSON.stringify({ id: msg.id, error: String(err?.message || err) }));
    }
  };
  socket.onclose = () => {
    clearInterval(pingTimer);
    if (ws === socket) ws = null;
    setStatus("waiting");
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RETRY_MS);
  };
  socket.onerror = () => {}; // onclose follows and schedules the retry
}

function setStatus(state) {
  chrome.action.setBadgeText({ text: state === "connected" ? "" : "…" });
  chrome.action.setTitle({
    title: state === "connected" ? "Reading List MCP: connected" : "Reading List MCP: waiting for your AI client",
  });
}

// Chrome stops an idle service worker after ~30 s, which also stops the retry
// timer. The alarm (30 s is the shortest period allowed) wakes it back up.
chrome.alarms.create("reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "reconnect" && connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
