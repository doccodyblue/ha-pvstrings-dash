#!/usr/bin/env node
// Minimal Home Assistant WebSocket client for deploy tooling.
// Usage: node tools/ha-ws.mjs '{"type":"lovelace/resources"}' ['{...}' ...]
// Env: HA_URL (http://...), HA_TOKEN. Prints one JSON result per command.

const HA_URL = process.env.HA_URL;
const HA_TOKEN = process.env.HA_TOKEN;
if (!HA_URL || !HA_TOKEN) { console.error("HA_URL / HA_TOKEN not set"); process.exit(2); }

const wsUrl = HA_URL.replace(/^http/, "ws") + "/api/websocket";
const cmds = process.argv.slice(2).map((s) => JSON.parse(s));
if (!cmds.length) { console.error("no commands given"); process.exit(2); }

const ws = new WebSocket(wsUrl);
let id = 0, pending = null;
const results = [];

function send(obj) { ws.send(JSON.stringify(obj)); }
function next() {
  if (!cmds.length) {
    for (const r of results) console.log(JSON.stringify(r));
    ws.close(); process.exit(results.some((r) => r.success === false) ? 1 : 0);
  }
  pending = { ...cmds.shift(), id: ++id };
  send(pending);
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === "auth_required") send({ type: "auth", access_token: HA_TOKEN });
  else if (msg.type === "auth_ok") next();
  else if (msg.type === "auth_invalid") { console.error("auth failed"); process.exit(1); }
  else if (msg.type === "result" && msg.id === pending?.id) {
    results.push({ success: msg.success, result: msg.result ?? null, error: msg.error ?? null });
    next();
  }
};
ws.onerror = (e) => { console.error("ws error", e.message ?? e); process.exit(1); };
setTimeout(() => { console.error("timeout"); process.exit(1); }, 15000);
