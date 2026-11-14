// Turns a built web app folder into one self-contained HTML file, so the
// preview can be shown in a sandboxed frame that loads nothing from the app's
// own origin. Runs inside the lesson container: node preview-inline.mjs <dir> <out.html>
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const [dir = ".", out = "/out/index.html"] = process.argv.slice(2);
const root = resolve(dir);
const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".json": "application/json", ".txt": "text/plain",
};

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const indexPath = join(root, "index.html");
if (!existsSync(indexPath)) {
  console.error(`no index.html in ${dir}`);
  process.exit(1);
}
const files = walk(root);
const local = (ref) => {
  if (!ref || /^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) return undefined;
  const clean = ref.split(/[?#]/)[0].replace(/^\.?\//, "");
  const p = resolve(root, clean);
  return existsSync(p) && statSync(p).isFile() ? p : undefined;
};

// Media and fonts become data URIs wherever a file mentions them.
const dataUri = new Map();
for (const f of files) {
  const type = MIME[extname(f).toLowerCase()];
  if (type) dataUri.set(relative(root, f), `data:${type};base64,${readFileSync(f).toString("base64")}`);
}
const withMedia = (text) => {
  for (const [rel, uri] of dataUri) {
    text = text.split(`./${rel}`).join(uri).split(`/${rel}`).join(uri).split(`"${rel}"`).join(`"${uri}"`);
    // Bundlers also refer to hashed assets by bare file name, e.g. new URL("logo-1a2b3c.png", import.meta.url).
    const name = rel.split("/").pop();
    if (/[-.][\w]{6,}\.\w+$/.test(name)) text = text.split(`"${name}"`).join(`"${uri}"`);
  }
  return text;
};
const safeScript = (code) => code.replace(/<\/script/gi, "<\\/script");

let html = readFileSync(indexPath, "utf8");
html = html.replace(/<link[^>]+rel=["']?modulepreload["']?[^>]*>/gi, "");
html = html.replace(/<link([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (tag, a, href, b) => {
  if (!/stylesheet/i.test(a + b)) return tag;
  const p = local(href);
  return p ? `<style>\n${withMedia(readFileSync(p, "utf8"))}\n</style>` : tag;
});
html = html.replace(/<script([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, a, src, b) => {
  const p = local(src);
  if (!p) return tag;
  const attrs = `${a} ${b}`.replace(/\s+(crossorigin|defer|async)(=["'][^"']*["'])?/gi, "").trim();
  return `<script ${attrs}>\n${safeScript(withMedia(readFileSync(p, "utf8")))}\n</script>`;
});
html = withMedia(html);
writeFileSync(out, html);
console.log(`preview: ${Math.round(html.length / 1024)} KB`);
