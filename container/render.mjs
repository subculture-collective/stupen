// Renders a page that builds itself with JavaScript and prints the final HTML.
// Runs in the browser container: node render.mjs <url>. All traffic goes
// through the egress proxy given in RENDER_PROXY.
import { chromium } from "/opt/pw/index.mjs";

const url = process.argv[2];
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--proxy-server=${process.env.RENDER_PROXY}`],
});
try {
  const page = await browser.newPage({ javaScriptEnabled: true });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  process.stdout.write(await page.content());
} finally {
  await browser.close();
}
