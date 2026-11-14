import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { blockedAddress } from "./netguard.ts";
import { HttpError } from "./util.ts";

export { blockedAddress };

const safeLookup: typeof dnsLookup = ((host: string, opts: any, cb: any) => {
  dnsLookup(host, { ...opts, all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const list = (Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts?.family ?? 4 }]) as { address: string; family: number }[];
    const bad = list.find((a) => blockedAddress(a.address));
    if (bad || !list.length) return cb(Object.assign(new Error(`refusing to fetch a private address (${bad?.address ?? "none"})`), { code: "EBLOCKED" }));
    if (opts?.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}) as any;

export type Fetched = { url: string; contentType: string; body: Buffer };

/**
 * GET a public URL: http(s) only, every resolved address checked at connect
 * time (so DNS rebinding cannot reach the LAN), redirects re-checked, 8 MB cap.
 */
export async function fetchPublic(raw: string, maxBytes = 8_000_000): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "that is not a URL");
  }
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "only http and https links can be fetched");
    if (url.username || url.password) throw new HttpError(400, "links with credentials are not fetched");
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && blockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) throw new HttpError(400, "refusing to fetch a private address");
    const res = await new Promise<{ status: number; headers: Record<string, any>; body: Buffer }>((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: "GET",
          lookup: safeLookup,
          timeout: 20_000,
          headers: { "user-agent": "study-coach/1.0 (learning materials fetcher)", accept: "text/html,text/plain,application/pdf,*/*;q=0.5", "accept-encoding": "identity" },
        },
        (r) => {
          const chunks: Buffer[] = [];
          let size = 0;
          r.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              req.destroy(new HttpError(413, "the page is larger than 8 MB"));
              return;
            }
            chunks.push(c);
          });
          r.on("end", () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks) }));
          r.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new HttpError(504, "the site took too long to answer")));
      req.on("error", reject);
      req.end();
    }).catch((e) => {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `could not fetch ${url.hostname}: ${(e as Error).message}`);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(String(res.headers.location), url);
      continue;
    }
    if (res.status >= 400) throw new HttpError(502, `${url.hostname} answered ${res.status}`);
    return { url: url.toString(), contentType: String(res.headers["content-type"] ?? ""), body: res.body };
  }
  throw new HttpError(502, "too many redirects");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Readable text from an HTML page: headings, paragraphs, lists and code blocks, without scripts or navigation. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let body = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c: string) => `\n\n\`\`\`\n${c.replace(/<[^>]+>/g, "")}\n\`\`\`\n\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => `\`${c.replace(/<[^>]+>/g, "")}\``)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, c: string) => `\n\n${"#".repeat(Number(n))} ${c.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|ul|ol|table|tr|blockquote|dl|dd|dt)>/gi, "\n\n")
    .replace(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => {
      const label = t.replace(/<[^>]+>/g, "").trim();
      return label ? `[${label}](${href})` : "";
    })
    .replace(/<[^>]+>/g, "");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...(title ? { title: decode(title).trim() } : {}), text };
}
