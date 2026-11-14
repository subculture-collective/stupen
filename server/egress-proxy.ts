/**
 * The only way out of the lesson containers. It runs in its own container on
 * two Docker networks: the internal one the lesson containers use, and a
 * normal bridge with internet access. It forwards HTTP and HTTPS (CONNECT) to
 * public addresses on ports 80 and 443, and refuses loopback, private LAN,
 * link-local, CGNAT (the tailnet) and Docker addresses, checking the address
 * it actually connects to, so DNS tricks cannot reach the homelab.
 *
 * Started by server/containers.ts as `node /app/egress-proxy.ts`.
 */
import { lookup } from "node:dns/promises";
import { createServer, request } from "node:http";
import { connect } from "node:net";

import { blockedAddress } from "./netguard.ts";

const PORT = Number(process.env.PROXY_PORT ?? 3128);
const ALLOWED_PORTS = new Set([80, 443]);

async function resolvePublic(host: string): Promise<string> {
  const addrs = await lookup(host.replace(/^\[|\]$/g, ""), { all: true });
  if (!addrs.length) throw new Error("no address");
  const bad = addrs.find((a) => blockedAddress(a.address));
  if (bad) throw new Error(`private address ${bad.address}`);
  return addrs[0]!.address;
}

function log(kind: string, target: string, outcome: string) {
  console.log(`${new Date().toISOString()} ${kind} ${target} ${outcome}`);
}

const server = createServer(async (req, res) => {
  // Plain HTTP through the proxy: the request line carries an absolute URL.
  let url: URL;
  try {
    url = new URL(req.url ?? "");
  } catch {
    res.writeHead(400).end("absolute URL required\n");
    return;
  }
  const port = Number(url.port || 80);
  if (url.protocol !== "http:" || !ALLOWED_PORTS.has(port)) {
    log("http", url.host, "refused port or scheme");
    res.writeHead(403).end("only http on port 80 and https on 443\n");
    return;
  }
  let ip: string;
  try {
    ip = await resolvePublic(url.hostname);
  } catch (e) {
    log("http", url.host, `refused: ${(e as Error).message}`);
    res.writeHead(403).end(`refused: ${(e as Error).message}\n`);
    return;
  }
  const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: url.host };
  delete headers["proxy-connection"];
  delete headers["proxy-authorization"];
  const upstream = request({ host: ip, port, method: req.method, path: url.pathname + url.search, headers, timeout: 60_000 }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (e) => {
    log("http", url.host, `error: ${e.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
  req.pipe(upstream);
  log("http", url.host, "ok");
});

server.on("connect", async (req, client, head) => {
  const target = req.url ?? "";
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(target);
  const port = Number(m?.[2]);
  if (!m || !ALLOWED_PORTS.has(port)) {
    log("connect", target, "refused port");
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  let ip: string;
  try {
    ip = await resolvePublic(m[1]!);
  } catch (e) {
    log("connect", target, `refused: ${(e as Error).message}`);
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const upstream = connect({ host: ip, port, timeout: 60_000 }, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    client.destroy();
  };
  upstream.on("error", (e) => {
    log("connect", target, `error: ${e.message}`);
    client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  upstream.on("timeout", close);
  client.on("error", close);
  log("connect", target, "ok");
});

server.listen(PORT, "0.0.0.0", () => console.log(`egress proxy on :${PORT}`));
