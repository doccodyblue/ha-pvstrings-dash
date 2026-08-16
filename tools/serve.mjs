#!/usr/bin/env node
// Dev server: serves the repo dir with CORS + no-cache, so a Lovelace
// resource on the HA instance can point at this Mac during development.
// Usage: node tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const port = parseInt(process.argv[2] ?? "8099", 10);

createServer(async (req, res) => {
  const path = normalize(join(root, new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": path.endsWith(".js") || path.endsWith(".mjs") ? "application/javascript"
        : path.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Access-Control-Allow-Origin": "*" }).end("not found");
  }
}).listen(port, () => console.log(`serving ${root} on :${port}`));
